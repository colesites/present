//! A Syphon server: a screen's picture shared with other apps on this Mac,
//! for OBS, Resolume, MadMapper and the like, without leaving the GPU.
//!
//! Syphon.framework is built from source and shipped in the app
//! (`syphon/README.md`), and loaded when first wanted, so a build without it
//! still runs and says Syphon is unavailable. Each picture from the screen's
//! send loop (`services/ndi/output.rs`, the loop NDI uses too) goes into a
//! Metal texture and is published from it; nothing is uploaded while no app
//! is watching.

use crate::services::ndi::output::FrameSink;
use crate::services::ndi::sender::SendError;

/// Whether Syphon is here to publish with.
pub fn available() -> bool {
    platform::available()
}

/// A Syphon server, published while it lives.
pub struct SyphonSink {
    server: platform::Server,
}

impl SyphonSink {
    /// Start a server other apps see as `name`, beside Present's own name.
    pub fn open(name: &str) -> Result<Self, String> {
        Ok(Self {
            server: platform::Server::open(name)?,
        })
    }
}

impl FrameSink for SyphonSink {
    fn send_bgra(&mut self, width: u32, height: u32, bgra: &[u8]) -> Result<(), SendError> {
        if width == 0 || height == 0 {
            return Err(SendError::UnsendableSize { width, height });
        }
        let expected = width as usize * height as usize * 4;
        if bgra.len() != expected {
            return Err(SendError::WrongLength {
                expected,
                actual: bgra.len(),
            });
        }
        self.server.publish(bgra, width, height);
        Ok(())
    }

    fn connections(&self) -> u32 {
        u32::from(self.server.has_clients())
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    use objc2::encode::{Encode, Encoding};
    use objc2::rc::{autoreleasepool, Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{class, msg_send};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::NSString;

    #[link(name = "Metal", kind = "framework")]
    extern "C" {
        fn MTLCreateSystemDefaultDevice() -> *mut AnyObject;
        fn MTLCopyAllDevices() -> *mut AnyObject;
    }

    /// `MTLPixelFormatBGRA8Unorm`.
    const BGRA8_UNORM: usize = 80;

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MtlOrigin {
        x: usize,
        y: usize,
        z: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MtlSize {
        width: usize,
        height: usize,
        depth: usize,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct MtlRegion {
        origin: MtlOrigin,
        size: MtlSize,
    }

    // SAFETY: laid out as Metal's MTLOrigin, MTLSize and MTLRegion, whose
    // encodings the runtime gives as `{?=QQQ}` and `{?={?=QQQ}{?=QQQ}}`.
    unsafe impl Encode for MtlOrigin {
        const ENCODING: Encoding =
            Encoding::Struct("?", &[usize::ENCODING, usize::ENCODING, usize::ENCODING]);
    }
    unsafe impl Encode for MtlSize {
        const ENCODING: Encoding =
            Encoding::Struct("?", &[usize::ENCODING, usize::ENCODING, usize::ENCODING]);
    }
    unsafe impl Encode for MtlRegion {
        const ENCODING: Encoding = Encoding::Struct("?", &[MtlOrigin::ENCODING, MtlSize::ENCODING]);
    }

    /// The framework, loaded once: from the app's Frameworks, or in a
    /// development build from the repository.
    fn framework() -> Option<&'static libloading::Library> {
        static LOADED: OnceLock<Option<libloading::Library>> = OnceLock::new();
        LOADED
            .get_or_init(|| {
                let mut paths: Vec<PathBuf> = Vec::new();
                if let Some(contents) = std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent()?.parent().map(PathBuf::from))
                {
                    paths.push(contents.join("Frameworks/Syphon.framework/Versions/A/Syphon"));
                }
                #[cfg(debug_assertions)]
                paths.push(PathBuf::from(concat!(
                    env!("CARGO_MANIFEST_DIR"),
                    "/syphon/Syphon.framework/Versions/A/Syphon"
                )));
                paths.into_iter().filter(|path| path.exists()).find_map(|path| {
                    // SAFETY: Syphon's initialisers only register its classes.
                    match unsafe { libloading::Library::new(&path) } {
                        Ok(library) => Some(library),
                        Err(error) => {
                            tracing::warn!(%error, path = %path.display(), "Syphon could not be loaded");
                            None
                        }
                    }
                })
            })
            .as_ref()
    }

    fn server_class() -> Option<&'static AnyClass> {
        framework()?;
        AnyClass::get(c"SyphonMetalServer")
    }

    pub fn available() -> bool {
        server_class().is_some()
    }

    /// The GPU to publish from: the low-power one where there are two, so a
    /// laptop's discrete GPU is not woken for it.
    fn device() -> Option<Retained<AnyObject>> {
        // SAFETY: MTLCopyAllDevices returns a retained NSArray of devices, or null.
        let all = unsafe { Retained::from_raw(MTLCopyAllDevices()) };
        if let Some(all) = all {
            // SAFETY: count and objectAtIndex: on an NSArray, in bounds.
            let count: usize = unsafe { msg_send![&*all, count] };
            let devices: Vec<Retained<AnyObject>> = (0..count)
                .filter_map(|index| unsafe { msg_send![&*all, objectAtIndex: index] })
                .collect();
            // SAFETY: isLowPower is a BOOL property of every MTLDevice.
            let low_power = devices
                .iter()
                .find(|device| unsafe { msg_send![&***device, isLowPower] });
            if let Some(device) = low_power.or(devices.first()) {
                return Some(device.clone());
            }
        }
        // SAFETY: returns a retained device, or null.
        unsafe { Retained::from_raw(MTLCreateSystemDefaultDevice()) }
    }

    pub struct Server {
        server: Retained<AnyObject>,
        queue: Retained<AnyObject>,
        device: Retained<AnyObject>,
        texture: Option<((u32, u32), Retained<AnyObject>)>,
    }

    // SAFETY: Syphon's server is documented safe across threads, as are a
    // Metal device, its queue and a texture only this server writes; the
    // server is made on one thread and then used only by the send loop's.
    unsafe impl Send for Server {}

    impl Server {
        pub fn open(name: &str) -> Result<Self, String> {
            let class = server_class()
                .ok_or_else(|| "Syphon isn't included in this build of Present.".to_owned())?;
            let device =
                device().ok_or_else(|| "This Mac has no Metal GPU for Syphon.".to_owned())?;
            autoreleasepool(|_| {
                // SAFETY: newCommandQueue on an MTLDevice.
                let queue: Option<Retained<AnyObject>> =
                    unsafe { msg_send![&*device, newCommandQueue] };
                let queue =
                    queue.ok_or_else(|| "The GPU would not take work for Syphon.".to_owned())?;
                let name = NSString::from_str(name);
                // SAFETY: SyphonMetalServer's documented initialiser, with no options.
                let server: Option<Retained<AnyObject>> = unsafe {
                    let allocated: Allocated<AnyObject> = msg_send![class, alloc];
                    msg_send![allocated, initWithName: &*name, device: &*device, options: None::<&AnyObject>]
                };
                let server =
                    server.ok_or_else(|| "The Syphon server could not start.".to_owned())?;
                Ok(Self {
                    server,
                    queue,
                    device,
                    texture: None,
                })
            })
        }

        pub fn has_clients(&self) -> bool {
            // SAFETY: hasClients is a BOOL property of the server.
            unsafe { msg_send![&*self.server, hasClients] }
        }

        fn texture(&mut self, width: u32, height: u32) -> Option<Retained<AnyObject>> {
            if let Some((size, texture)) = &self.texture {
                if *size == (width, height) {
                    return Some(texture.clone());
                }
            }
            // SAFETY: MTLTextureDescriptor's class constructor and the device's
            // newTextureWithDescriptor:, for a 2D BGRA texture of this size.
            let texture: Option<Retained<AnyObject>> = unsafe {
                let descriptor: Option<Retained<AnyObject>> = msg_send![
                    class!(MTLTextureDescriptor),
                    texture2DDescriptorWithPixelFormat: BGRA8_UNORM,
                    width: width as usize,
                    height: height as usize,
                    mipmapped: Bool::NO
                ];
                let descriptor = descriptor?;
                msg_send![&*self.device, newTextureWithDescriptor: &*descriptor]
            };
            let texture = texture?;
            self.texture = Some(((width, height), texture.clone()));
            Some(texture)
        }

        pub fn publish(&mut self, bgra: &[u8], width: u32, height: u32) {
            if self.has_clients() {
                self.send(bgra, width, height);
            }
        }

        /// Publish whether or not anyone is watching.
        pub fn send(&mut self, bgra: &[u8], width: u32, height: u32) {
            autoreleasepool(|_| {
                let Some(texture) = self.texture(width, height) else {
                    return;
                };
                let region = MtlRegion {
                    origin: MtlOrigin { x: 0, y: 0, z: 0 },
                    size: MtlSize {
                        width: width as usize,
                        height: height as usize,
                        depth: 1,
                    },
                };
                let rect = CGRect::new(
                    CGPoint::new(0.0, 0.0),
                    CGSize::new(f64::from(width), f64::from(height)),
                );
                // SAFETY: the region is the whole texture, the buffer is its
                // width × height × 4 bytes (checked by the sink), and the last
                // publish finished on the GPU before this write, below.
                unsafe {
                    let _: () = msg_send![
                        &*texture,
                        replaceRegion: region,
                        mipmapLevel: 0usize,
                        withBytes: bgra.as_ptr().cast::<c_void>(),
                        bytesPerRow: width as usize * 4
                    ];
                    let buffer: Option<Retained<AnyObject>> =
                        msg_send![&*self.queue, commandBuffer];
                    let Some(buffer) = buffer else {
                        return;
                    };
                    let _: () = msg_send![
                        &*self.server,
                        publishFrameTexture: &*texture,
                        onCommandBuffer: &*buffer,
                        imageRegion: rect,
                        flipped: Bool::NO
                    ];
                    let _: () = msg_send![&*buffer, commit];
                    // The texture is written again next frame: the copy out
                    // of it finishes first. A 1080p copy is well under a
                    // millisecond.
                    let _: () = msg_send![&*buffer, waitUntilCompleted];
                }
            });
        }
    }

    impl Drop for Server {
        fn drop(&mut self) {
            // SAFETY: stop on the server; it leaves other apps' lists at once.
            unsafe {
                let _: () = msg_send![&*self.server, stop];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn available() -> bool {
        false
    }

    pub struct Server;

    impl Server {
        pub fn open(_name: &str) -> Result<Self, String> {
            Err("Syphon is only on a Mac.".to_owned())
        }

        pub fn has_clients(&self) -> bool {
            false
        }

        pub fn publish(&mut self, _bgra: &[u8], _width: u32, _height: u32) {}
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// Publishes through the framework in the repository, as `cargo test`
    /// runs a development build.
    #[test]
    fn a_server_starts_and_takes_a_frame() {
        assert!(available(), "Syphon.framework loads from syphon/");
        let mut sink = SyphonSink::open("Present test").expect("a server");
        let frame = vec![255u8; 64 * 36 * 4];
        sink.send_bgra(64, 36, &frame).expect("a frame");
        assert_eq!(sink.connections(), 0, "no app is watching a test");
        // Through Metal and into Syphon, as when an app is watching.
        sink.server.send(&frame, 64, 36);
        sink.server.send(&vec![0u8; 128 * 72 * 4], 128, 72);
        assert!(matches!(
            sink.send_bgra(64, 36, &frame[..10]),
            Err(SendError::WrongLength { .. })
        ));
    }
}
