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
use tauri::{AppHandle, Manager};

use std::collections::VecDeque;

use super::iosurface::{Frame, Surfaces};
use super::layers::{self, Fit, Layered};
use super::{LayeredShow, Presenter};
use crate::services::video::GpuPicture;

/// What the main thread is to put on the view next.
enum Shown {
    Whole(Arc<Frame>),
    Layers(Layered),
}

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
    mailbox: Arc<std::sync::Mutex<Option<Shown>>>,
    /// The surfaces frames are written into, reused once the window server has
    /// let go of them.
    surfaces: Surfaces,
    /// The slide over the video, as last written into a surface, and what it
    /// was written from: written again only when it changes.
    overlay: Option<(Arc<Vec<u8>>, Arc<Frame>)>,
    /// Video pictures handed to the view, newest last, each kept until the
    /// window server has let go of it: the decoder writes into a surface
    /// again only once nothing holds it.
    pictures: VecDeque<Arc<GpuPicture>>,
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
            overlay: None,
            pictures: VecDeque::new(),
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
        // A whole picture covers the layers; what they held can go.
        self.overlay = None;
        self.retire_pictures(None);
        self.show(Shown::Whole(frame))
    }

    fn shows_layers(&self) -> bool {
        true
    }

    fn present_layers(&mut self, show: &LayeredShow) -> Result<(), String> {
        let overlay = match &show.overlay {
            Some(drawn) => match &self.overlay {
                Some((from, frame)) if Arc::ptr_eq(from, drawn) => Some(Arc::clone(frame)),
                _ => match self.surfaces.fill(show.canvas.0, show.canvas.1, drawn) {
                    Some(frame) => {
                        self.overlay = Some((Arc::clone(drawn), Arc::clone(&frame)));
                        Some(frame)
                    }
                    // Every surface still in use: the slide as it was, until
                    // the next video frame tries again.
                    None => self.overlay.as_ref().map(|(_, frame)| Arc::clone(frame)),
                },
            },
            None => {
                self.overlay = None;
                None
            }
        };
        let video = show
            .video
            .as_ref()
            .map(|video| (Arc::clone(&video.picture), video.geometry));
        self.retire_pictures(video.as_ref().map(|(picture, _)| picture));
        self.show(Shown::Layers(Layered {
            canvas: show.canvas,
            base: show.base,
            video,
            overlay,
        }))
    }

    fn size(&self) -> Option<(u32, u32)> {
        self.reading().map(|(size, _)| size)
    }

    fn scale(&self) -> f64 {
        self.reading().map_or(1.0, |(_, scale)| scale)
    }
}

impl MacPresenter {
    /// Put `shown` on the view on the main thread: the newest wins.
    fn show(&mut self, shown: Shown) -> Result<(), String> {
        // Newest wins: this replaces a picture the main thread has not got to.
        *self
            .mailbox
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(shown);
        // A job already on its way will show it; only start one if none is.
        if self.in_flight.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let view = self.view.clone();
        let in_flight = self.in_flight.clone();
        let mailbox = self.mailbox.clone();

        self.app
            .run_on_main_thread(move || {
                // Cleared before the picture is taken, so one arriving while
                // this runs starts a job of its own rather than being stranded.
                in_flight.store(false, Ordering::Release);
                let Some(shown) = mailbox
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
                    // SAFETY: on the main thread; an IOSurface is a valid
                    // `contents` value.
                    unsafe {
                        match &shown {
                            Shown::Whole(frame) => layers::show_whole(&layer, frame.as_contents()),
                            Shown::Layers(layered) => {
                                layers::show_layered(&layer, layered, Fit::Stretch);
                            }
                        }
                    }
                }
            })
            .map_err(|error| {
                self.in_flight.store(false, Ordering::Relaxed);
                error.to_string()
            })
    }

    /// Keep `newest`, and every picture before it the window server still
    /// holds; let the rest go back to the decoder.
    fn retire_pictures(&mut self, newest: Option<&Arc<GpuPicture>>) {
        if let Some(newest) = newest {
            if !self
                .pictures
                .back()
                .is_some_and(|last| Arc::ptr_eq(last, newest))
            {
                self.pictures.push_back(Arc::clone(newest));
            }
        }
        let keep_last = usize::from(newest.is_some());
        let mut index = 0;
        while index + keep_last < self.pictures.len() {
            if self.pictures[index].is_in_use() {
                index += 1;
            } else {
                self.pictures.remove(index);
            }
        }
    }

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
