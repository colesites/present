//! The native view under the audience window's webview, on macOS.
//!
//! A layer-backed `NSView` inserted directly below the `WKWebView` in the
//! window's content view, sized with it. Each frame becomes a `CGImage` set as
//! the view layer's contents on the main thread — AppKit and Core Animation are
//! main-thread-only; drawing happens on the surface thread and only the handover
//! crosses.
//!
//! A view rather than a sublayer added to the content view's own layer: AppKit
//! manages the layers of a layer-backed view hierarchy and may reorder sublayers
//! it did not create. A sibling view below the webview is ordering AppKit keeps.
//!
//! The webview only lets it show where its page is transparent, which needs
//! the `WKWebView` not to paint its own white background. That is the private
//! `drawsBackground` key — the same one wry sets behind Tauri's
//! `macos-private-api` feature. It is set here on this one webview while the
//! native view is attached, and restored when it detaches, rather than turning
//! the feature on for every window in the app.

use std::cell::Cell;
use std::ffi::c_void;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{msg_send, MainThreadMarker, Message};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};
use objc2_core_foundation::CFRetained;
use objc2_core_graphics::{
    CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage, CGImageAlphaInfo,
    CGImageByteOrderInfo,
};
use objc2_foundation::{ns_string, NSNumber};
use objc2_quartz_core::CATransaction;
use tauri::{AppHandle, Manager};

use super::Presenter;

/// The view, retained, as an address the surface thread may carry but never
/// dereference. Only the main thread touches what it points at.
#[derive(Clone, Copy)]
struct ViewAddress(usize);

/// A finished image on its way to the main thread. A `CGImage` is immutable and
/// thread-safe; the wrapper only says so to the compiler.
struct SendImage(CFRetained<CGImage>);

// SAFETY: CGImage is an immutable Core Foundation object, documented as safe to
// use from any thread.
unsafe impl Send for SendImage {}

pub struct MacPresenter {
    app: AppHandle,
    label: String,
    view: ViewAddress,
    /// The webview whose background was turned off, to turn back on. Retained,
    /// like the view: the window can close, and another open under the same
    /// label, before this is dropped, and an address alone would then point at
    /// a freed webview.
    webview: ViewAddress,
    /// A frame is on its way to the main thread. The next is dropped rather
    /// than queued: a busy main thread must not build up a backlog of
    /// eight-megabyte images, and the newest frame is the one worth showing.
    in_flight: Arc<AtomicBool>,
    /// The window's size and when it was read. Reading it is a round trip to
    /// the main thread; sixty of those a second is load the main thread does
    /// not need for a window that is fullscreen on a projector and never
    /// resizes. A resize shows stretched for at most [`SIZE_REFRESH`].
    size: Cell<Option<SizeReading>>,
}

const SIZE_REFRESH: Duration = Duration::from_millis(250);

/// When the size was read, and what it was — `None` for a window gone.
type SizeReading = (Instant, Option<(u32, u32)>);

impl MacPresenter {
    /// Insert the native view below the webview of the window labelled `label`.
    pub fn attach(app: &AppHandle, label: &str) -> Result<Self, String> {
        let window = app
            .get_webview_window(label)
            .ok_or_else(|| format!("no window labelled {label}"))?;

        let (sender, receiver) = mpsc::channel();
        window
            .with_webview(move |platform| {
                let result = (|| {
                    let marker = MainThreadMarker::new().ok_or("not on the main thread")?;
                    let webview = NonNull::new(platform.inner().cast::<NSView>())
                        .ok_or("the window has no webview")?;
                    // SAFETY: wry's WKWebView is an NSView, alive while the
                    // window is, and this runs on the main thread.
                    let webview = unsafe { webview.as_ref() };
                    let parent =
                        unsafe { webview.superview() }.ok_or("the webview has no parent view")?;

                    let view = NSView::initWithFrame(marker.alloc(), parent.bounds());
                    view.setWantsLayer(true);
                    view.setAutoresizingMask(
                        NSAutoresizingMaskOptions::ViewWidthSizable
                            | NSAutoresizingMaskOptions::ViewHeightSizable,
                    );
                    parent.addSubview_positioned_relativeTo(
                        &view,
                        NSWindowOrderingMode::Below,
                        Some(webview),
                    );
                    set_draws_background(webview, false);
                    Ok::<(usize, usize), &'static str>((
                        Retained::into_raw(view) as usize,
                        Retained::into_raw(webview.retain()) as usize,
                    ))
                })();
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;

        let (view, webview) = receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| "the main thread did not answer".to_owned())?
            .map_err(str::to_owned)?;

        Ok(Self {
            app: app.clone(),
            label: label.to_owned(),
            view: ViewAddress(view),
            webview: ViewAddress(webview),
            in_flight: Arc::new(AtomicBool::new(false)),
            size: Cell::new(None),
        })
    }
}

/// Turn a `WKWebView`'s own background painting off or on.
fn set_draws_background(webview: &NSView, draws: bool) {
    let value = NSNumber::numberWithBool(draws);
    // SAFETY: `drawsBackground` is a KVC key WKWebView answers on every macOS
    // this app supports (wry relies on it); the value is an NSNumber boolean.
    unsafe {
        let _: () = msg_send![webview, setValue: &*value, forKey: ns_string!("drawsBackground")];
    }
}

/// Wrap premultiplied BGRA bytes as a `CGImage` without copying them.
fn image_from(width: u32, height: u32, bgra: Vec<u8>) -> Option<CFRetained<CGImage>> {
    unsafe extern "C-unwind" fn release(info: *mut c_void, _data: NonNull<c_void>, _size: usize) {
        // SAFETY: `info` is the box leaked below, released exactly once, by
        // Core Graphics, when the provider is freed.
        drop(unsafe { Box::from_raw(info.cast::<Vec<u8>>()) });
    }

    let expected = (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)?;
    if bgra.len() != expected || width == 0 || height == 0 {
        return None;
    }
    let boxed = Box::new(bgra);
    let data = boxed.as_ptr().cast::<c_void>();
    let info = Box::into_raw(boxed).cast::<c_void>();

    // SAFETY: `data` stays valid until `release` frees the box it lives in.
    let provider = unsafe { CGDataProvider::with_data(info, data, expected, Some(release)) };
    let Some(provider) = provider else {
        // SAFETY: the provider was not created, so nothing else owns the box.
        drop(unsafe { Box::from_raw(info.cast::<Vec<u8>>()) });
        return None;
    };
    let space = CGColorSpace::new_device_rgb()?;
    let info = CGBitmapInfo(
        CGImageAlphaInfo::PremultipliedFirst.0 | CGImageByteOrderInfo::Order32Little.0,
    );
    // SAFETY: the provider holds `width * height * 4` bytes of B, G, R, A.
    unsafe {
        CGImage::new(
            width as usize,
            height as usize,
            8,
            32,
            width as usize * 4,
            Some(&space),
            info,
            Some(&provider),
            std::ptr::null(),
            false,
            CGColorRenderingIntent::RenderingIntentDefault,
        )
    }
}

impl Presenter for MacPresenter {
    fn present(&mut self, width: u32, height: u32, bgra: Vec<u8>) -> Result<(), String> {
        if self.in_flight.load(Ordering::Relaxed) {
            return Ok(());
        }
        let image = SendImage(image_from(width, height, bgra).ok_or("could not wrap the frame")?);
        let view = self.view;
        let in_flight = self.in_flight.clone();
        in_flight.store(true, Ordering::Relaxed);

        self.app
            .run_on_main_thread(move || {
                let image = image;
                // SAFETY: the view was retained in `attach` and is released
                // only by `Drop`, also on the main thread, after this.
                let view = unsafe { &*(view.0 as *const NSView) };
                if let Some(layer) = view.layer() {
                    CATransaction::begin();
                    CATransaction::setDisableActions(true);
                    // SAFETY: a CGImage is a valid `contents` value.
                    unsafe {
                        layer.setContents(Some(
                            &*(CFRetained::as_ptr(&image.0).as_ptr() as *const AnyObject),
                        ));
                    }
                    CATransaction::commit();
                }
                in_flight.store(false, Ordering::Relaxed);
            })
            .map_err(|error| {
                self.in_flight.store(false, Ordering::Relaxed);
                error.to_string()
            })
    }

    fn size(&self) -> Option<(u32, u32)> {
        if let Some((read_at, size)) = self.size.get() {
            if read_at.elapsed() < SIZE_REFRESH {
                return size;
            }
        }
        let size = self.read_size();
        self.size.set(Some((Instant::now(), size)));
        size
    }
}

impl MacPresenter {
    fn read_size(&self) -> Option<(u32, u32)> {
        let window = self.app.get_webview_window(&self.label)?;
        let physical = window.inner_size().ok()?;
        let scale = window.scale_factor().ok()?;
        let width = (f64::from(physical.width) / scale).round() as u32;
        let height = (f64::from(physical.height) / scale).round() as u32;
        (width > 0 && height > 0).then_some((width, height))
    }
}

impl Drop for MacPresenter {
    fn drop(&mut self) {
        let (view, webview) = (self.view, self.webview);
        let _ = self.app.run_on_main_thread(move || {
            // SAFETY: retained in `attach`; this is the one release.
            if let Some(view) = unsafe { Retained::from_raw(view.0 as *mut NSView) } {
                view.removeFromSuperview();
            }
            // SAFETY: retained in `attach`; this is the one release.
            if let Some(webview) = unsafe { Retained::from_raw(webview.0 as *mut NSView) } {
                // A webview whose window has closed is past repainting.
                if unsafe { webview.superview() }.is_some() {
                    set_draws_background(&webview, true);
                }
            }
        });
    }
}
