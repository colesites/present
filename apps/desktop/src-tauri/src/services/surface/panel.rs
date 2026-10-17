//! Video drawn natively in a panel of a window: the center pane's video and
//! the operator's preview of the audience screen.
//!
//! Those panels showed their pictures as JPEGs the page fetched and painted,
//! so a frame reached them only when the page's own thread was free. Any long
//! render of the operator window — and there are many during a service — held
//! the center pane's video while the audience screen, drawn by the app itself,
//! played on. Here the panel's picture is a Core Animation layer the app draws,
//! as it draws the audience screen, and nothing the page does can hold it up.
//!
//! **Under the page, as the audience view is** (`macos.rs`). The layers sit in
//! a view below the webview; the webview stops painting its own background,
//! and the page leaves the panel's box clear (`useNativePanel.ts`). Everything
//! the page draws — the panel's frame, a menu opening over it, a dialog, a
//! toast, a prop over the preview — is drawn over the picture as it always
//! was, because the page is on top. Clicks go to the page.
//!
//! **Shown as the audience view is shown**: a view per panel, its layer given
//! each frame on the app's main thread — one slot, the newest frame wins. That
//! is the app's thread, not the page's: the page runs in WebKit's own process,
//! and whatever it is busy with, the app's main thread is free to show the
//! next frame, as it is for the audience screen.
//!
//! macOS only, like the audience view. Elsewhere `NativePanel::attach` says
//! no, and the page draws the panel as it did.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::AppHandle;

use crate::services::video::VideoFrame;

/// Where a panel is, as the page measures it, in CSS pixels from the
/// webview's top-left — which are the window's points, the page never being
/// zoomed.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelGeometry {
    /// The panel's box: x, y, width, height.
    pub rect: [f64; 4],
    /// The part of it on screen, inside the window and every scrolling box
    /// around it: what the page leaves clear for it.
    pub clip: [f64; 4],
    pub visible: bool,
    /// Whether the page is being shown at all: `false` while its window is
    /// covered or minimised. The picture stays where it is with its last
    /// frame, and only the drawing stops. Taken away while the window was
    /// away, it had to be put back when it returned, and the page showed a
    /// frame without it first: the preview flashed.
    #[serde(default = "being_shown")]
    pub active: bool,
    /// The page's viewport, width and height: the webview less any part the
    /// window keeps for itself, such as a title bar the webview runs under.
    /// The page measures from the viewport's top; the viewport's bottom is the
    /// webview's.
    #[serde(default)]
    pub viewport: [f64; 2],
    /// Device pixels to a CSS pixel: what the panel is drawn at.
    pub dpr: f64,
    /// How round its corners are, and which: top-left 1, top-right 2,
    /// bottom-left 4, bottom-right 8.
    #[serde(default)]
    pub radius: f64,
    #[serde(default)]
    pub corners: u8,
}

impl PanelGeometry {
    /// Nowhere: the picture hidden.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    fn hidden() -> Self {
        Self {
            rect: [0.0; 4],
            clip: [0.0; 4],
            visible: false,
            active: true,
            viewport: [0.0; 2],
            dpr: 1.0,
            radius: 0.0,
            corners: 0,
        }
    }

    /// The size to decode or draw the panel's picture at: its size in device
    /// pixels, no more than [`LONGEST_SIDE`] across, which the GPU scales to
    /// the panel.
    pub fn pixel_size(&self) -> (u32, u32) {
        let dpr = self.dpr.clamp(0.5, 4.0);
        let (width, height) = (self.rect[2] * dpr, self.rect[3] * dpr);
        if !(width.is_finite() && height.is_finite() && width > 0.0 && height > 0.0) {
            return (16, 16);
        }
        let scale = (LONGEST_SIDE / width.max(height)).min(1.0);
        let side = |pixels: f64| ((pixels * scale).round() as u32).max(16);
        (side(width), side(height))
    }
}

fn being_shown() -> bool {
    true
}

/// The most a panel's picture is decoded or drawn across. An operator's view,
/// sharp enough to read, as the page's panels were (`largest={960}`): drawn at
/// a Retina panel's own size it was four times the pixels — four times the
/// decoding, drawing and copying — for a picture a few inches across.
const LONGEST_SIDE: f64 = 960.0;

/// How long a panel's page may go without saying where it is before its
/// picture is hidden. The page says so at least once a second while it is
/// showing (`useNativePanel.ts`), and a page reloaded or closed takes its
/// panels with it (`NativePanelsState`), so this is only for a page that died
/// some other way — long enough that a page merely busy for a few seconds,
/// importing a deck, never has its video taken off the panel.
const STALE_AFTER: Duration = Duration::from_secs(15);

/// Packs a size into one atomic.
fn pack(size: (u32, u32)) -> u64 {
    (u64::from(size.0) << 32) | u64::from(size.1)
}

fn unpack(packed: u64) -> (u32, u32) {
    ((packed >> 32) as u32, (packed & 0xffff_ffff) as u32)
}

/// One panel's native picture.
pub struct NativePanel {
    #[cfg(target_os = "macos")]
    inner: mac::Panel,
    /// The panel's size in device pixels, as last measured.
    size: AtomicU64,
    seen: Mutex<Seen>,
}

/// What the page last said, and when.
struct Seen {
    visible: bool,
    active: bool,
    at: Instant,
    /// Hidden for having gone quiet, until the page speaks again.
    hidden: bool,
}

impl NativePanel {
    /// Put a picture under a panel of the window labelled `label`. `Err` where
    /// there is none to put: on a platform without one, or a window gone.
    pub fn attach(app: &AppHandle, label: &str, geometry: &PanelGeometry) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            let panel = Self {
                inner: mac::Panel::attach(app, label)?,
                size: AtomicU64::new(pack(geometry.pixel_size())),
                seen: Mutex::new(Seen {
                    visible: geometry.visible,
                    active: geometry.active,
                    at: Instant::now(),
                    hidden: false,
                }),
            };
            panel.set_geometry(geometry.clone());
            Ok(panel)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, label, geometry);
            Err("panels are drawn by the page on this platform".to_owned())
        }
    }

    /// The panel moved or changed size — or its page is saying it is still
    /// there.
    pub fn set_geometry(&self, geometry: PanelGeometry) {
        self.size
            .store(pack(geometry.pixel_size()), Ordering::Relaxed);
        *self.seen.lock().unwrap_or_else(PoisonError::into_inner) = Seen {
            visible: geometry.visible,
            active: geometry.active,
            at: Instant::now(),
            hidden: false,
        };
        #[cfg(target_os = "macos")]
        self.inner.set_geometry(&geometry);
    }

    /// Whether the panel is showing and its page still says where it is: the
    /// only time a frame is worth drawing for it. A page gone quiet has its
    /// picture hidden, so a panel nobody looks after is never left behind.
    ///
    /// A page whose window is away says so, and goes quiet — it draws nothing
    /// until it is back. Its panel draws nothing either, and keeps its place
    /// and its last frame for when it is.
    pub fn is_current(&self) -> bool {
        let mut seen = self.seen.lock().unwrap_or_else(PoisonError::into_inner);
        if !seen.active {
            return false;
        }
        if seen.at.elapsed() < STALE_AFTER {
            return seen.visible;
        }
        if seen.visible && !seen.hidden {
            seen.hidden = true;
            #[cfg(target_os = "macos")]
            self.inner.set_geometry(&PanelGeometry::hidden());
        }
        false
    }

    /// The panel's size in device pixels.
    pub fn pixel_size(&self) -> (u32, u32) {
        unpack(self.size.load(Ordering::Relaxed))
    }

    /// Show a decoded video frame as it is, scaled to the panel by the GPU.
    pub fn show_video(&self, frame: &VideoFrame) {
        #[cfg(target_os = "macos")]
        self.inner.show(frame.width, frame.height, &frame.bgra);
        #[cfg(not(target_os = "macos"))]
        let _ = frame;
    }

    /// Show a drawn picture: premultiplied BGRA, top row first.
    pub fn show_picture(&self, size: (u32, u32), bgra: &[u8]) {
        #[cfg(target_os = "macos")]
        self.inner.show(size.0, size.1, bgra);
        #[cfg(not(target_os = "macos"))]
        let _ = (size, bgra);
    }
}

/// Stop `window`'s webview painting its own background, for good: what the
/// page leaves clear shows what the app draws under it (`attach`). Done when
/// the window is made, before its page draws — WebKit keeps the layers of a
/// page drawn with a background opaque until it is reloaded.
#[cfg(target_os = "macos")]
pub fn clear_webview_background(window: &tauri::WebviewWindow) {
    let done = window.with_webview(|platform| {
        if let Some(webview) =
            std::ptr::NonNull::new(platform.inner().cast::<objc2_app_kit::NSView>())
        {
            // SAFETY: wry's WKWebView is an NSView, alive while the window is,
            // and this runs on the main thread.
            super::macos::set_draws_background(unsafe { webview.as_ref() }, false);
        }
    });
    if let Err(error) = done {
        tracing::warn!(%error, "could not clear the operator window's background");
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::collections::HashMap;
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{mpsc, Arc, LazyLock, Mutex, MutexGuard, PoisonError};
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, Message};
    use objc2_app_kit::{
        NSAutoresizingMaskOptions, NSView, NSViewLayerContentsPlacement,
        NSViewLayerContentsRedrawPolicy, NSWindowOrderingMode,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::CGColor;
    use objc2_quartz_core::{CACornerMask, CATransaction};
    use tauri::{AppHandle, Manager};

    use super::super::iosurface::{Frame, Surfaces};
    use super::super::macos::set_draws_background;
    use super::PanelGeometry;

    /// A retained Objective-C object's address, which another thread may carry
    /// but only the main thread dereferences.
    #[derive(Clone, Copy, PartialEq, Eq)]
    struct Address(usize);

    /// One window's host: a view under its webview, the size of it, holding
    /// every panel's views — as the audience view sits under its window's
    /// (`macos.rs`).
    struct Host {
        view: Address,
        /// The webview it is under, to tell a window opened again under the
        /// same label.
        webview: Address,
        panels: usize,
    }

    /// By window label. Only the main thread reads or writes it.
    static HOSTS: LazyLock<Mutex<HashMap<String, Host>>> = LazyLock::new(Mutex::default);

    fn hosts() -> MutexGuard<'static, HashMap<String, Host>> {
        HOSTS.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// A panel's two views: one clipped to the part on screen, holding one
    /// the size of the whole panel with the picture fitted inside it. Views,
    /// as the audience view is one: AppKit places them in its own
    /// coordinates, and their layers show what is set on them.
    #[derive(Clone, Copy)]
    struct Views {
        clip: Address,
        picture: Address,
    }

    impl Views {
        /// The views themselves.
        ///
        /// # Safety
        ///
        /// Only on the main thread, while they are in the panel's slot: they
        /// are released only after being taken out of it, on that thread.
        unsafe fn get(&self) -> (&NSView, &NSView) {
            unsafe {
                (
                    &*(self.clip.0 as *const NSView),
                    &*(self.picture.0 as *const NSView),
                )
            }
        }
    }

    pub(super) struct Panel {
        app: AppHandle,
        label: String,
        /// The views while they are there; taken out, on the main thread,
        /// when the panel goes, so a frame queued before then finds nothing
        /// to draw on rather than a released view.
        views: Arc<Mutex<Option<Views>>>,
        /// The newest frame not yet shown, and whether a job is on its way to
        /// show it: one slot, so a busy main thread never builds a backlog,
        /// and the newest frame is the one that lands — `MacPresenter`'s way.
        image: Arc<Mutex<Option<Arc<Frame>>>>,
        image_in_flight: Arc<AtomicBool>,
        /// The surfaces frames are written into (`iosurface.rs`).
        surfaces: Mutex<Surfaces>,
        /// The same, for where the panel is.
        geometry: Arc<Mutex<Option<PanelGeometry>>>,
        geometry_in_flight: Arc<AtomicBool>,
    }

    impl Panel {
        pub(super) fn attach(app: &AppHandle, label: &str) -> Result<Self, String> {
            let window = app
                .get_webview_window(label)
                .ok_or_else(|| format!("no window labelled {label}"))?;
            let owner = label.to_owned();
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
                        let host = host_for(marker, &owner, webview)?;
                        Ok::<Views, &'static str>(new_views(marker, host))
                    })();
                    let _ = sender.send(result);
                })
                .map_err(|error| error.to_string())?;
            let views = receiver
                .recv_timeout(Duration::from_secs(2))
                .map_err(|_| "the main thread did not answer".to_owned())?
                .map_err(str::to_owned)?;
            Ok(Self {
                app: app.clone(),
                label: label.to_owned(),
                views: Arc::new(Mutex::new(Some(views))),
                image: Arc::default(),
                image_in_flight: Arc::default(),
                surfaces: Mutex::new(Surfaces::new()),
                geometry: Arc::default(),
                geometry_in_flight: Arc::default(),
            })
        }

        pub(super) fn set_geometry(&self, geometry: &PanelGeometry) {
            *lock(&self.geometry) = Some(geometry.clone());
            if self.geometry_in_flight.swap(true, Ordering::AcqRel) {
                return;
            }
            let (views, mailbox, in_flight) = (
                self.views.clone(),
                self.geometry.clone(),
                self.geometry_in_flight.clone(),
            );
            let sent = self.app.run_on_main_thread(move || {
                in_flight.store(false, Ordering::Release);
                let Some(geometry) = lock(&mailbox).take() else {
                    return;
                };
                if let Some(views) = *lock(&views) {
                    // SAFETY: on the main thread, read from the slot.
                    let (clip, picture) = unsafe { views.get() };
                    apply(clip, picture, &geometry);
                }
            });
            if sent.is_err() {
                self.geometry_in_flight.store(false, Ordering::Release);
            }
        }

        pub(super) fn show(&self, width: u32, height: u32, bgra: &[u8]) {
            // Written here, on the panel's thread: the main thread only points
            // the layer at it. Every surface still in use, and the frame is
            // skipped — the panel keeps the one it shows.
            let Some(frame) = lock(&self.surfaces).fill(width, height, bgra) else {
                return;
            };
            *lock(&self.image) = Some(frame);
            if self.image_in_flight.swap(true, Ordering::AcqRel) {
                return;
            }
            let (views, mailbox, in_flight) = (
                self.views.clone(),
                self.image.clone(),
                self.image_in_flight.clone(),
            );
            let sent = self.app.run_on_main_thread(move || {
                // Cleared before the frame is taken, so one arriving while this
                // runs starts a job of its own rather than being stranded.
                in_flight.store(false, Ordering::Release);
                let Some(frame) = lock(&mailbox).take() else {
                    return;
                };
                let Some(views) = *lock(&views) else {
                    return;
                };
                // SAFETY: on the main thread, read from the slot.
                let (_, picture) = unsafe { views.get() };
                if let Some(layer) = picture.layer() {
                    // SAFETY: an IOSurface is a valid `contents` value.
                    quietly(|| unsafe { layer.setContents(Some(frame.as_contents())) });
                }
            });
            if sent.is_err() {
                self.image_in_flight.store(false, Ordering::Release);
            }
        }
    }

    impl Drop for Panel {
        fn drop(&mut self) {
            let (views, label) = (self.views.clone(), self.label.clone());
            let _ = self.app.run_on_main_thread(move || {
                let Some(taken) = lock(&views).take() else {
                    return;
                };
                // SAFETY: retained in `new_views`; taken out of the slot, this
                // is the one release of each, on the main thread.
                unsafe {
                    if let Some(clip) = Retained::from_raw(taken.clip.0 as *mut NSView) {
                        clip.removeFromSuperview();
                    }
                    drop(Retained::from_raw(taken.picture.0 as *mut NSView));
                }
                release_host(&label);
            });
        }
    }

    /// Run `change` with Core Animation's implicit animations off, as the
    /// audience view does: a new frame replaces the last at once.
    fn quietly(change: impl FnOnce()) {
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        change();
        CATransaction::commit();
    }

    /// The window's host view, made the first time a panel of it needs one:
    /// under the webview, which stops painting its own background so the
    /// page's clear parts show what is below.
    fn host_for<'a>(
        marker: MainThreadMarker,
        label: &str,
        webview: &'a NSView,
    ) -> Result<&'a NSView, &'static str> {
        let mut hosts = hosts();
        if let Some(host) = hosts.get_mut(label) {
            // SAFETY: retained when the host was made, released only when its
            // last panel goes, on this thread.
            let view = unsafe { &*(host.view.0 as *const NSView) };
            // The same window still: one closed and opened again under its
            // label has a new webview, and the old host went with the old.
            if host.webview == Address(std::ptr::from_ref(webview) as usize)
                && unsafe { view.superview() }.is_some()
            {
                host.panels += 1;
                return Ok(view);
            }
            if let Some(stale) = hosts.remove(label) {
                release(stale);
            }
        }
        let parent = unsafe { webview.superview() }.ok_or("the webview has no parent view")?;
        let view = NSView::initWithFrame(marker.alloc(), webview.frame());
        view.setWantsLayer(true);
        view.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        parent.addSubview_positioned_relativeTo(&view, NSWindowOrderingMode::Below, Some(webview));
        set_draws_background(webview, false);
        let address = Address(Retained::into_raw(view) as usize);
        hosts.insert(
            label.to_owned(),
            Host {
                view: address,
                webview: Address(Retained::into_raw(webview.retain()) as usize),
                panels: 1,
            },
        );
        // SAFETY: just retained into the map, which keeps it until its last
        // panel goes, on this thread.
        Ok(unsafe { &*(address.0 as *const NSView) })
    }

    /// One panel fewer in `label`'s window; the host goes with the last.
    fn release_host(label: &str) {
        let mut hosts = hosts();
        let Some(host) = hosts.get_mut(label) else {
            return;
        };
        host.panels = host.panels.saturating_sub(1);
        if host.panels > 0 {
            return;
        }
        if let Some(host) = hosts.remove(label) {
            release(host);
        }
    }

    /// Take a host's view away and let go of it and its webview. The webview
    /// keeps not painting its background: turned back on, its layers would be
    /// built opaque again and the next panel would not show through.
    fn release(host: Host) {
        // SAFETY: both retained in `host_for`; removed from the map, this is
        // the one release of each, on the main thread.
        unsafe {
            if let Some(view) = Retained::from_raw(host.view.0 as *mut NSView) {
                view.removeFromSuperview();
            }
            drop(Retained::from_raw(host.webview.0 as *mut NSView));
        }
    }

    /// A panel's views, in `host`, hidden until it is placed.
    fn new_views(marker: MainThreadMarker, host: &NSView) -> Views {
        let clip = NSView::initWithFrame(marker.alloc(), rect([0.0; 4]));
        clip.setWantsLayer(true);
        clip.setHidden(true);
        if let Some(layer) = clip.layer() {
            layer.setMasksToBounds(true);
        }
        let picture = NSView::initWithFrame(marker.alloc(), rect([0.0; 4]));
        picture.setWantsLayer(true);
        // The picture is what is set on the layer, and AppKit never draws
        // over it: a held frame stays when the window redraws around it.
        picture.setLayerContentsRedrawPolicy(NSViewLayerContentsRedrawPolicy::Never);
        // Fitted inside the panel, as the page's `object-contain` did.
        picture.setLayerContentsPlacement(NSViewLayerContentsPlacement::ScaleProportionallyToFit);
        if let Some(layer) = picture.layer() {
            // Black around the picture, as the page's video box was.
            layer.setBackgroundColor(Some(&CGColor::new_srgb(0.0, 0.0, 0.0, 1.0)));
        }
        clip.addSubview(&picture);
        host.addSubview(&clip);
        Views {
            clip: Address(Retained::into_raw(clip) as usize),
            picture: Address(Retained::into_raw(picture) as usize),
        }
    }

    fn rect([x, y, width, height]: [f64; 4]) -> CGRect {
        CGRect {
            origin: CGPoint { x, y },
            size: CGSize {
                width: width.max(0.0),
                height: height.max(0.0),
            },
        }
    }

    /// Put a panel's views where the page says it is. The page measures from
    /// the top; AppKit's views count up from the bottom unless flipped.
    fn apply(clip: &NSView, picture: &NSView, geometry: &PanelGeometry) {
        let [clip_x, clip_y, clip_width, clip_height] = geometry.clip;
        let [x, y, width, height] = geometry.rect;
        let shown = geometry.visible && clip_width >= 1.0 && clip_height >= 1.0;
        clip.setHidden(!shown);
        if !shown {
            return;
        }
        let Some(host) = (unsafe { clip.superview() }) else {
            return;
        };
        // The page's y counts down from the top of its viewport, which can
        // start below the webview's own top — under a title bar the webview
        // runs beneath. Its bottom is the webview's bottom, so measured from
        // there the two agree.
        let host_height = host.bounds().size.height;
        let viewport_height = if geometry.viewport[1] > 0.0 {
            geometry.viewport[1].min(host_height)
        } else {
            host_height
        };
        let from_top = |top: f64, height: f64, within: f64, flipped: bool| {
            if flipped {
                top
            } else {
                within - top - height
            }
        };
        let clip_top = if host.isFlipped() {
            clip_y + (host_height - viewport_height)
        } else {
            clip_y
        };
        clip.setFrame(rect([
            clip_x,
            from_top(clip_top, clip_height, viewport_height, host.isFlipped()),
            clip_width,
            clip_height,
        ]));
        picture.setFrame(rect([
            x - clip_x,
            from_top(y - clip_y, height, clip_height, clip.isFlipped()),
            width,
            height,
        ]));
        // Rounded as the panel's box is, while all of it shows: the page
        // leaves the corners outside the curve painted (`useNativePanel`).
        let whole = (clip_x - x).abs() < 0.5
            && (clip_y - y).abs() < 0.5
            && (clip_width - width).abs() < 0.5
            && (clip_height - height).abs() < 0.5;
        if let Some(layer) = clip.layer() {
            let corners = corner_mask(geometry.corners, clip.isFlipped());
            quietly(|| {
                if whole && geometry.radius > 0.0 && corners.0 != 0 {
                    layer.setCornerRadius(geometry.radius);
                    layer.setMaskedCorners(corners);
                } else {
                    layer.setCornerRadius(0.0);
                }
            });
        }
    }

    /// The page's corners — top-left 1, top-right 2, bottom-left 4,
    /// bottom-right 8 — as Core Animation names them: by the smaller and
    /// larger y, which is the top of a flipped view and the bottom of one
    /// that is not.
    fn corner_mask(corners: u8, flipped: bool) -> CACornerMask {
        let (top_left, top_right, bottom_left, bottom_right) = if flipped {
            (
                CACornerMask::LayerMinXMinYCorner,
                CACornerMask::LayerMaxXMinYCorner,
                CACornerMask::LayerMinXMaxYCorner,
                CACornerMask::LayerMaxXMaxYCorner,
            )
        } else {
            (
                CACornerMask::LayerMinXMaxYCorner,
                CACornerMask::LayerMaxXMaxYCorner,
                CACornerMask::LayerMinXMinYCorner,
                CACornerMask::LayerMaxXMinYCorner,
            )
        };
        let mut mask = CACornerMask(0);
        for (bit, corner) in [
            (1, top_left),
            (2, top_right),
            (4, bottom_left),
            (8, bottom_right),
        ] {
            if corners & bit != 0 {
                mask |= corner;
            }
        }
        mask
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(width: f64, height: f64, dpr: f64) -> PanelGeometry {
        PanelGeometry {
            rect: [10.0, 20.0, width, height],
            clip: [10.0, 20.0, width, height],
            visible: true,
            active: true,
            viewport: [1920.0, 1080.0],
            dpr,
            radius: 0.0,
            corners: 0,
        }
    }

    #[test]
    fn a_panel_is_drawn_at_its_size_in_device_pixels_and_no_more_than_960_across() {
        assert_eq!(geometry(640.0, 360.0, 1.0).pixel_size(), (640, 360));
        assert_eq!(geometry(400.0, 225.0, 2.0).pixel_size(), (800, 450));
        // A Retina center pane: the shape kept, at most 960 across.
        assert_eq!(geometry(930.0, 523.0, 2.0).pixel_size(), (960, 540));
        assert_eq!(geometry(300.0, 900.0, 2.0).pixel_size(), (320, 960));
        assert_eq!(
            geometry(0.0, f64::NAN, 2.0).pixel_size(),
            (16, 16),
            "never nothing"
        );
    }

    #[test]
    fn a_page_says_when_its_window_is_away_and_is_taken_as_shown_if_it_does_not() {
        let away: PanelGeometry = serde_json::from_str(
            r#"{"rect":[0,0,640,360],"clip":[0,0,640,360],"visible":true,"active":false,"dpr":2}"#,
        )
        .expect("parsed");
        assert!(away.visible && !away.active);
        let older: PanelGeometry = serde_json::from_str(
            r#"{"rect":[0,0,640,360],"clip":[0,0,640,360],"visible":true,"dpr":2}"#,
        )
        .expect("parsed");
        assert!(older.active, "a page that does not say is being shown");
    }

    #[test]
    fn the_page_describes_a_panel_in_its_own_words() {
        let parsed: PanelGeometry = serde_json::from_str(
            r#"{"rect":[0,0,640,360],"clip":[0,0,640,300],
                "visible":true,"dpr":2,"radius":8,"corners":3}"#,
        )
        .expect("parsed");
        assert_eq!(parsed.corners, 3);
        assert_eq!(parsed.pixel_size(), (960, 540));
        let bare: PanelGeometry =
            serde_json::from_str(r#"{"rect":[0,0,1,1],"clip":[0,0,1,1],"visible":false,"dpr":1}"#)
                .expect("parsed without the optional parts");
        assert_eq!(bare.radius, 0.0);
    }
}
