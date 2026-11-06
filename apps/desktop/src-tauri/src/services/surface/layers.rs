//! A screen's picture shown as layers the window server composites on the GPU,
//! on macOS: the screen's colour, the video as the decoder left it, and the
//! slide drawn over transparency above it (`layered.rs`).
//!
//! ```text
//! host layer            the view's own: a whole picture as its contents, or
//!  └─ canvas            the screen, fitted to the host: its colour behind
//!      ├─ clip          the box the video is clipped to
//!      │   └─ video     the decoder's surface, scaled by the GPU
//!      └─ overlay       the slide, timer, props and banner, over transparency
//! ```
//!
//! A whole picture — a screen mid transition, or one with something the
//! layers cannot show — is the host's contents as before, with the canvas
//! hidden. Both are set in one transaction, so a switch between the two is a
//! single change on screen.
//!
//! Main thread only, as everything Core Animation is here. The layers are
//! found by name under the host each time, so nothing has to be kept or
//! released apart from the host they belong to.

use std::sync::Arc;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::CGColor;
use objc2_foundation::NSString;
use objc2_quartz_core::{CALayer, CATransaction};

use super::iosurface::Frame;
use crate::services::compositor::pipeline::VideoGeometry;
use crate::services::video::GpuPicture;

/// How the screen's picture sits in its host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    /// Stretched to the host's bounds, as a whole picture set as its contents
    /// is: the audience view, whose canvas is its window.
    Stretch,
    /// As large as fits, centred: a panel showing a screen in its box.
    Proportional,
}

/// What a host shows in layers.
pub struct Layered {
    /// The canvas's size, in the pixels every rectangle here is in.
    pub canvas: (u32, u32),
    /// Under everything: red, green, blue, alpha, 0 to 1.
    pub base: [f64; 4],
    pub video: Option<(Arc<GpuPicture>, VideoGeometry)>,
    /// The slide over transparency: premultiplied BGRA, the canvas's size.
    /// `None`: nothing over the video.
    pub overlay: Option<Arc<Frame>>,
}

const CANVAS: &str = "present.canvas";
const CLIP: &str = "present.clip";
const VIDEO: &str = "present.video";
const OVERLAY: &str = "present.overlay";

/// Show a whole picture as the host's contents, the layers hidden.
///
/// # Safety
///
/// On the main thread; `contents` is a valid layer contents (an IOSurface).
pub unsafe fn show_whole(host: &CALayer, contents: &AnyObject) {
    quietly(|| {
        // SAFETY: as the caller promises.
        unsafe { host.setContents(Some(contents)) };
        hide_layers(host);
    });
}

/// Show `layered` in the host's layers, its own contents cleared.
///
/// # Safety
///
/// On the main thread.
pub unsafe fn show_layered(host: &CALayer, layered: &Layered, fit: Fit) {
    quietly(|| {
        let canvas = child_or_new(host, CANVAS, |canvas| {
            canvas.setMasksToBounds(true);
            let clip = named(CLIP);
            clip.setMasksToBounds(true);
            clip.addSublayer(&named(VIDEO));
            canvas.addSublayer(&clip);
            canvas.addSublayer(&named(OVERLAY));
        });
        // SAFETY: clearing the contents is always valid.
        unsafe { host.setContents(None) };

        let bounds = host.bounds();
        let (canvas_width, canvas_height) = (
            f64::from(layered.canvas.0.max(1)),
            f64::from(layered.canvas.1.max(1)),
        );
        let (width, height) = match fit {
            Fit::Stretch => (bounds.size.width, bounds.size.height),
            Fit::Proportional => {
                let scale =
                    (bounds.size.width / canvas_width).min(bounds.size.height / canvas_height);
                (canvas_width * scale, canvas_height * scale)
            }
        };
        canvas.setFrame(rect(
            bounds.origin.x + (bounds.size.width - width) / 2.0,
            bounds.origin.y + (bounds.size.height - height) / 2.0,
            width,
            height,
        ));
        let [red, green, blue, alpha] = layered.base;
        canvas.setBackgroundColor(Some(&CGColor::new_srgb(red, green, blue, alpha)));
        canvas.setHidden(false);

        // Canvas pixels to the canvas layer's points. Its y counts up from
        // the bottom; the canvas's counts down from the top.
        let (scale_x, scale_y) = (width / canvas_width, height / canvas_height);
        let place =
            |(x, y, w, h): (f32, f32, f32, f32), within_height: f64, top: f32, left: f32| {
                let (x, y, w, h) = (
                    f64::from(x - left) * scale_x,
                    f64::from(y - top) * scale_y,
                    f64::from(w) * scale_x,
                    f64::from(h) * scale_y,
                );
                rect(x, within_height - y - h, w, h)
            };

        if let (Some(clip), Some((picture, geometry))) = (child(&canvas, CLIP), &layered.video) {
            let clip_frame = place(geometry.clip, height, 0.0, 0.0);
            clip.setFrame(clip_frame);
            clip.setHidden(false);
            if let Some(video) = child(&clip, VIDEO) {
                video.setFrame(place(
                    geometry.picture,
                    clip_frame.size.height,
                    geometry.clip.1,
                    geometry.clip.0,
                ));
                match picture.io_surface() {
                    // SAFETY: an IOSurface is a valid `contents` value; the
                    // picture keeps it alive, and the presenter keeps the
                    // picture until the window server has let it go.
                    Some(surface) => unsafe {
                        set_contents(&video, &*(std::ptr::from_ref(surface).cast::<AnyObject>()));
                    },
                    None => clear(&video),
                }
            }
        } else if let Some(clip) = child(&canvas, CLIP) {
            clip.setHidden(true);
            if let Some(video) = child(&clip, VIDEO) {
                clear(&video);
            }
        }

        if let Some(overlay) = child(&canvas, OVERLAY) {
            overlay.setFrame(rect(0.0, 0.0, width, height));
            match &layered.overlay {
                Some(frame) => {
                    // SAFETY: an IOSurface is a valid `contents` value.
                    unsafe { set_contents(&overlay, frame.as_contents()) };
                    overlay.setHidden(false);
                }
                None => {
                    overlay.setHidden(true);
                    clear(&overlay);
                }
            }
        }
    });
}

/// Hide the layers and clear the host: nothing shown.
///
/// # Safety
///
/// On the main thread.
pub unsafe fn clear_all(host: &CALayer) {
    quietly(|| {
        clear(host);
        hide_layers(host);
    });
}

/// Hide the layers and let go of what they showed, so the window server
/// releases the video's surface for the decoder.
fn hide_layers(host: &CALayer) {
    let Some(canvas) = child(host, CANVAS) else {
        return;
    };
    canvas.setHidden(true);
    if let Some(clip) = child(&canvas, CLIP) {
        if let Some(video) = child(&clip, VIDEO) {
            clear(&video);
        }
    }
    if let Some(overlay) = child(&canvas, OVERLAY) {
        clear(&overlay);
    }
}

/// Set `contents` unless the layer already shows it: the slide is the same
/// surface for every video frame over it, and setting it again would have the
/// window server read it again.
///
/// # Safety
///
/// `contents` is a valid layer contents.
unsafe fn set_contents(layer: &CALayer, contents: &AnyObject) {
    // SAFETY: reading the contents on the main thread.
    let same = unsafe { layer.contents() }.is_some_and(|shown| std::ptr::eq(&*shown, contents));
    if !same {
        // SAFETY: as the caller promises.
        unsafe { layer.setContents(Some(contents)) };
    }
}

fn clear(layer: &CALayer) {
    // SAFETY: clearing the contents is always valid.
    unsafe { layer.setContents(None) };
}

fn quietly(change: impl FnOnce()) {
    CATransaction::begin();
    CATransaction::setDisableActions(true);
    change();
    CATransaction::commit();
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> CGRect {
    CGRect {
        origin: CGPoint { x, y },
        size: CGSize {
            width: width.max(0.0),
            height: height.max(0.0),
        },
    }
}

fn named(name: &str) -> Retained<CALayer> {
    let layer = CALayer::new();
    layer.setName(Some(&NSString::from_str(name)));
    layer
}

/// The sublayer of `parent` called `name`.
fn child(parent: &CALayer, name: &str) -> Option<Retained<CALayer>> {
    // SAFETY: reading the sublayers on the main thread.
    let sublayers = unsafe { parent.sublayers() }?;
    sublayers
        .iter()
        .find(|layer| layer.name().is_some_and(|each| each.to_string() == name))
}

fn child_or_new(parent: &CALayer, name: &str, build: impl FnOnce(&CALayer)) -> Retained<CALayer> {
    if let Some(found) = child(parent, name) {
        return found;
    }
    let layer = named(name);
    build(&layer);
    parent.addSublayer(&layer);
    layer
}
