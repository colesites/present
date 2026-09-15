//! The two wry webviews browser mode shows, and [`WryHost`], which does with
//! them what `browser-view.service.ts` did with a `BrowserView`.
//!
//! A wry webview belongs to the main thread, so the views live in a
//! thread-local and every operation is posted there. Their callbacks only send
//! a [`Signal`]; anything they would have done happens in `BrowserMode`,
//! off the main thread, so no callback ever re-enters the views.
//!
//! Each view is built on its window's native view: the operator window's for
//! the viewport, the audience window's for the projection. Tauri does not know
//! about them, which is what keeps its windows' own webviews and window lookups
//! as they were (see `mod.rs`).

use std::cell::{Cell, RefCell};
use std::future::Future;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, WindowEvent};
use tokio::sync::{mpsc::UnboundedSender, oneshot};
use wry::dpi::{LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize};
use wry::{NewWindowResponse, PageLoadEvent, Rect, WebContext, WebViewBuilder};

use super::rules::{self, Bounds, BrowserState};
use super::{History, Host, Page, Role, Signal};
use crate::errors::{AppError, AppResult};
use crate::services::window_spec::WindowRole;

mod native;

pub const STATE_CHANGED_EVENT: &str = "browser-state-changed";
pub const FOCUS_ADDRESS_EVENT: &str = "browser-focus-address";

/// ⌘L or Ctrl+L in the page, before the page sees it — `before-input-event`.
const FOCUS_ADDRESS_SCRIPT: &str = r#"(() => {
  const ipc = window.ipc;
  window.addEventListener("keydown", (event) => {
    if (event.isTrusted && (event.metaKey || event.ctrlKey) && typeof event.key === "string" && event.key.toLowerCase() === "l") {
      event.preventDefault();
      event.stopImmediatePropagation();
      ipc.postMessage("focus-address");
    }
  }, true);
})();"#;
const FOCUS_ADDRESS_MESSAGE: &str = "focus-address";

/// The page's scroll position. Built from operators only, and a non-finite
/// value read as 0: the page's own script can redefine `scrollX`, and the
/// macOS bridge aborts on a value JSON cannot hold.
const SCROLL_SCRIPT: &str = "(() => { const x = window.scrollX, y = window.scrollY; \
    const finite = (v) => typeof v === 'number' && v - v === 0; \
    return [finite(x) ? x : 0, finite(y) ? y : 0]; })()";

thread_local! {
    static VIEWS: RefCell<Views> = RefCell::new(Views::default());
}

#[derive(Default)]
struct Views {
    main: Option<View>,
    output: Option<View>,
    /// Whether the audience window open now has its resize and close watched.
    output_window_watched: bool,
}

impl Views {
    fn slot(&mut self, role: Role) -> &mut Option<View> {
        match role {
            Role::Main => &mut self.main,
            Role::Output => &mut self.output,
        }
    }
}

pub(super) struct View {
    webview: wry::WebView,
    /// Outlives the webview it was built with.
    _context: WebContext,
    /// Set by page-load callbacks, for WebView2, which cannot be asked.
    #[cfg_attr(not(windows), allow(dead_code))]
    loading: Rc<Cell<bool>>,
}

/// Run `work` on the main thread, with the views.
fn on_main<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce() -> T + Send + 'static,
) -> impl Future<Output = Option<T>> + Send {
    let (sender, receiver) = oneshot::channel();
    let posted = app.run_on_main_thread(move || {
        let _ = sender.send(work());
    });
    async move {
        if let Err(error) = posted {
            tracing::warn!(%error, "browser mode could not reach the main thread");
            return None;
        }
        receiver.await.ok()
    }
}

/// `work` with the view, when it exists. A shared borrow only: nothing wry
/// calls back into needs the views.
fn with_view<T>(role: Role, work: impl FnOnce(&View) -> T) -> Option<T> {
    VIEWS.with(|views| {
        let views = views.try_borrow().ok()?;
        let view = match role {
            Role::Main => views.main.as_ref(),
            Role::Output => views.output.as_ref(),
        }?;
        Some(work(view))
    })
}

/// Take the view out of the registry and drop it, outside the borrow.
fn remove_view(role: Role) {
    let removed = VIEWS.with(|views| {
        views
            .try_borrow_mut()
            .ok()
            .and_then(|mut views| views.slot(role).take())
    });
    drop(removed);
}

fn logical(bounds: Bounds) -> Rect {
    Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(bounds.width, bounds.height).into(),
    }
}

fn filling(size: tauri::PhysicalSize<u32>) -> Rect {
    Rect {
        position: PhysicalPosition::new(0, 0).into(),
        size: PhysicalSize::new(size.width, size.height).into(),
    }
}

/// Where a page in browser mode may go. Electron refused any top-level
/// navigation a page started to anything but http and https; wry asks about
/// frames too without saying which, so a frame's own `about:`, `data:` and
/// `blob:` documents stay allowed.
fn navigation_allowed(url: String) -> bool {
    tauri::Url::parse(&url)
        .is_ok_and(|url| matches!(url.scheme(), "http" | "https" | "about" | "data" | "blob"))
}

pub struct WryHost {
    app: AppHandle,
    signals: UnboundedSender<Signal>,
}

impl WryHost {
    pub fn new(app: AppHandle, signals: UnboundedSender<Signal>) -> Self {
        Self { app, signals }
    }

    fn window(&self, role: Role) -> AppResult<WebviewWindow> {
        let label = match role {
            Role::Main => WindowRole::Main.label(),
            Role::Output => WindowRole::Output.label(),
        };
        self.app
            .get_webview_window(label)
            .ok_or_else(|| AppError::NotFound(format!("window {label}")))
    }

    /// Electron's `persist:present-browser-mode` partition: a session of its
    /// own, kept between runs.
    fn data_directory(&self) -> AppResult<PathBuf> {
        Ok(self
            .app
            .path()
            .app_local_data_dir()
            .map_err(|error| AppError::Invalid(error.to_string()))?
            .join("browser-mode"))
    }
}

/// A view's webview, with the callbacks that turn into [`Signal`]s.
fn view_builder<'a>(
    role: Role,
    url: String,
    context: &'a mut WebContext,
    signals: &UnboundedSender<Signal>,
    loading: &Rc<Cell<bool>>,
) -> WebViewBuilder<'a> {
    let mut builder = WebViewBuilder::new_with_web_context(context)
        .with_id(match role {
            Role::Main => "present-browser-mode",
            Role::Output => "present-browser-mode-output",
        })
        .with_url(url)
        .with_navigation_handler(navigation_allowed);
    if role == Role::Output {
        // As for the audience window itself (`services/window.rs`): a
        // projection must not stall when the operator window takes focus.
        builder = builder.with_background_throttling(wry::BackgroundThrottlingPolicy::Disabled);
    }

    let new_window_signals = signals.clone();
    builder = builder.with_new_window_req_handler(move |url, _features| {
        // Electron loaded a web address in the same view and handed anything
        // else to the system. The app opens only web addresses outside itself
        // (`open_external_browser`), so the rest is refused.
        if rules::is_valid_http_url(&url) {
            let _ = new_window_signals.send(Signal::OpenInView(role, url));
        }
        NewWindowResponse::Deny
    });

    let load_signals = signals.clone();
    let loading = Rc::clone(loading);
    builder = builder.with_on_page_load_handler(move |event, _url| {
        loading.set(matches!(event, PageLoadEvent::Started));
        let _ = load_signals.send(match event {
            PageLoadEvent::Started => Signal::LoadStarted(role),
            PageLoadEvent::Finished => Signal::LoadFinished(role),
        });
    });

    let title_signals = signals.clone();
    builder = builder.with_document_title_changed_handler(move |_title| {
        let _ = title_signals.send(Signal::TitleChanged(role));
    });

    if role == Role::Main {
        let focus_signals = signals.clone();
        builder = builder
            .with_initialization_script_for_main_only(FOCUS_ADDRESS_SCRIPT, true)
            .with_ipc_handler(move |request| {
                if request.body() == FOCUS_ADDRESS_MESSAGE {
                    let _ = focus_signals.send(Signal::FocusAddress);
                }
            });
    }
    builder
}

impl Host for WryHost {
    fn page(&self, role: Role) -> impl Future<Output = Option<Page>> + Send {
        let work = on_main(&self.app, move || with_view(role, native::page));
        async move { work.await.flatten() }
    }

    fn create(&self, role: Role, url: String) -> impl Future<Output = AppResult<()>> + Send {
        let prepared = (|| {
            let window = self.window(role)?;
            let data_directory = self.data_directory()?;
            let bounds = match role {
                Role::Main => logical(Bounds::default()),
                Role::Output => filling(window.inner_size()?),
            };
            Ok::<_, AppError>((window, data_directory, bounds))
        })();
        let signals = self.signals.clone();

        async move {
            let (window, data_directory, bounds) = prepared?;
            let (sender, receiver) = oneshot::channel();
            let parent = window.clone();
            window.with_webview(move |platform| {
                let result = (|| {
                    // A view of this role already there is replaced.
                    remove_view(role);
                    let mut context = WebContext::new(Some(data_directory));
                    let loading = Rc::new(Cell::new(false));
                    let builder = view_builder(role, url, &mut context, &signals, &loading)
                        .with_bounds(bounds)
                        .with_visible(role == Role::Output);
                    let webview = native::attach(builder, &parent, &platform, role)?;
                    VIEWS.with(|views| {
                        let mut views = views
                            .try_borrow_mut()
                            .map_err(|_| "the browser views are busy".to_owned())?;
                        *views.slot(role) = Some(View {
                            webview,
                            _context: context,
                            loading,
                        });
                        Ok::<(), String>(())
                    })?;
                    if role == Role::Output {
                        watch_output_window(&parent, signals.clone());
                    }
                    Ok::<(), String>(())
                })();
                let _ = sender.send(result);
            })?;
            receiver
                .await
                .map_err(|_| AppError::Invalid("the main thread did not answer".to_owned()))?
                .map_err(AppError::Invalid)
        }
    }

    fn destroy(&self, role: Role) -> impl Future<Output = ()> + Send {
        let work = on_main(&self.app, move || remove_view(role));
        async move {
            work.await;
        }
    }

    fn place(&self, bounds: Option<Bounds>) -> impl Future<Output = ()> + Send {
        let work = on_main(&self.app, move || {
            with_view(Role::Main, |view| {
                let result = match bounds {
                    Some(bounds) => view
                        .webview
                        .set_bounds(logical(bounds))
                        .and_then(|()| view.webview.set_visible(true)),
                    None => view.webview.set_visible(false),
                };
                if let Err(error) = result {
                    tracing::warn!(%error, "could not place the browser view");
                }
            });
        });
        async move {
            work.await;
        }
    }

    fn load(&self, role: Role, url: String) -> impl Future<Output = ()> + Send {
        let work = on_main(&self.app, move || {
            with_view(role, |view| {
                if let Err(error) = view.webview.load_url(&url) {
                    tracing::warn!(%error, "could not load a page in browser mode");
                }
            });
        });
        async move {
            work.await;
        }
    }

    fn reload(&self) -> impl Future<Output = ()> + Send {
        let work = on_main(&self.app, || {
            with_view(Role::Main, |view| {
                if let Err(error) = view.webview.reload() {
                    tracing::warn!(%error, "could not reload the browser view");
                }
            });
        });
        async move {
            work.await;
        }
    }

    fn go(&self, direction: History) -> impl Future<Output = ()> + Send {
        let work = on_main(&self.app, move || {
            with_view(Role::Main, |view| native::go(view, direction));
        });
        async move {
            work.await;
        }
    }

    fn scroll(&self) -> impl Future<Output = Option<(f64, f64)>> + Send {
        let (sender, receiver) = oneshot::channel::<String>();
        let sender = Mutex::new(Some(sender));
        let work = on_main(&self.app, move || {
            with_view(Role::Main, |view| {
                view.webview
                    .evaluate_script_with_callback(SCROLL_SCRIPT, move |json| {
                        if let Some(sender) = sender.lock().ok().and_then(|mut slot| slot.take()) {
                            let _ = sender.send(json);
                        }
                    })
                    .is_ok()
            })
            .unwrap_or(false)
        });
        async move {
            if !work.await.unwrap_or(false) {
                return None;
            }
            let json = receiver.await.ok()?;
            serde_json::from_str::<(f64, f64)>(&json).ok()
        }
    }

    fn scroll_output_to(&self, x: f64, y: f64) -> impl Future<Output = ()> + Send {
        let work = on_main(&self.app, move || {
            with_view(Role::Output, |view| {
                let _ = view
                    .webview
                    .evaluate_script(&format!("window.scrollTo({x}, {y});"));
            });
        });
        async move {
            work.await;
        }
    }

    fn capture(&self, viewport: Bounds) -> impl Future<Output = Option<String>> + Send {
        let (sender, receiver) = oneshot::channel();
        let work = on_main(&self.app, move || {
            with_view(Role::Main, |view| native::capture(view, viewport, sender)).is_some()
        });
        async move {
            if !work.await.unwrap_or(false) {
                return None;
            }
            let snapshot = receiver.await.ok()??;
            tauri::async_runtime::spawn_blocking(move || encode_preview(snapshot, viewport))
                .await
                .ok()
                .flatten()
        }
    }

    fn open_output_window(&self) -> impl Future<Output = AppResult<()>> + Send {
        let app = self.app.clone();
        async move {
            let state = app.state::<crate::state::DisplayState>();
            crate::commands::window::open_window(app.clone(), state, WindowRole::Output, None)
                .await
                .map(|_| ())
        }
    }

    fn emit_state(&self, state: &BrowserState) {
        if let Err(error) = self
            .app
            .emit_to(WindowRole::Main.label(), STATE_CHANGED_EVENT, state)
        {
            tracing::warn!(%error, "could not send the browser state");
        }
    }

    fn emit_focus_address(&self) {
        if let Err(error) = self
            .app
            .emit_to(WindowRole::Main.label(), FOCUS_ADDRESS_EVENT, ())
        {
            tracing::warn!(%error, "could not ask for the address bar");
        }
    }
}

/// Keep the projection filling the audience window, and let it go with the
/// window (`outputWindow.on('resize' | 'closed')`). Once per window.
fn watch_output_window(window: &WebviewWindow, signals: UnboundedSender<Signal>) {
    let watched = VIEWS.with(|views| {
        views
            .try_borrow_mut()
            .is_ok_and(|mut views| std::mem::replace(&mut views.output_window_watched, true))
    });
    if watched {
        return;
    }
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(size) => {
            with_view(Role::Output, |view| {
                let _ = view.webview.set_bounds(filling(*size));
            });
        }
        WindowEvent::Destroyed => {
            remove_view(Role::Output);
            VIEWS.with(|views| {
                if let Ok(mut views) = views.try_borrow_mut() {
                    views.output_window_watched = false;
                }
            });
            let _ = signals.send(Signal::OutputClosed);
        }
        _ => {}
    });
}

/// A page as a snapshot left it, on its way to becoming a preview.
pub(super) enum Snapshot {
    /// Straight RGBA, already cropped to the viewport's shape and to be scaled
    /// to `preview_width` (WebKit on macOS).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Cropped {
        image: image::RgbaImage,
        preview_width: u32,
    },
    /// The whole view, encoded, still to be cropped (WebView2).
    #[cfg_attr(not(windows), allow(dead_code))]
    Encoded(Vec<u8>),
    /// The whole view as Cairo's ARGB32: premultiplied, native byte order
    /// (WebKitGTK).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Argb32 {
        width: u32,
        height: u32,
        stride: usize,
        data: Vec<u8>,
    },
}

/// `capturePreviewFromMainView` after the capture: crop to the viewport's
/// shape, scale to at most 360 wide, PNG data URL.
fn encode_preview(snapshot: Snapshot, viewport: Bounds) -> Option<String> {
    let (image, preview_width) = match snapshot {
        Snapshot::Cropped {
            image,
            preview_width,
        } => (image, preview_width),
        Snapshot::Encoded(bytes) => {
            crop(image::load_from_memory(&bytes).ok()?.to_rgba8(), viewport)
        }
        Snapshot::Argb32 {
            width,
            height,
            stride,
            data,
        } => crop(from_argb32(width, height, stride, &data)?, viewport),
    };
    if image.width() == 0 || image.height() == 0 || preview_width == 0 {
        return None;
    }
    let preview_height = rules::js_round(
        f64::from(preview_width) * f64::from(image.height()) / f64::from(image.width()),
    )
    .max(1.0) as u32;
    let preview = if image.width() == preview_width && image.height() == preview_height {
        image
    } else {
        image::imageops::resize(
            &image,
            preview_width,
            preview_height,
            image::imageops::FilterType::Triangle,
        )
    };
    let mut png = Vec::new();
    preview
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

fn crop(image: image::RgbaImage, viewport: Bounds) -> (image::RgbaImage, u32) {
    let plan = rules::preview_crop(image.dimensions(), (viewport.width, viewport.height));
    let image = match plan.crop {
        Some(crop) => {
            image::imageops::crop_imm(&image, crop.x, crop.y, crop.width, crop.height).to_image()
        }
        None => image,
    };
    (image, plan.preview_width)
}

pub(super) fn unpremultiply(rgba: &mut [u8]) {
    for pixel in rgba.chunks_exact_mut(4) {
        let alpha = u16::from(pixel[3]);
        if alpha == 0 || alpha == 255 {
            continue;
        }
        for channel in &mut pixel[..3] {
            *channel = ((u16::from(*channel) * 255 + alpha / 2) / alpha).min(255) as u8;
        }
    }
}

fn from_argb32(width: u32, height: u32, stride: usize, data: &[u8]) -> Option<image::RgbaImage> {
    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
    for row in 0..height as usize {
        let line = data.get(row * stride..row * stride + width as usize * 4)?;
        for pixel in line.chunks_exact(4) {
            let value = u32::from_ne_bytes([pixel[0], pixel[1], pixel[2], pixel[3]]);
            rgba.extend_from_slice(&[
                (value >> 16) as u8,
                (value >> 8) as u8,
                value as u8,
                (value >> 24) as u8,
            ]);
        }
    }
    unpremultiply(&mut rgba);
    image::RgbaImage::from_raw(width, height, rgba)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_app_builds_one_wry_the_one_tauri_uses() {
        let lock = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.lock"))
            .expect("Cargo.lock");
        let versions: Vec<&str> = lock
            .split("[[package]]")
            .filter(|package| package.contains("\nname = \"wry\"\n"))
            .filter_map(|package| package.lines().find(|line| line.starts_with("version = ")))
            .collect();
        assert_eq!(
            versions,
            ["version = \"0.55.1\""],
            "Tauri moved to another wry: move the pin in Cargo.toml with it"
        );
    }

    #[test]
    fn a_page_may_go_to_web_addresses_and_a_frame_to_its_own_documents() {
        assert!(navigation_allowed("https://example.com/".to_owned()));
        assert!(navigation_allowed("http://localhost:3000/".to_owned()));
        assert!(navigation_allowed("about:blank".to_owned()));
        assert!(navigation_allowed("about:srcdoc".to_owned()));
        assert!(navigation_allowed("data:text/html,hi".to_owned()));
        assert!(navigation_allowed(
            "blob:https://example.com/0a1b".to_owned()
        ));
        assert!(!navigation_allowed("file:///etc/passwd".to_owned()));
        assert!(!navigation_allowed("mailto:a@b.co".to_owned()));
        assert!(!navigation_allowed(
            "tauri://localhost/index.html".to_owned()
        ));
        assert!(!navigation_allowed("zoommtg://join".to_owned()));
        assert!(!navigation_allowed("not a url".to_owned()));
    }

    #[test]
    fn a_preview_is_cropped_to_the_viewport_and_scaled_to_360_wide() {
        let image = image::RgbaImage::from_pixel(1200, 800, image::Rgba([10, 20, 30, 255]));
        let mut png = Vec::new();
        image
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let viewport = Bounds {
            x: 0,
            y: 0,
            width: 600,
            height: 300,
        };
        let url = encode_preview(Snapshot::Encoded(png), viewport).unwrap();
        let encoded = url.strip_prefix("data:image/png;base64,").unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let preview = image::load_from_memory(&bytes).unwrap().to_rgba8();
        assert_eq!(preview.dimensions(), (360, 180));
        assert_eq!(preview.get_pixel(180, 90), &image::Rgba([10, 20, 30, 255]));
    }

    #[test]
    fn cairo_pixels_become_straight_rgba() {
        // One opaque orange pixel and one half-transparent white one, as
        // ARGB32 in this machine's byte order, with a stride of 8 per row.
        let mut data = Vec::new();
        data.extend_from_slice(&0xFF_FF_80_00_u32.to_ne_bytes());
        data.extend_from_slice(&0x80_80_80_80_u32.to_ne_bytes());
        let image = from_argb32(2, 1, 8, &data).unwrap();
        assert_eq!(image.get_pixel(0, 0), &image::Rgba([255, 128, 0, 255]));
        assert_eq!(image.get_pixel(1, 0), &image::Rgba([255, 255, 255, 128]));
    }
}
