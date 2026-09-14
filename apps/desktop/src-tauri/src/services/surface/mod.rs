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

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
pub mod macos;
pub mod stream;

/// What goes on the native view. Frames are premultiplied BGRA, top row first.
pub trait Presenter: Send {
    fn present(&mut self, width: u32, height: u32, bgra: Vec<u8>) -> Result<(), String>;
    /// The size to draw at, in the window's CSS pixels, or `None` if the window
    /// has gone.
    fn size(&self) -> Option<(u32, u32)>;
}

/// Draws one frame into a buffer it is handed, and says whether it differs
/// from the last one — a static slide is not handed to the view sixty times a
/// second.
pub trait SurfaceSource: Send {
    fn render(&mut self, size: (u32, u32), out: &mut Vec<u8>) -> Result<bool, String>;
}

/// The persisted choice.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceSetting {
    /// Draw the audience window natively. Off unless the operator turned it on.
    #[serde(default)]
    pub native: bool,
}

/// What the audience window is told, so it knows whether to draw everything
/// itself or only the props the compositor leaves to it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceStatus {
    /// The operator has turned it on.
    pub enabled: bool,
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

/// Run until `stop` is set or the window goes. `on_presenting` is told when the
/// first frame lands and when frames stop, so the webview can hand over and
/// take back.
pub fn run(
    mut source: impl SurfaceSource,
    mut presenter: impl Presenter,
    stop: &AtomicBool,
    on_presenting: &(dyn Fn(bool) + Send + Sync),
) {
    let mut buffer = Vec::new();
    let mut presenting = false;
    let mut first_presented: Option<Instant> = None;
    let mut failures = 0u32;

    while !stop.load(Ordering::Relaxed) {
        let started = Instant::now();
        let Some(size) = presenter.size() else {
            break;
        };

        match source.render(size, &mut buffer) {
            Ok(changed) if (changed || first_presented.is_none()) && !buffer.is_empty() => {
                // A copy: the view keeps the image it is given for as long as
                // it is on screen, and this buffer is drawn into again.
                match presenter.present(size.0, size.1, buffer.clone()) {
                    Ok(()) => {
                        failures = 0;
                        first_presented.get_or_insert(started);
                    }
                    Err(error) => {
                        failures += 1;
                        tracing::error!(%error, "the native audience view refused a frame");
                    }
                }
            }
            Ok(_) => failures = 0,
            Err(error) => {
                failures += 1;
                tracing::error!(%error, "the audience frame could not be drawn natively");
            }
        }

        if !presenting
            && first_presented
                .is_some_and(|at| started.saturating_duration_since(at) >= HANDOVER_DELAY)
        {
            presenting = true;
            on_presenting(true);
        }

        // A few failures in a row and the webview takes the picture back.
        // Better a webview output than a frozen native one.
        if failures >= 3 {
            break;
        }

        if let Some(rest) = TICK.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }

    if presenting {
        on_presenting(false);
        // The presenter is dropped as this returns, which takes the view away.
        std::thread::sleep(HANDBACK_DELAY);
    }
}

/// A running surface on its own thread.
pub struct SurfaceWorker {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl SurfaceWorker {
    pub fn spawn(
        source: impl SurfaceSource + 'static,
        presenter: impl Presenter + 'static,
        on_presenting: Arc<dyn Fn(bool) + Send + Sync>,
    ) -> std::io::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("audience-surface".to_owned())
            .spawn(move || run(source, presenter, &flag, on_presenting.as_ref()))?;
        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }

    /// The loop has returned, and with it the view is on its way out.
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
    /// Never joined: this is called from the main thread when the window
    /// closes, and the loop's last acts — asking the window its size, removing
    /// the view — need the main thread. Waiting for it there would deadlock.
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
    use std::sync::Mutex;

    use super::*;

    struct Scripted {
        results: VecDeque<Result<bool, String>>,
        stop: Arc<AtomicBool>,
    }

    impl SurfaceSource for Scripted {
        fn render(&mut self, size: (u32, u32), out: &mut Vec<u8>) -> Result<bool, String> {
            out.clear();
            out.resize((size.0 * size.1 * 4) as usize, 0);
            let next = self.results.pop_front().unwrap_or(Ok(false));
            if self.results.is_empty() {
                self.stop.store(true, Ordering::Relaxed);
            }
            next
        }
    }

    struct Counting {
        presented: Arc<AtomicUsize>,
        refuse: bool,
        gone: bool,
    }

    impl Presenter for Counting {
        fn present(&mut self, width: u32, height: u32, bgra: Vec<u8>) -> Result<(), String> {
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

    fn events() -> (Arc<Mutex<Vec<bool>>>, impl Fn(bool) + Send + Sync) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        (seen, move |presenting| log.lock().unwrap().push(presenting))
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
            Counting {
                presented: presented.clone(),
                refuse: false,
                gone: false,
            },
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
            Counting {
                presented: Arc::default(),
                refuse: false,
                gone: false,
            },
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
            Counting {
                presented: Arc::default(),
                refuse: false,
                gone: false,
            },
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
            Counting {
                presented: Arc::default(),
                refuse: false,
                gone: false,
            },
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
            Counting {
                presented: Arc::default(),
                refuse: true,
                gone: false,
            },
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
            Counting {
                presented: Arc::default(),
                refuse: false,
                gone: true,
            },
            &stop,
            &on_presenting,
        );
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn the_setting_is_off_unless_it_says_otherwise() {
        assert!(!SurfaceSetting::default().native);
        let parsed: SurfaceSetting = serde_json::from_str("{}").unwrap();
        assert!(!parsed.native);
    }
}
