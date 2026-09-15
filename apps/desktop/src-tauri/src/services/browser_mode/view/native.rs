//! What wry does not offer on every platform: building a view on the window's
//! own native view, the history buttons' state, and a snapshot.

pub(super) use imp::{attach, capture, go, page};

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::Cell;
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSImage, NSView};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGImageAlphaInfo,
    };
    use objc2_foundation::{NSError, NSNumber};
    use objc2_web_kit::WKSnapshotConfiguration;
    use raw_window_handle::{
        AppKitWindowHandle, HandleError, HasWindowHandle, RawWindowHandle, WindowHandle,
    };
    use tauri::webview::PlatformWebview;
    use tauri::WebviewWindow;
    use tokio::sync::oneshot;
    use wry::{WebViewBuilder, WebViewBuilderExtDarwin, WebViewExtMacOS};

    use super::super::{unpremultiply, Snapshot, View};
    use crate::services::browser_mode::rules::{self, Bounds};
    use crate::services::browser_mode::{History, Page, Role};

    /// Browser mode's own persistent website data, apart from the app's — on
    /// macOS 14 and later. Earlier, WebKit has only the shared default store.
    const DATA_STORE: [u8; 16] = [
        0x6b, 0x1e, 0x2f, 0x4c, 0x93, 0x0a, 0x4d, 0x57, 0xa2, 0x58, 0x3d, 0x71, 0x0e, 0xc4, 0x19,
        0x86,
    ];

    /// The view wry attaches a child to. Tauri's window handle names the view
    /// the window was created with, which wry has since replaced as the
    /// content view with its own parent of the app's webview.
    struct ParentView(NonNull<c_void>);

    impl HasWindowHandle for ParentView {
        fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
            let raw = RawWindowHandle::AppKit(AppKitWindowHandle::new(self.0));
            // SAFETY: the view outlives the borrow; `attach` holds it.
            Ok(unsafe { WindowHandle::borrow_raw(raw) })
        }
    }

    pub fn attach(
        builder: WebViewBuilder<'_>,
        _window: &WebviewWindow,
        platform: &PlatformWebview,
        role: Role,
    ) -> Result<wry::WebView, String> {
        MainThreadMarker::new().ok_or("not on the main thread")?;
        let app_webview =
            NonNull::new(platform.inner().cast::<NSView>()).ok_or("the window has no webview")?;
        // SAFETY: Tauri's WKWebView is an NSView, alive while its window is,
        // and this runs on the main thread.
        let parent = unsafe { app_webview.as_ref().superview() }
            .ok_or("the window's webview has no parent view")?;
        let handle = ParentView(NonNull::from(&*parent).cast());
        let webview = builder
            .with_data_store_identifier(DATA_STORE)
            .build_as_child(&handle)
            .map_err(|error| error.to_string())?;
        if role == Role::Output {
            webview.webview().setAutoresizingMask(
                NSAutoresizingMaskOptions::ViewWidthSizable
                    | NSAutoresizingMaskOptions::ViewHeightSizable,
            );
        }
        Ok(webview)
    }

    /// Read from WKWebView itself. Not wry's `url()`, which panics on a view
    /// that has not committed a page yet.
    pub fn page(view: &View) -> Page {
        let webview = view.webview.webview();
        // SAFETY: plain property reads on the main thread.
        unsafe {
            Page {
                url: webview
                    .URL()
                    .and_then(|url| url.absoluteString())
                    .map(|url| url.to_string())
                    .unwrap_or_default(),
                title: webview
                    .title()
                    .map(|title| title.to_string())
                    .unwrap_or_default(),
                can_go_back: webview.canGoBack(),
                can_go_forward: webview.canGoForward(),
                is_loading: webview.isLoading(),
            }
        }
    }

    pub fn go(view: &View, direction: History) {
        let webview = view.webview.webview();
        // SAFETY: on the main thread; with no history this does nothing.
        unsafe {
            let _ = match direction {
                History::Back => webview.goBack(),
                History::Forward => webview.goForward(),
            };
        }
    }

    /// WebKit crops and scales the snapshot itself, so only a preview-sized
    /// image crosses to Rust.
    pub fn capture(view: &View, viewport: Bounds, done: oneshot::Sender<Option<Snapshot>>) {
        let Some(marker) = MainThreadMarker::new() else {
            let _ = done.send(None);
            return;
        };
        let webview = view.webview.webview();
        let frame = webview.frame();
        let source = (
            frame.size.width.round().max(0.0) as u32,
            frame.size.height.round().max(0.0) as u32,
        );
        if source.0 == 0 || source.1 == 0 {
            let _ = done.send(None);
            return;
        }
        let plan = rules::preview_crop(source, (viewport.width, viewport.height));

        // SAFETY: a new configuration, set up and used on the main thread.
        let configuration = unsafe { WKSnapshotConfiguration::new(marker) };
        unsafe {
            if let Some(crop) = plan.crop {
                configuration.setRect(CGRect::new(
                    CGPoint::new(crop.x.into(), crop.y.into()),
                    CGSize::new(crop.width.into(), crop.height.into()),
                ));
            }
            configuration.setSnapshotWidth(Some(&NSNumber::new_f64(plan.preview_width.into())));
        }

        let done = Cell::new(Some(done));
        let preview_width = plan.preview_width;
        let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
            // SAFETY: WebKit passes a valid image or null.
            let snapshot =
                unsafe { image.as_ref() }
                    .and_then(pixels)
                    .map(|image| Snapshot::Cropped {
                        image,
                        preview_width,
                    });
            if let Some(done) = done.take() {
                let _ = done.send(snapshot);
            }
        });
        // SAFETY: on the main thread; WebKit copies the configuration.
        unsafe {
            webview.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler)
        };
    }

    /// The image drawn into straight RGBA.
    fn pixels(image: &NSImage) -> Option<image::RgbaImage> {
        // SAFETY: a null rect asks for the image at its own size.
        let cg_image = unsafe {
            image.CGImageForProposedRect_context_hints(std::ptr::null_mut(), None, None)
        }?;
        let width = CGImage::width(Some(&cg_image));
        let height = CGImage::height(Some(&cg_image));
        if width == 0 || height == 0 {
            return None;
        }
        let mut data = vec![0u8; width.checked_mul(height)?.checked_mul(4)?];
        let space = CGColorSpace::new_device_rgb()?;
        // SAFETY: `data` holds `width * height * 4` bytes and outlives the
        // context, which is dropped before it is read.
        let context = unsafe {
            CGBitmapContextCreate(
                data.as_mut_ptr().cast(),
                width,
                height,
                8,
                width * 4,
                Some(&space),
                CGImageAlphaInfo::PremultipliedLast.0,
            )
        }?;
        CGContext::draw_image(
            Some(&context),
            CGRect::new(
                CGPoint::new(0.0, 0.0),
                CGSize::new(width as f64, height as f64),
            ),
            Some(&cg_image),
        );
        drop(context);
        unpremultiply(&mut data);
        image::RgbaImage::from_raw(
            u32::try_from(width).ok()?,
            u32::try_from(height).ok()?,
            data,
        )
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::Mutex;

    use tauri::webview::PlatformWebview;
    use tauri::WebviewWindow;
    use tokio::sync::oneshot;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use webview2_com::{take_pwstr, CapturePreviewCompletedHandler};
    use windows::core::{BOOL, PWSTR};
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;
    use wry::{WebViewBuilder, WebViewExtWindows};

    use super::super::{Snapshot, View};
    use crate::services::browser_mode::rules::Bounds;
    use crate::services::browser_mode::{History, Page, Role};

    pub fn attach(
        builder: WebViewBuilder<'_>,
        window: &WebviewWindow,
        _platform: &PlatformWebview,
        _role: Role,
    ) -> Result<wry::WebView, String> {
        builder
            .build_as_child(window)
            .map_err(|error| error.to_string())
    }

    /// WebView2 has no loading property; the page-load callbacks keep it.
    pub fn page(view: &View) -> Page {
        let webview = view.webview.webview();
        let mut back = BOOL::default();
        let mut forward = BOOL::default();
        let mut title = PWSTR::null();
        // SAFETY: COM calls on the thread that owns the webview.
        unsafe {
            let _ = webview.CanGoBack(&mut back);
            let _ = webview.CanGoForward(&mut forward);
            let title = match webview.DocumentTitle(&mut title) {
                Ok(()) => take_pwstr(title),
                Err(_) => String::new(),
            };
            Page {
                url: view.webview.url().unwrap_or_default(),
                title,
                can_go_back: back.as_bool(),
                can_go_forward: forward.as_bool(),
                is_loading: view.loading.get(),
            }
        }
    }

    pub fn go(view: &View, direction: History) {
        let webview = view.webview.webview();
        // SAFETY: as above; with no history these do nothing.
        unsafe {
            let _ = match direction {
                History::Back => webview.GoBack(),
                History::Forward => webview.GoForward(),
            };
        }
    }

    /// The whole view as PNG; cropped and scaled off the main thread.
    pub fn capture(view: &View, _viewport: Bounds, done: oneshot::Sender<Option<Snapshot>>) {
        let webview = view.webview.webview();
        // SAFETY: a new in-memory stream.
        let Some(stream) = (unsafe { SHCreateMemStream(None) }) else {
            let _ = done.send(None);
            return;
        };
        let reader = stream.clone();
        let done = Mutex::new(Some(done));
        let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
            let bytes = result.ok().and_then(|()| read_all(&reader));
            if let Some(done) = done.lock().ok().and_then(|mut done| done.take()) {
                let _ = done.send(bytes.map(Snapshot::Encoded));
            }
            Ok(())
        }));
        // SAFETY: COM call on the webview's thread; a failure drops the
        // handler, and with it the sender.
        let _ = unsafe {
            webview.CapturePreview(
                COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                &stream,
                &handler,
            )
        };
    }

    fn read_all(stream: &IStream) -> Option<Vec<u8>> {
        // SAFETY: reads from a stream this module created.
        unsafe {
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME).ok()?;
            let size = u32::try_from(stat.cbSize).ok()?;
            stream.Seek(0, STREAM_SEEK_SET, None).ok()?;
            let mut bytes = vec![0u8; size as usize];
            let mut read = 0u32;
            stream
                .Read(bytes.as_mut_ptr().cast(), size, Some(&mut read))
                .ok()
                .ok()?;
            bytes.truncate(read as usize);
            Some(bytes)
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use gtk::prelude::*;
    use tauri::webview::PlatformWebview;
    use tauri::WebviewWindow;
    use tokio::sync::oneshot;
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
    use wry::{WebViewBuilder, WebViewBuilderExtUnix, WebViewExtUnix};

    use super::super::{Snapshot, View};
    use crate::services::browser_mode::rules::Bounds;
    use crate::services::browser_mode::{History, Page, Role};

    const LAYER_NAME: &str = "present-browser-mode";

    /// wry positions a GTK webview only inside a `gtk::Fixed`, so the window's
    /// own webview goes under an overlay whose top layer is one. The layer
    /// passes input through wherever no view covers it.
    pub fn attach(
        builder: WebViewBuilder<'_>,
        window: &WebviewWindow,
        platform: &PlatformWebview,
        _role: Role,
    ) -> Result<wry::WebView, String> {
        let layer = layer(window, &platform.inner())?;
        let webview = builder
            .build_gtk(&layer)
            .map_err(|error| error.to_string())?;
        layer.show_all();
        Ok(webview)
    }

    fn layer(
        window: &WebviewWindow,
        app_webview: &webkit2gtk::WebView,
    ) -> Result<gtk::Fixed, String> {
        let overlay = match app_webview
            .parent()
            .and_then(|parent| parent.downcast::<gtk::Overlay>().ok())
        {
            Some(overlay) => overlay,
            None => {
                let vbox = window.default_vbox().map_err(|error| error.to_string())?;
                let overlay = gtk::Overlay::new();
                vbox.remove(app_webview);
                overlay.add(app_webview);
                vbox.pack_start(&overlay, true, true, 0);
                overlay.show_all();
                overlay
            }
        };
        if let Some(existing) = overlay
            .children()
            .into_iter()
            .find(|child| child.widget_name() == LAYER_NAME)
            .and_then(|child| child.downcast::<gtk::Fixed>().ok())
        {
            return Ok(existing);
        }
        let layer = gtk::Fixed::new();
        layer.set_widget_name(LAYER_NAME);
        overlay.add_overlay(&layer);
        overlay.set_overlay_pass_through(&layer, true);
        Ok(layer)
    }

    pub fn page(view: &View) -> Page {
        let webview = view.webview.webview();
        Page {
            url: webview.uri().map(|uri| uri.to_string()).unwrap_or_default(),
            title: webview
                .title()
                .map(|title| title.to_string())
                .unwrap_or_default(),
            can_go_back: webview.can_go_back(),
            can_go_forward: webview.can_go_forward(),
            is_loading: webview.is_loading(),
        }
    }

    pub fn go(view: &View, direction: History) {
        let webview = view.webview.webview();
        match direction {
            History::Back => webview.go_back(),
            History::Forward => webview.go_forward(),
        }
    }

    /// The visible page as Cairo pixels; cropped and scaled off the main thread.
    pub fn capture(view: &View, _viewport: Bounds, done: oneshot::Sender<Option<Snapshot>>) {
        view.webview.webview().snapshot(
            SnapshotRegion::Visible,
            SnapshotOptions::NONE,
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let snapshot = result.ok().and_then(|surface| {
                    let mut surface = gtk::cairo::ImageSurface::try_from(surface).ok()?;
                    let width = u32::try_from(surface.width()).ok()?;
                    let height = u32::try_from(surface.height()).ok()?;
                    let stride = usize::try_from(surface.stride()).ok()?;
                    let data = surface.data().ok()?.to_vec();
                    Some(Snapshot::Argb32 {
                        width,
                        height,
                        stride,
                        data,
                    })
                });
                let _ = done.send(snapshot);
            },
        );
    }
}
