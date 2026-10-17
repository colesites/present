//! The native view under the audience window's webview, on macOS.
//!
//! A layer-backed `NSView` inserted directly below the `WKWebView` in the
//! window's content view, sized with it. Each frame is written into an
//! IOSurface on the surface thread (`iosurface.rs`) and set as the view layer's
//! contents on the main thread — AppKit and Core Animation are
//! main-thread-only, and only the handover crosses: no copy and no colour
//! matching is left for the main thread to do.
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
use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::{msg_send, MainThreadMarker, Message};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};
use objc2_foundation::{ns_string, NSNumber};
use objc2_quartz_core::CATransaction;
use tauri::{AppHandle, Manager};

use super::iosurface::{Frame, Surfaces};
use super::Presenter;

/// The view, retained, as an address the surface thread may carry but never
/// dereference. Only the main thread touches what it points at.
#[derive(Clone, Copy)]
struct ViewAddress(usize);

/// The view while it is there. `Drop`'s job takes it out and releases it, on
/// the main thread; a frame's job that runs after that finds nothing to draw
/// on.
///
/// An address alone is not enough. `run_on_main_thread` called *on* the main
/// thread runs the job there and then, ahead of every job already queued —
/// and a window closing drops its presenter on the main thread. The view was
/// released while a frame queued a moment before was still waiting to be put
/// on it, and that frame crashed the app. A playing video, in a composer
/// region or behind a passage, keeps a frame always on its way.
type SharedView = Arc<std::sync::Mutex<Option<ViewAddress>>>;

fn lock_view(view: &SharedView) -> std::sync::MutexGuard<'_, Option<ViewAddress>> {
    view.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub struct MacPresenter {
    app: AppHandle,
    label: String,
    view: SharedView,
    /// The webview whose background was turned off, to turn back on. Retained,
    /// like the view: the window can close, and another open under the same
    /// label, before this is dropped, and an address alone would then point at
    /// a freed webview.
    webview: ViewAddress,
    /// A job is on its way to the main thread to show whatever is in
    /// [`Self::mailbox`].
    in_flight: Arc<AtomicBool>,
    /// The newest frame not yet shown. One slot, replaced by each new frame, so
    /// a busy main thread never builds a backlog of nine-megabyte images — and
    /// it is the newest frame that lands when the main thread gets to it.
    ///
    /// It used to keep the frame already in flight and drop the one that
    /// arrived after it, which is the opposite: any moment the operator's own
    /// window kept the main thread busy cost the audience a frame of video
    /// that was never retried, because the loop had already counted it shown.
    mailbox: Arc<std::sync::Mutex<Option<Arc<Frame>>>>,
    /// The surfaces frames are written into, reused once the window server has
    /// let go of them.
    surfaces: Surfaces,
    /// The window's size and when it was read. Reading it is a round trip to
    /// the main thread; sixty of those a second is load the main thread does
    /// not need for a window that is fullscreen on a projector and never
    /// resizes. A resize shows stretched for at most [`SIZE_REFRESH`].
    size: Cell<Option<SizeReading>>,
}

const SIZE_REFRESH: Duration = Duration::from_millis(250);

/// When the size was read, and what it and the scale were — `None` for a
/// window gone.
type SizeReading = (Instant, Option<((u32, u32), f64)>);

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
            view: Arc::new(std::sync::Mutex::new(Some(ViewAddress(view)))),
            webview: ViewAddress(webview),
            in_flight: Arc::new(AtomicBool::new(false)),
            mailbox: Arc::new(std::sync::Mutex::new(None)),
            surfaces: Surfaces::new(),
            size: Cell::new(None),
        })
    }
}

/// Turn a `WKWebView`'s own background painting off or on.
pub(super) fn set_draws_background(webview: &NSView, draws: bool) {
    let value = NSNumber::numberWithBool(draws);
    // SAFETY: `drawsBackground` is a KVC key WKWebView answers on every macOS
    // this app supports (wry relies on it); the value is an NSNumber boolean.
    unsafe {
        let _: () = msg_send![webview, setValue: &*value, forKey: ns_string!("drawsBackground")];
    }
}

impl Presenter for MacPresenter {
    fn present(&mut self, width: u32, height: u32, bgra: Arc<Vec<u8>>) -> Result<(), String> {
        let Some(frame) = self.surfaces.fill(width, height, &bgra) else {
            // Every surface is still on screen or on its way there: this frame
            // is skipped, and the next is written when one is free.
            return Ok(());
        };
        // Newest wins: this replaces a frame the main thread has not got to.
        *self
            .mailbox
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(frame);
        // A job already on its way will show it; only start one if none is.
        if self.in_flight.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let view = self.view.clone();
        let in_flight = self.in_flight.clone();
        let mailbox = self.mailbox.clone();

        self.app
            .run_on_main_thread(move || {
                // Cleared before the frame is taken, so a frame arriving while
                // this runs starts a job of its own rather than being stranded.
                in_flight.store(false, Ordering::Release);
                let Some(frame) = mailbox
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .take()
                else {
                    return;
                };
                let Some(view) = *lock_view(&view) else {
                    // The window has closed.
                    return;
                };
                // SAFETY: the view was retained in `attach`, and is released
                // only once `Drop`'s job has taken it out of the slot — on
                // this thread, so not while this runs.
                let view = unsafe { &*(view.0 as *const NSView) };
                if let Some(layer) = view.layer() {
                    CATransaction::begin();
                    CATransaction::setDisableActions(true);
                    // SAFETY: an IOSurface is a valid `contents` value.
                    unsafe { layer.setContents(Some(frame.as_contents())) };
                    CATransaction::commit();
                }
            })
            .map_err(|error| {
                self.in_flight.store(false, Ordering::Relaxed);
                error.to_string()
            })
    }

    fn size(&self) -> Option<(u32, u32)> {
        self.reading().map(|(size, _)| size)
    }

    fn scale(&self) -> f64 {
        self.reading().map_or(1.0, |(_, scale)| scale)
    }
}

impl MacPresenter {
    /// The window's size in its CSS pixels, and its scale, read at most
    /// every [`SIZE_REFRESH`].
    fn reading(&self) -> Option<((u32, u32), f64)> {
        if let Some((read_at, reading)) = self.size.get() {
            if read_at.elapsed() < SIZE_REFRESH {
                return reading;
            }
        }
        let reading = self.read_size();
        self.size.set(Some((Instant::now(), reading)));
        reading
    }

    fn read_size(&self) -> Option<((u32, u32), f64)> {
        let window = self.app.get_webview_window(&self.label)?;
        let physical = window.inner_size().ok()?;
        let scale = window.scale_factor().ok()?;
        let width = (f64::from(physical.width) / scale).round() as u32;
        let height = (f64::from(physical.height) / scale).round() as u32;
        (width > 0 && height > 0).then_some(((width, height), scale))
    }
}

impl Drop for MacPresenter {
    fn drop(&mut self) {
        let (view, webview) = (self.view.clone(), self.webview);
        let _ = self.app.run_on_main_thread(move || {
            let taken = lock_view(&view).take();
            // SAFETY: retained in `attach`; taken out of the slot, this is the
            // one release.
            if let Some(view) =
                taken.and_then(|view| unsafe { Retained::from_raw(view.0 as *mut NSView) })
            {
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
