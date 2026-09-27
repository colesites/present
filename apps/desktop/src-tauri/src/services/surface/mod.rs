//! The audience window drawn by the compositor instead of the webview. Opt-in.
//!
//! ADR-001's surface swap. The owner's call is that it ships behind a setting,
//! with the webview output the default until a full service and the two-monitor
//! test have run on it: this is the change in the migration most able to put a
//! black screen in front of a congregation.
//!
//! ```text
//! audience window
//!   ├─ WKWebView, transparent — YouTube, capture, NDI and video props only
//!   └─ native view below it   — every frame the compositor draws
//! ```
//!
//! **The webview stays the fallback, not a second renderer to reconcile.** It
//! draws the whole output exactly as before until this module says frames are on
//! screen, and goes back to drawing all of it the moment they stop. A failure
//! here costs the swap, never the picture.
//!
//! Platform code is in `macos.rs`. Windows and Linux have no native view, so the
//! setting has no effect there and the webview draws, as it always has.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::services::screen_picture::{arrange, Arrangement};

#[cfg(target_os = "macos")]
pub mod macos;
pub mod stream;

/// What goes on the native view. Frames are premultiplied BGRA, top row first.
pub trait Presenter: Send {
    /// Show a frame. The same frame may be shown by every output of a
    /// mirrored screen at once.
    fn present(&mut self, width: u32, height: u32, bgra: Arc<Vec<u8>>) -> Result<(), String>;
    /// The window's size in its CSS pixels, or `None` if the window has gone.
    fn size(&self) -> Option<(u32, u32)>;
    /// Its pixels to a CSS pixel.
    fn scale(&self) -> f64 {
        1.0
    }
}

/// One output window a screen is drawn for, as its source is told of it.
#[derive(Debug, Clone, PartialEq)]
pub struct OutputView {
    pub label: String,
    /// In the window's CSS pixels.
    pub size: (u32, u32),
    pub scale: f64,
}

/// Draws a screen's picture into a buffer it is handed, and says whether it
/// differs from the last one — a static slide is not handed to the views sixty
/// times a second.
pub trait SurfaceSource: Send {
    fn render(&mut self, views: &[OutputView], out: &mut Vec<u8>) -> Result<bool, String>;
    /// The size of the picture the last render drew.
    fn canvas_size(&self) -> (u32, u32);
    /// How the output window `label` shows the picture, as of the last
    /// render. `None`: all of it, stretched to the window.
    fn arrangement(&self, _label: &str) -> Option<Arrangement> {
        None
    }
}

/// What the audience window is told, so it knows whether to draw everything
/// itself or only the props the compositor leaves to it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceStatus {
    /// Frames are on the native view right now. Only then may the webview stop
    /// drawing the output itself.
    pub presenting: bool,
    /// This platform has a native view at all.
    pub supported: bool,
}

/// The display's refresh, which is as often as a new frame can be seen.
pub const TICK: Duration = Duration::from_micros(16_667);

/// How long after the first frame is handed to the view before the webview is
/// told it may stop drawing. Handing a frame over queues it for the main thread;
/// telling the webview too soon would clear its picture before the native one
/// had landed, and the audience would see the window's black in between.
pub const HANDOVER_DELAY: Duration = Duration::from_millis(100);

/// How long the native view stays after the webview is told to draw everything
/// again, so it has repainted before the view under it goes.
pub const HANDBACK_DELAY: Duration = Duration::from_millis(300);

/// A screen's output windows, by label, each with its view. Added to and
/// taken from while the screen is drawn.
pub type Presenters = Arc<Mutex<Vec<(String, Box<dyn Presenter>)>>>;

/// Told, for each window, when its view starts and stops showing frames.
pub type OnPresenting = Arc<dyn Fn(&str, bool) + Send + Sync>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// How one window's view is getting on.
#[derive(Default)]
struct ViewState {
    first_presented: Option<Instant>,
    presenting: bool,
    refused: u32,
    /// Its own frame, for an output that shows part of the picture.
    arranged: Vec<u8>,
}

/// Run until `stop` is set or every window has gone. `on_presenting` is told,
/// for each window, when its first frame lands and when frames stop, so its
/// webview can hand over and take back.
///
/// The picture is drawn once a tick for all of the screen's windows, and
/// each window shows it whole or its own part of it.
pub fn run(
    mut source: impl SurfaceSource,
    presenters: Presenters,
    stop: &AtomicBool,
    on_presenting: &(dyn Fn(&str, bool) + Send + Sync),
) {
    let mut buffer = Vec::new();
    let mut states: HashMap<String, ViewState> = HashMap::new();
    let mut failures = 0u32;

    while !stop.load(Ordering::Relaxed) {
        let started = Instant::now();
        let mut views = lock(&presenters);

        // A window that has gone takes its view with it.
        views.retain(|(label, presenter)| {
            let alive = presenter.size().is_some();
            if !alive && states.remove(label).is_some_and(|state| state.presenting) {
                on_presenting(label, false);
            }
            alive
        });
        if views.is_empty() {
            break;
        }
        let sizes: Vec<OutputView> = views
            .iter()
            .filter_map(|(label, presenter)| {
                presenter.size().map(|size| OutputView {
                    label: label.clone(),
                    size,
                    scale: presenter.scale(),
                })
            })
            .collect();

        match source.render(&sizes, &mut buffer) {
            Ok(changed) if !buffer.is_empty() => {
                failures = 0;
                let canvas = source.canvas_size();
                let mut whole: Option<Arc<Vec<u8>>> = None;
                let mut refused = Vec::new();
                for (label, presenter) in views.iter_mut() {
                    let state = states.entry(label.clone()).or_default();
                    if !changed && state.first_presented.is_some() {
                        continue;
                    }
                    let arrangement = source.arrangement(label).filter(|each| !each.is_identity());
                    let (size, frame) = match (arrangement, presenter.size()) {
                        (Some(arrangement), Some(size)) => {
                            arrange(&buffer, canvas, &mut state.arranged, size, &arrangement);
                            (size, Arc::new(state.arranged.clone()))
                        }
                        _ => (
                            canvas,
                            whole
                                .get_or_insert_with(|| Arc::new(buffer.clone()))
                                .clone(),
                        ),
                    };
                    match presenter.present(size.0, size.1, frame) {
                        Ok(()) => {
                            state.refused = 0;
                            state.first_presented.get_or_insert(started);
                        }
                        Err(error) => {
                            state.refused += 1;
                            tracing::error!(%error, label, "a native audience view refused a frame");
                            if state.refused >= 3 {
                                refused.push(label.clone());
                            }
                        }
                    }
                }
                // A view that keeps refusing hands its window back to the
                // webview. Better a webview output than a frozen native one.
                views.retain(|(label, _)| {
                    if !refused.contains(label) {
                        return true;
                    }
                    if states.remove(label).is_some_and(|state| state.presenting) {
                        on_presenting(label, false);
                    }
                    false
                });
            }
            Ok(_) => failures = 0,
            Err(error) => {
                failures += 1;
                tracing::error!(%error, "a screen's frame could not be drawn natively");
            }
        }
        drop(views);

        for (label, state) in &mut states {
            if !state.presenting
                && state
                    .first_presented
                    .is_some_and(|at| started.saturating_duration_since(at) >= HANDOVER_DELAY)
            {
                state.presenting = true;
                on_presenting(label, true);
            }
        }

        // A few failures in a row and the webviews take the picture back.
        if failures >= 3 {
            break;
        }

        if let Some(rest) = TICK.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }

    let handing_back: Vec<&String> = states
        .iter()
        .filter(|(_, state)| state.presenting)
        .map(|(label, _)| label)
        .collect();
    for label in &handing_back {
        on_presenting(label, false);
    }
    if !handing_back.is_empty() {
        // The presenters are dropped after this returns, which takes the
        // views away.
        std::thread::sleep(HANDBACK_DELAY);
    }
}

/// A running surface on its own thread: one screen, drawn for each of its
/// output windows.
pub struct SurfaceWorker {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
    presenters: Presenters,
}

impl SurfaceWorker {
    pub fn spawn(
        source: impl SurfaceSource + 'static,
        presenters: Vec<(String, Box<dyn Presenter>)>,
        on_presenting: OnPresenting,
    ) -> std::io::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let presenters: Presenters = Arc::new(Mutex::new(presenters));
        let shared = presenters.clone();
        let handle = std::thread::Builder::new()
            .name("audience-surface".to_owned())
            .spawn(move || run(source, shared, &flag, on_presenting.as_ref()))?;
        Ok(Self {
            stop,
            handle: Some(handle),
            presenters,
        })
    }

    /// Draw for another window too. `false` if the loop has already
    /// finished, and a new worker is needed.
    pub fn add(&self, label: &str, presenter: Box<dyn Presenter>) -> bool {
        if self.is_finished() || self.is_stopping() {
            return false;
        }
        let mut views = lock(&self.presenters);
        views.retain(|(existing, _)| existing != label);
        views.push((label.to_owned(), presenter));
        true
    }

    /// Stop drawing for a window. Its view goes when the presenter is dropped.
    pub fn remove(&self, label: &str) {
        lock(&self.presenters).retain(|(existing, _)| existing != label);
    }

    /// Which windows it draws for.
    pub fn labels(&self) -> Vec<String> {
        lock(&self.presenters)
            .iter()
            .map(|(label, _)| label.clone())
            .collect()
    }

    /// The loop has returned, and with it the views are on their way out.
    pub fn is_finished(&self) -> bool {
        self.handle
            .as_ref()
            .is_none_or(|handle| handle.is_finished())
    }

    /// Told to stop, whether or not it has yet.
    pub fn is_stopping(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    /// Ask the loop to stop, without waiting for it.
    ///
    /// Never joined: this is called from the main thread when a window
    /// closes, and the loop's last acts — asking the windows their size,
    /// removing the views — need the main thread. Waiting for it there would
    /// deadlock.
    pub fn signal_stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for SurfaceWorker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::atomic::AtomicUsize;

    use super::*;

    struct Scripted {
        results: VecDeque<Result<bool, String>>,
        stop: Arc<AtomicBool>,
    }

    impl SurfaceSource for Scripted {
        fn render(&mut self, views: &[OutputView], out: &mut Vec<u8>) -> Result<bool, String> {
            let size = views.first().map_or((4, 4), |view| view.size);
            out.clear();
            out.resize((size.0 * size.1 * 4) as usize, 0);
            let next = self.results.pop_front().unwrap_or(Ok(false));
            if self.results.is_empty() {
                self.stop.store(true, Ordering::Relaxed);
            }
            next
        }

        fn canvas_size(&self) -> (u32, u32) {
            (4, 4)
        }
    }

    struct Counting {
        presented: Arc<AtomicUsize>,
        refuse: bool,
        gone: bool,
    }

    impl Presenter for Counting {
        fn present(&mut self, width: u32, height: u32, bgra: Arc<Vec<u8>>) -> Result<(), String> {
            assert_eq!(bgra.len(), (width * height * 4) as usize);
            if self.refuse {
                return Err("no layer".to_owned());
            }
            self.presented.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }

        fn size(&self) -> Option<(u32, u32)> {
            (!self.gone).then_some((4, 4))
        }
    }

    /// Enough unchanged ticks after a frame for the handover delay to pass.
    fn quiet_ticks() -> impl Iterator<Item = Result<bool, String>> {
        let ticks = HANDOVER_DELAY.as_micros().div_ceil(TICK.as_micros()) as usize + 2;
        (0..ticks).map(|_| Ok(false))
    }

    type Seen = Arc<Mutex<Vec<bool>>>;

    fn events() -> (Seen, impl Fn(&str, bool) + Send + Sync) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        (seen, move |_: &str, presenting| {
            log.lock().unwrap().push(presenting)
        })
    }

    /// One window, as the Output is.
    fn one(counting: Counting) -> Presenters {
        let presenter: Box<dyn Presenter> = Box::new(counting);
        Arc::new(Mutex::new(vec![("output".to_owned(), presenter)]))
    }

    #[test]
    fn a_static_slide_is_presented_once_and_changes_are_presented_as_they_come() {
        let stop = Arc::new(AtomicBool::new(false));
        let presented = Arc::new(AtomicUsize::new(0));
        let source = Scripted {
            results: [Ok(true)]
                .into_iter()
                .chain(quiet_ticks())
                .chain([Ok(true), Ok(false)])
                .collect(),
            stop: stop.clone(),
        };
        let (seen, on_presenting) = events();
        run(
            source,
            one(Counting {
                presented: presented.clone(),
                refuse: false,
                gone: false,
            }),
            &stop,
            &on_presenting,
        );

        assert_eq!(presented.load(Ordering::Relaxed), 2);
        assert_eq!(
            *seen.lock().unwrap(),
            [true, false],
            "handed over, then handed back on stop"
        );
    }

    #[test]
    fn repeated_failures_hand_the_picture_back_to_the_webview() {
        let stop = Arc::new(AtomicBool::new(false));
        let source = Scripted {
            results: [Ok(true)]
                .into_iter()
                .chain(quiet_ticks())
                .chain([Err("x".into()), Err("x".into()), Err("x".into()), Ok(true)])
                .collect(),
            stop: stop.clone(),
        };
        let (seen, on_presenting) = events();
        run(
            source,
            one(Counting {
                presented: Arc::default(),
                refuse: false,
                gone: false,
            }),
            &stop,
            &on_presenting,
        );
        assert_eq!(*seen.lock().unwrap(), [true, false]);
        assert!(
            !stop.load(Ordering::Relaxed),
            "it gave up rather than running to the end"
        );
    }

    #[test]
    fn the_webview_is_not_told_to_step_back_the_moment_a_frame_is_handed_over() {
        let stop = Arc::new(AtomicBool::new(false));
        let source = Scripted {
            results: VecDeque::from([Ok(true), Ok(false)]),
            stop: stop.clone(),
        };
        let (seen, on_presenting) = events();
        run(
            source,
            one(Counting {
                presented: Arc::default(),
                refuse: false,
                gone: false,
            }),
            &stop,
            &on_presenting,
        );
        assert!(
            seen.lock().unwrap().is_empty(),
            "stopped inside the handover delay, so the webview never cleared its picture"
        );
    }

    #[test]
    fn an_unchanged_frame_between_failures_resets_the_count() {
        let stop = Arc::new(AtomicBool::new(false));
        let source = Scripted {
            results: VecDeque::from([
                Ok(true),
                Err("x".into()),
                Err("x".into()),
                Ok(false),
                Err("x".into()),
                Err("x".into()),
                Ok(false),
            ]),
            stop: stop.clone(),
        };
        let (_, on_presenting) = events();
        run(
            source,
            one(Counting {
                presented: Arc::default(),
                refuse: false,
                gone: false,
            }),
            &stop,
            &on_presenting,
        );
        assert!(stop.load(Ordering::Relaxed), "ran to the end of the script");
    }

    #[test]
    fn a_view_that_never_takes_a_frame_never_claims_the_picture() {
        let stop = Arc::new(AtomicBool::new(false));
        let source = Scripted {
            results: (0..12).map(|_| Ok(true)).collect(),
            stop: stop.clone(),
        };
        let (seen, on_presenting) = events();
        run(
            source,
            one(Counting {
                presented: Arc::default(),
                refuse: true,
                gone: false,
            }),
            &stop,
            &on_presenting,
        );
        assert!(
            seen.lock().unwrap().is_empty(),
            "the webview never stopped drawing"
        );
    }

    #[test]
    fn a_closed_window_ends_the_loop() {
        let stop = AtomicBool::new(false);
        let source = Scripted {
            results: (0..100).map(|_| Ok(true)).collect(),
            stop: Arc::new(AtomicBool::new(false)),
        };
        let (seen, on_presenting) = events();
        run(
            source,
            one(Counting {
                presented: Arc::default(),
                refuse: false,
                gone: true,
            }),
            &stop,
            &on_presenting,
        );
        assert!(seen.lock().unwrap().is_empty());
    }
}
