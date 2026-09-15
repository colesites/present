//! Browser mode: a web browser inside the operator window, which the operator
//! can project onto the audience output.
//!
//! Replaces `browser-view.service.ts`. Electron put a `BrowserView` over the
//! operator window's viewport and a second one over the audience window, and
//! polled the first every 180 ms for its scroll position and a small preview.
//! This does the same with two wry webviews (`view.rs`), built directly on the
//! windows' native views rather than through Tauri's webview manager:
//!
//! - Tauri's own child webviews need its `unstable` feature, which rebuilds
//!   every window's webview as a child view, and while a window holds a second
//!   webview Tauri stops treating it as a webview window — every command that
//!   takes the calling window, and every lookup by label, fails. The owner
//!   chose this route instead (stage-7-subsystems.md §10).
//! - A page browsed here gets no Tauri IPC script at all.
//!
//! [`BrowserMode`] is the service's logic, in the order Electron runs it,
//! against a [`Host`] that does what a `BrowserView` did. The rules it shares
//! with Electron are `rules.rs`, pinned by `tests/browser-mode.test.mjs`.

use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::sync::Mutex;

use crate::errors::AppResult;

pub mod rules;
pub mod suggestions;
#[cfg(desktop)]
pub mod view;

use rules::{Bounds, BrowserState, ProjectionTarget, RawBounds, BLANK};

/// Which of the two views.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    /// Over the operator window's viewport.
    Main,
    /// Filling the audience output window.
    Output,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum History {
    Back,
    Forward,
}

/// What `webContents` reported about its page.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Page {
    pub url: String,
    pub title: String,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub is_loading: bool,
}

/// What the views tell the service, from their own callbacks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Signal {
    LoadStarted(Role),
    LoadFinished(Role),
    TitleChanged(Role),
    /// ⌘L or Ctrl+L while the page had the keyboard (`before-input-event`).
    FocusAddress,
    /// `window.open` of a web address: Electron loaded it in the same view.
    OpenInView(Role, String),
    /// The audience window closed, and its view with it.
    OutputClosed,
}

/// What a `BrowserView` and its windows did for `browser-view.service.ts`.
pub trait Host: Send + Sync + 'static {
    /// The view's page, or `None` when there is no such view.
    fn page(&self, role: Role) -> impl Future<Output = Option<Page>> + Send;
    /// Create the view on `url`: the main one hidden in the operator window,
    /// the output one filling the audience window.
    fn create(&self, role: Role, url: String) -> impl Future<Output = AppResult<()>> + Send;
    fn destroy(&self, role: Role) -> impl Future<Output = ()> + Send;
    /// Show the main view over `bounds`, or hide it with `None`.
    fn place(&self, bounds: Option<Bounds>) -> impl Future<Output = ()> + Send;
    fn load(&self, role: Role, url: String) -> impl Future<Output = ()> + Send;
    fn reload(&self) -> impl Future<Output = ()> + Send;
    /// Go back or forward in the main view, if its history allows.
    fn go(&self, direction: History) -> impl Future<Output = ()> + Send;
    /// The main view's scroll position.
    fn scroll(&self) -> impl Future<Output = Option<(f64, f64)>> + Send;
    fn scroll_output_to(&self, x: f64, y: f64) -> impl Future<Output = ()> + Send;
    /// The main view as a PNG data URL, cropped to `viewport`'s shape.
    fn capture(&self, viewport: Bounds) -> impl Future<Output = Option<String>> + Send;
    /// `createOutputWindow`: open the audience window, or focus it.
    fn open_output_window(&self) -> impl Future<Output = AppResult<()>> + Send;
    fn emit_state(&self, state: &BrowserState);
    fn emit_focus_address(&self);
}

/// The longest `browserNavigate` waits for the page before answering.
const NAVIGATION_WAIT: Duration = Duration::from_secs(30);
const NAVIGATION_CHECK: Duration = Duration::from_millis(100);
/// A page whose script is stuck does not stall the poll behind it.
const SCROLL_READ_TIMEOUT: Duration = Duration::from_secs(1);
/// WebKit finishes a snapshot at the next paint, which a hidden window may
/// never have; the next capture is not held up behind it.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(3);

struct Shared {
    enabled: bool,
    bounds: Bounds,
    projection: ProjectionTarget,
    state: BrowserState,
    main_view: bool,
    output_view: bool,
}

pub struct BrowserMode<H: Host> {
    host: H,
    shared: Mutex<Shared>,
    poll: StdMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    poll_interval: Duration,
    capturing: AtomicBool,
}

impl<H: Host> BrowserMode<H> {
    pub fn new(host: H) -> Arc<Self> {
        Self::with_poll_interval(host, rules::SCROLL_SYNC_INTERVAL)
    }

    fn with_poll_interval(host: H, poll_interval: Duration) -> Arc<Self> {
        Arc::new(Self {
            host,
            shared: Mutex::new(Shared {
                enabled: false,
                bounds: Bounds::default(),
                projection: ProjectionTarget::Preview,
                state: BrowserState::default(),
                main_view: false,
                output_view: false,
            }),
            poll: StdMutex::new(None),
            poll_interval,
            capturing: AtomicBool::new(false),
        })
    }

    pub fn host(&self) -> &H {
        &self.host
    }

    /// `getBrowserState`.
    pub async fn state(&self) -> BrowserState {
        self.shared.lock().await.state.clone()
    }

    /// `setBrowserMode`.
    pub async fn set_enabled(self: &Arc<Self>, enabled: bool) -> AppResult<BrowserState> {
        let mut shared = self.shared.lock().await;
        shared.enabled = enabled;
        if !enabled {
            self.host.place(None).await;
            self.stop_poll();
            return Ok(shared.state.clone());
        }

        if !shared.main_view {
            // A new view has no page: it opens on the one to restore.
            let url = rules::restore_url(None, Some(&shared.state.url));
            self.host.create(Role::Main, url).await?;
            shared.main_view = true;
            self.host.place(Some(shared.bounds)).await;
        } else {
            self.host.place(Some(shared.bounds)).await;
            match self.host.page(Role::Main).await {
                Some(page) if !page.url.is_empty() && page.url != BLANK => {
                    self.apply_page(&mut shared, page);
                    self.sync_output_to_main(&shared).await;
                    self.capture(&shared);
                }
                _ => {
                    let url = rules::restore_url(None, Some(&shared.state.url));
                    self.host.load(Role::Main, url).await;
                }
            }
        }

        self.start_poll();
        Ok(shared.state.clone())
    }

    /// `setBrowserBounds`.
    pub async fn set_bounds(self: &Arc<Self>, bounds: RawBounds) -> BrowserState {
        let mut shared = self.shared.lock().await;
        shared.bounds = rules::clamp_browser_bounds(bounds);
        if !shared.enabled || !shared.main_view {
            return shared.state.clone();
        }
        self.host.place(Some(shared.bounds)).await;
        self.capture(&shared);
        shared.state.clone()
    }

    /// `navigateBrowserTo`. Answers once the page has loaded, as Electron's
    /// `await loadURL` did — or failed, which Electron threw instead.
    pub async fn navigate(self: &Arc<Self>, input: &str) -> AppResult<BrowserState> {
        let target = rules::normalize_navigation_input(input);
        {
            let mut shared = self.shared.lock().await;
            if shared.main_view {
                self.host.load(Role::Main, target).await;
            } else {
                self.host.create(Role::Main, target).await?;
                shared.main_view = true;
            }
        }

        self.wait_for_load().await;

        let mut shared = self.shared.lock().await;
        if let Some(page) = self.host.page(Role::Main).await {
            self.apply_page(&mut shared, page);
        }
        self.sync_output_to_main(&shared).await;
        self.capture(&shared);
        Ok(shared.state.clone())
    }

    async fn wait_for_load(&self) {
        let started = tokio::time::Instant::now();
        loop {
            tokio::time::sleep(NAVIGATION_CHECK).await;
            match self.host.page(Role::Main).await {
                Some(page) if page.is_loading && started.elapsed() < NAVIGATION_WAIT => {}
                _ => return,
            }
        }
    }

    /// `browserBack` and `browserForward`.
    pub async fn go(&self, direction: History) -> BrowserState {
        let mut shared = self.shared.lock().await;
        if !shared.main_view {
            return shared.state.clone();
        }
        self.host.go(direction).await;
        if let Some(page) = self.host.page(Role::Main).await {
            self.apply_page(&mut shared, page);
        }
        shared.state.clone()
    }

    /// `browserReload`.
    pub async fn reload(&self) -> BrowserState {
        let mut shared = self.shared.lock().await;
        if !shared.main_view {
            return shared.state.clone();
        }
        self.host.reload().await;
        if let Some(page) = self.host.page(Role::Main).await {
            self.apply_page(&mut shared, page);
        }
        shared.state.clone()
    }

    /// `setBrowserProjection`.
    pub async fn set_projection(
        self: &Arc<Self>,
        target: ProjectionTarget,
    ) -> AppResult<BrowserState> {
        let mut shared = self.shared.lock().await;
        shared.projection = target;
        shared.state.projection_target = target;
        self.host.emit_state(&shared.state);

        if target == ProjectionTarget::Preview {
            self.host.destroy(Role::Output).await;
            shared.output_view = false;
            return Ok(shared.state.clone());
        }

        self.host.open_output_window().await?;
        let main_page = if shared.main_view {
            self.host.page(Role::Main).await
        } else {
            None
        };

        if !shared.output_view {
            // Electron made the output view blank and loaded the page only when
            // there was a main view to follow.
            let url = match &main_page {
                Some(page) => rules::restore_url(Some(&page.url), Some(&shared.state.url)),
                None => BLANK.to_owned(),
            };
            self.host.create(Role::Output, url).await?;
            shared.output_view = true;
        } else if let Some(page) = &main_page {
            let url = rules::restore_url(Some(&page.url), Some(&shared.state.url));
            let showing = self.host.page(Role::Output).await.map(|output| output.url);
            if showing.as_deref() != Some(url.as_str()) {
                self.host.load(Role::Output, url).await;
            } else {
                self.sync_output_scroll(&shared).await;
            }
        }
        if main_page.is_none() {
            return Ok(shared.state.clone());
        }

        self.start_poll();
        Ok(shared.state.clone())
    }

    /// What the views report, from `view.rs`'s callbacks.
    pub async fn on_signal(self: &Arc<Self>, signal: Signal) {
        match signal {
            Signal::LoadStarted(Role::Main) | Signal::TitleChanged(Role::Main) => {
                let mut shared = self.shared.lock().await;
                if let Some(page) = self.host.page(Role::Main).await {
                    self.apply_page(&mut shared, page);
                }
            }
            Signal::LoadFinished(Role::Main) => {
                let mut shared = self.shared.lock().await;
                if let Some(page) = self.host.page(Role::Main).await {
                    self.apply_page(&mut shared, page);
                }
                self.sync_output_to_main(&shared).await;
                self.capture(&shared);
            }
            Signal::LoadFinished(Role::Output) => {
                let shared = self.shared.lock().await;
                self.sync_output_scroll(&shared).await;
            }
            Signal::LoadStarted(Role::Output) | Signal::TitleChanged(Role::Output) => {}
            Signal::FocusAddress => self.host.emit_focus_address(),
            Signal::OpenInView(role, url) => self.host.load(role, url).await,
            Signal::OutputClosed => self.shared.lock().await.output_view = false,
        }
    }

    /// `updateStateFromMainView`. Emits only a change.
    fn apply_page(&self, shared: &mut Shared, page: Page) {
        let next = BrowserState {
            url: if page.url.is_empty() {
                shared.state.url.clone()
            } else {
                page.url
            },
            title: page.title,
            can_go_back: page.can_go_back,
            can_go_forward: page.can_go_forward,
            is_loading: page.is_loading,
            projection_target: shared.projection,
            ..shared.state.clone()
        };
        if next != shared.state {
            shared.state = next;
            self.host.emit_state(&shared.state);
        }
    }

    /// `syncOutputViewToMain`.
    async fn sync_output_to_main(&self, shared: &Shared) {
        if !shared.main_view || !shared.output_view {
            return;
        }
        let (Some(main), Some(output)) = (
            self.host.page(Role::Main).await,
            self.host.page(Role::Output).await,
        ) else {
            return;
        };
        if main.url.is_empty() || main.url == BLANK {
            return;
        }
        if main.url == output.url {
            self.sync_output_scroll(shared).await;
            return;
        }
        self.host.load(Role::Output, main.url).await;
    }

    /// `syncOutputScrollPosition`.
    async fn sync_output_scroll(&self, shared: &Shared) {
        if !shared.output_view {
            return;
        }
        self.host
            .scroll_output_to(
                rules::js_round(shared.state.scroll_x),
                rules::js_round(shared.state.scroll_y),
            )
            .await;
    }

    /// `capturePreviewFromMainView`: one capture at a time, off the lock.
    fn capture(self: &Arc<Self>, shared: &Shared) {
        if !shared.main_view || shared.bounds.is_empty() {
            return;
        }
        if self.capturing.swap(true, Ordering::SeqCst) {
            return;
        }
        let this = Arc::clone(self);
        let viewport = shared.bounds;
        tauri::async_runtime::spawn(async move {
            let preview = tokio::time::timeout(CAPTURE_TIMEOUT, this.host.capture(viewport))
                .await
                .ok()
                .flatten();
            this.capturing.store(false, Ordering::SeqCst);
            let Some(preview) = preview else {
                return;
            };
            let mut shared = this.shared.lock().await;
            // Electron sent every capture; an identical one changes nothing.
            if shared.state.preview_data_url.as_deref() != Some(preview.as_str()) {
                shared.state.preview_data_url = Some(preview);
                this.host.emit_state(&shared.state);
            }
        });
    }

    /// One tick of `startScrollSync`: the scroll position, mirrored; the page,
    /// for the in-page navigations a wry view reports no event for; a preview.
    async fn tick(self: &Arc<Self>) -> bool {
        if !self.shared.lock().await.main_view {
            return false;
        }

        let position = tokio::time::timeout(SCROLL_READ_TIMEOUT, self.host.scroll())
            .await
            .ok()
            .flatten();
        let page = self.host.page(Role::Main).await;

        let mut shared = self.shared.lock().await;
        if let Some((x, y)) = position {
            if x != shared.state.scroll_x || y != shared.state.scroll_y {
                shared.state.scroll_x = x;
                shared.state.scroll_y = y;
                self.host.emit_state(&shared.state);
            }
            self.sync_output_scroll(&shared).await;
        }
        if let Some(page) = page {
            let navigated = !page.url.is_empty() && page.url != shared.state.url;
            self.apply_page(&mut shared, page);
            if navigated {
                // `did-navigate-in-page`.
                self.sync_output_to_main(&shared).await;
            }
        }
        self.capture(&shared);
        true
    }

    fn start_poll(self: &Arc<Self>) {
        let mut poll = self
            .poll
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if poll.is_some() {
            return;
        }
        let this = Arc::clone(self);
        *poll = Some(tauri::async_runtime::spawn(async move {
            // `setInterval`: the first tick is one period away.
            let period = this.poll_interval;
            let mut interval =
                tokio::time::interval_at(tokio::time::Instant::now() + period, period);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                if !this.tick().await {
                    this.poll
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .take();
                    return;
                }
            }
        }));
    }

    fn stop_poll(&self) {
        if let Some(poll) = self
            .poll
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            poll.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::services::browser_mode::rules::HOME_URL;

    /// A `BrowserView` pair on paper: every call written down, each page
    /// loading at once.
    #[derive(Clone, Default)]
    struct FakeHost {
        calls: Arc<StdMutex<Vec<String>>>,
        pages: Arc<StdMutex<HashMap<Role, Page>>>,
        scroll: Arc<StdMutex<Option<(f64, f64)>>>,
        preview: Arc<StdMutex<Option<String>>>,
        emitted: Arc<StdMutex<Vec<BrowserState>>>,
        focus_requests: Arc<StdMutex<usize>>,
    }

    impl FakeHost {
        fn record(&self, call: String) {
            self.calls.lock().unwrap().push(call);
        }
        fn calls(&self) -> Vec<String> {
            std::mem::take(&mut *self.calls.lock().unwrap())
        }
        fn set_url(&self, role: Role, url: &str) {
            self.pages.lock().unwrap().entry(role).or_default().url = url.to_owned();
        }
        fn emitted(&self) -> Vec<BrowserState> {
            std::mem::take(&mut *self.emitted.lock().unwrap())
        }
    }

    impl Host for FakeHost {
        fn page(&self, role: Role) -> impl Future<Output = Option<Page>> + Send {
            std::future::ready(self.pages.lock().unwrap().get(&role).cloned())
        }
        fn create(&self, role: Role, url: String) -> impl Future<Output = AppResult<()>> + Send {
            self.record(format!("create {role:?} {url}"));
            self.pages.lock().unwrap().insert(
                role,
                Page {
                    url,
                    ..Page::default()
                },
            );
            std::future::ready(Ok(()))
        }
        fn destroy(&self, role: Role) -> impl Future<Output = ()> + Send {
            self.record(format!("destroy {role:?}"));
            self.pages.lock().unwrap().remove(&role);
            std::future::ready(())
        }
        fn place(&self, bounds: Option<Bounds>) -> impl Future<Output = ()> + Send {
            self.record(match bounds {
                Some(b) => format!("place {} {} {} {}", b.x, b.y, b.width, b.height),
                None => "hide".to_owned(),
            });
            std::future::ready(())
        }
        fn load(&self, role: Role, url: String) -> impl Future<Output = ()> + Send {
            self.record(format!("load {role:?} {url}"));
            self.set_url(role, &url);
            std::future::ready(())
        }
        fn reload(&self) -> impl Future<Output = ()> + Send {
            self.record("reload".to_owned());
            std::future::ready(())
        }
        fn go(&self, direction: History) -> impl Future<Output = ()> + Send {
            self.record(format!("go {direction:?}"));
            std::future::ready(())
        }
        fn scroll(&self) -> impl Future<Output = Option<(f64, f64)>> + Send {
            std::future::ready(*self.scroll.lock().unwrap())
        }
        fn scroll_output_to(&self, x: f64, y: f64) -> impl Future<Output = ()> + Send {
            self.record(format!("scroll output {x} {y}"));
            std::future::ready(())
        }
        fn capture(&self, viewport: Bounds) -> impl Future<Output = Option<String>> + Send {
            self.record(format!("capture {}x{}", viewport.width, viewport.height));
            std::future::ready(self.preview.lock().unwrap().clone())
        }
        fn open_output_window(&self) -> impl Future<Output = AppResult<()>> + Send {
            self.record("open output window".to_owned());
            std::future::ready(Ok(()))
        }
        fn emit_state(&self, state: &BrowserState) {
            self.emitted.lock().unwrap().push(state.clone());
        }
        fn emit_focus_address(&self) {
            *self.focus_requests.lock().unwrap() += 1;
        }
    }

    fn browser() -> (Arc<BrowserMode<FakeHost>>, FakeHost) {
        let host = FakeHost::default();
        // Ticks are driven by hand; the poll's own never comes.
        let browser = BrowserMode::with_poll_interval(host.clone(), Duration::from_secs(3600));
        (browser, host)
    }

    fn viewport() -> RawBounds {
        RawBounds {
            x: 240.4,
            y: 96.5,
            width: 1024.0,
            height: 600.0,
        }
    }

    fn polling(browser: &BrowserMode<FakeHost>) -> bool {
        browser.poll.lock().unwrap().is_some()
    }

    async fn settle() {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    #[tokio::test]
    async fn bounds_are_kept_while_disabled_and_a_first_enable_opens_home_there() {
        let (browser, host) = browser();
        browser.set_bounds(viewport()).await;
        assert_eq!(host.calls(), Vec::<String>::new(), "nothing to place yet");

        let state = browser.set_enabled(true).await.unwrap();
        assert_eq!(
            host.calls(),
            [
                format!("create Main {HOME_URL}"),
                "place 240 97 1024 600".to_owned()
            ]
        );
        assert_eq!(state.url, BLANK, "the page is reported once it loads");
        assert!(polling(&browser));
    }

    #[tokio::test]
    async fn disabling_hides_the_view_and_stops_polling_but_keeps_the_page() {
        let (browser, host) = browser();
        browser.set_bounds(viewport()).await;
        browser.navigate("example.com").await.unwrap();
        browser.set_enabled(true).await.unwrap();
        settle().await; // the preview each of those started
        host.calls();

        browser.set_enabled(false).await.unwrap();
        assert_eq!(host.calls(), ["hide"]);
        assert!(!polling(&browser));

        browser.set_bounds(viewport()).await;
        assert_eq!(
            host.calls(),
            Vec::<String>::new(),
            "a hidden view is not moved"
        );

        let state = browser.set_enabled(true).await.unwrap();
        assert_eq!(
            host.calls()[0],
            "place 240 97 1024 600",
            "shown again, not reloaded"
        );
        assert_eq!(state.url, "https://example.com");
    }

    #[tokio::test]
    async fn a_view_left_blank_loads_the_last_page_when_enabled() {
        let (browser, host) = browser();
        browser.navigate("https://a.test/").await.unwrap();
        host.set_url(Role::Main, BLANK);
        host.calls();

        browser.set_enabled(true).await.unwrap();
        assert_eq!(host.calls(), ["place 0 0 0 0", "load Main https://a.test/"]);
    }

    #[tokio::test]
    async fn navigating_normalises_the_input_and_answers_with_the_page() {
        let (browser, host) = browser();
        let state = browser.navigate("what is grace").await.unwrap();
        let search = "https://www.google.com/search?q=what%20is%20grace";
        assert_eq!(host.calls()[0], format!("create Main {search}"));
        assert_eq!(state.url, search);

        let state = browser.navigate("example.com").await.unwrap();
        assert_eq!(host.calls()[0], "load Main https://example.com");
        assert_eq!(state.url, "https://example.com");
        assert!(!polling(&browser), "navigating alone does not poll");
    }

    #[tokio::test]
    async fn history_and_reload_need_a_view() {
        let (browser, host) = browser();
        browser.go(History::Back).await;
        browser.reload().await;
        assert_eq!(host.calls(), Vec::<String>::new());

        browser.navigate("https://a.test/").await.unwrap();
        host.calls();
        browser.go(History::Back).await;
        browser.go(History::Forward).await;
        browser.reload().await;
        assert_eq!(host.calls(), ["go Back", "go Forward", "reload"]);
    }

    #[tokio::test]
    async fn projecting_opens_the_audience_window_on_the_main_page_and_polls() {
        let (browser, host) = browser();
        browser.navigate("https://a.test/").await.unwrap();
        host.calls();
        host.emitted();

        let state = browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        assert_eq!(
            host.calls(),
            ["open output window", "create Output https://a.test/"]
        );
        assert_eq!(state.projection_target, ProjectionTarget::MainOutput);
        assert_eq!(
            host.emitted()[0].projection_target,
            ProjectionTarget::MainOutput,
            "announced before the window opens"
        );
        assert!(polling(&browser));

        browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        assert_eq!(
            host.calls(),
            ["open output window", "scroll output 0 0"],
            "already on the page: only the scroll is mirrored"
        );

        browser
            .set_projection(ProjectionTarget::Preview)
            .await
            .unwrap();
        assert_eq!(host.calls(), ["destroy Output"]);
    }

    #[tokio::test]
    async fn projecting_before_any_page_leaves_the_output_blank_and_does_not_poll() {
        let (browser, host) = browser();
        browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        assert_eq!(
            host.calls(),
            [
                "open output window".to_owned(),
                format!("create Output {BLANK}")
            ]
        );
        assert!(!polling(&browser));
    }

    #[tokio::test]
    async fn a_finished_load_reports_the_page_and_moves_the_output_to_it() {
        let (browser, host) = browser();
        browser.navigate("https://a.test/").await.unwrap();
        browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        host.calls();
        host.emitted();

        host.set_url(Role::Main, "https://a.test/next");
        browser.on_signal(Signal::LoadFinished(Role::Main)).await;
        assert_eq!(host.calls()[0], "load Output https://a.test/next");
        assert_eq!(host.emitted()[0].url, "https://a.test/next");

        browser.on_signal(Signal::LoadFinished(Role::Main)).await;
        assert_eq!(
            host.emitted(),
            Vec::new(),
            "an unchanged page is not sent again"
        );
    }

    #[tokio::test]
    async fn each_tick_mirrors_the_scroll_and_notices_in_page_navigation() {
        let (browser, host) = browser();
        browser.navigate("https://a.test/").await.unwrap();
        browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        host.calls();
        host.emitted();

        *host.scroll.lock().unwrap() = Some((0.0, 120.5));
        host.set_url(Role::Main, "https://a.test/#part");
        assert!(browser.tick().await);

        let calls = host.calls();
        assert_eq!(calls[0], "scroll output 0 121", "rounded half up");
        assert!(calls.contains(&"load Output https://a.test/#part".to_owned()));
        let state = browser.state().await;
        assert_eq!(
            (state.scroll_y, state.url.as_str()),
            (120.5, "https://a.test/#part")
        );
    }

    #[tokio::test]
    async fn a_preview_is_captured_once_at_a_time_and_sent_when_it_changes() {
        let (browser, host) = browser();
        browser.set_bounds(viewport()).await;
        browser.set_enabled(true).await.unwrap();
        *host.preview.lock().unwrap() = Some("data:image/png;base64,AAAA".to_owned());
        host.calls();
        host.emitted();

        browser.set_bounds(viewport()).await;
        settle().await;
        assert_eq!(host.calls(), ["place 240 97 1024 600", "capture 1024x600"]);
        let sent = host.emitted();
        assert_eq!(sent.len(), 1);
        assert_eq!(
            sent[0].preview_data_url.as_deref(),
            Some("data:image/png;base64,AAAA")
        );

        browser.set_bounds(viewport()).await;
        settle().await;
        assert_eq!(
            host.emitted(),
            Vec::new(),
            "the same preview is not sent twice"
        );
    }

    #[tokio::test]
    async fn the_views_own_requests_are_carried_out() {
        let (browser, host) = browser();
        browser.on_signal(Signal::FocusAddress).await;
        assert_eq!(*host.focus_requests.lock().unwrap(), 1);

        browser
            .on_signal(Signal::OpenInView(Role::Main, "https://b.test/".to_owned()))
            .await;
        assert_eq!(host.calls(), ["load Main https://b.test/"]);

        browser.navigate("https://a.test/").await.unwrap();
        browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        browser.on_signal(Signal::OutputClosed).await;
        host.calls();
        browser
            .set_projection(ProjectionTarget::MainOutput)
            .await
            .unwrap();
        assert_eq!(
            host.calls(),
            ["open output window", "create Output https://a.test/"],
            "a closed audience window gets a new view"
        );
    }
}
