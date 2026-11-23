//! Microphone and camera authorisation.
//!
//! Ports `src/main/services/media-permissions.service.ts:56-88`. Same three
//! outcomes and the same strings, so the React side compares against the values
//! it already compares against.
//!
//! macOS is the only platform that gates capture behind a per-app grant;
//! Electron returns `granted` unconditionally elsewhere and so does this.
//!
//! The webview prompts on its own the first time `getUserMedia` runs — the
//! capability probe confirmed live capture works under WKWebView without any of
//! this. What these calls add is the ability to ask *before* showing a UI that
//! depends on the answer, and to tell "denied once, will never prompt again"
//! apart from "not asked yet", which a bare `getUserMedia` rejection cannot.

use serde::Serialize;

/// `MediaAccessResult` in `src/shared/types/electron.d.ts:24-27`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAccessResult {
    pub granted: bool,
    /// One of Electron's `getMediaAccessStatus` strings: `granted`, `denied`,
    /// `restricted`, `not-determined` or `unknown`.
    pub status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Microphone,
    Camera,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{MediaAccessResult, MediaKind};

    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaType};

    fn media_type(kind: MediaKind) -> Option<&'static AVMediaType> {
        // SAFETY: reading a framework string constant.
        unsafe {
            match kind {
                MediaKind::Microphone => objc2_av_foundation::AVMediaTypeAudio,
                MediaKind::Camera => objc2_av_foundation::AVMediaTypeVideo,
            }
        }
    }

    fn describe(status: AVAuthorizationStatus) -> &'static str {
        match status {
            AVAuthorizationStatus::Authorized => "granted",
            AVAuthorizationStatus::Denied => "denied",
            AVAuthorizationStatus::Restricted => "restricted",
            AVAuthorizationStatus::NotDetermined => "not-determined",
            _ => "unknown",
        }
    }

    pub fn status(kind: MediaKind) -> String {
        let Some(media_type) = media_type(kind) else {
            return "unknown".to_owned();
        };
        // SAFETY: `authorizationStatusForMediaType:` takes one of the two media
        // types this function can produce; anything else raises an Objective-C
        // exception, which is why the constant is not built from a string here.
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
        describe(status).to_owned()
    }

    /// Show the system prompt and wait for the answer.
    ///
    /// The completion block fires on an arbitrary dispatch queue, so the result
    /// comes back over a channel rather than by touching anything shared.
    pub fn request(kind: MediaKind) -> MediaAccessResult {
        let Some(media_type) = media_type(kind) else {
            return MediaAccessResult {
                granted: false,
                status: "unknown".to_owned(),
            };
        };

        let (sender, receiver) = std::sync::mpsc::channel();
        let handler = block2::RcBlock::new(move |granted: objc2::runtime::Bool| {
            let _ = sender.send(granted.as_bool());
        });

        // SAFETY: same media-type constraint as above; the block outlives the
        // call because `RcBlock` is retained by the callee.
        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
        }

        // The prompt stays up until the operator answers it. There is no
        // timeout on purpose: guessing "denied" after N seconds and then having
        // the OS grant access leaves the app and the system disagreeing.
        let granted = receiver.recv().unwrap_or(false);

        MediaAccessResult {
            granted,
            status: status(kind),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{MediaAccessResult, MediaKind};

    pub fn status(_kind: MediaKind) -> String {
        "granted".to_owned()
    }

    pub fn request(_kind: MediaKind) -> MediaAccessResult {
        MediaAccessResult {
            granted: true,
            status: "granted".to_owned(),
        }
    }
}

/// Ask for access, prompting only when the answer is not already settled.
///
/// Ports the early returns in `requestMicrophoneAccess`
/// (`media-permissions.service.ts:61-73`): an already-granted permission does
/// not prompt, and a denied or restricted one cannot be re-prompted — macOS
/// shows the dialog once and after that only System Settings can change it.
pub fn request(kind: MediaKind) -> MediaAccessResult {
    let current = platform::status(kind);

    if current == "granted" {
        return MediaAccessResult {
            granted: true,
            status: current,
        };
    }
    if current != "not-determined" {
        return MediaAccessResult {
            granted: false,
            status: current,
        };
    }

    platform::request(kind)
}

/// Current status without prompting.
pub fn status(kind: MediaKind) -> MediaAccessResult {
    let status = platform::status(kind);
    MediaAccessResult {
        granted: status == "granted",
        status,
    }
}

/// The environment variable a development build restarted as its own app
/// carries: the process id of the copy that restarted it.
#[cfg(all(target_os = "macos", debug_assertions))]
const OWN_APP: &str = "PRESENT_DEV_OWN_APP";

/// A development build, restarted as its own app for macOS's privacy checks.
///
/// `cargo run`, under `tauri dev`, starts a bare program, not an app bundle,
/// and macOS asks the app that started it — the terminal — for the
/// microphone instead. Started from an editor or a terminal that is not
/// signed, macOS refuses at once without asking anyone, and the Bible agent
/// says the microphone is not allowed while System Settings shows Present
/// allowed. Measured on the owner's Mac: under such an app the request came
/// back "no" in 0.02 s with no prompt; restarted this way it showed the
/// prompt.
///
/// So the copy `tauri dev` starts restarts itself, disclaiming the app that
/// started it (`responsibility_spawnattrs_setdisclaim`, as Xcode and the
/// browsers do for their helpers), waits for it and exits as it does. The
/// restarted copy leaves when its starter is gone: `tauri dev` stops the one
/// it started, not knowing of the other. A built app is already its own app
/// and never does this. `PRESENT_DEV_OWN_APP=0` turns it off.
///
/// `Some(exit code)` in the copy that restarted the app, which should exit
/// with it; `None` in the app.
#[cfg(all(target_os = "macos", debug_assertions))]
pub fn run_dev_build_as_own_app() -> Option<i32> {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::os::unix::ffi::OsStrExt;

    extern "C" {
        fn posix_spawnattr_init(attr: *mut *mut c_void) -> c_int;
        fn posix_spawnattr_destroy(attr: *mut *mut c_void) -> c_int;
        // libSystem, private but stable since macOS 10.14.
        fn responsibility_spawnattrs_setdisclaim(attr: *mut *mut c_void, disclaim: c_int) -> c_int;
        fn posix_spawn(
            pid: *mut i32,
            path: *const c_char,
            file_actions: *const c_void,
            attr: *const *mut c_void,
            argv: *const *mut c_char,
            envp: *const *mut c_char,
        ) -> c_int;
        fn waitpid(pid: i32, status: *mut c_int, options: c_int) -> i32;
        fn getppid() -> i32;
        fn getpid() -> i32;
    }

    match std::env::var(OWN_APP).ok().as_deref() {
        Some("0") => return None,
        Some(starter) => {
            // The restarted copy: leave with the one that started it.
            let starter: i32 = starter.parse().unwrap_or(0);
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(300));
                // SAFETY: no arguments, no state.
                if unsafe { getppid() } != starter {
                    std::process::exit(0);
                }
            });
            return None;
        }
        None => {}
    }

    let exe = std::env::current_exe().ok()?;
    let cstring = |bytes: &[u8]| CString::new(bytes).ok();
    let path = cstring(exe.as_os_str().as_bytes())?;
    let args: Vec<CString> = std::env::args_os()
        .map(|arg| cstring(arg.as_bytes()))
        .collect::<Option<_>>()?;
    // SAFETY: no arguments, no state.
    let me = unsafe { getpid() };
    let mut env: Vec<CString> = std::env::vars_os()
        .filter(|(key, _)| key != OWN_APP)
        .map(|(key, value)| {
            let mut pair = key.as_bytes().to_vec();
            pair.push(b'=');
            pair.extend_from_slice(value.as_bytes());
            cstring(&pair)
        })
        .collect::<Option<_>>()?;
    env.push(cstring(format!("{OWN_APP}={me}").as_bytes())?);
    let mut argv: Vec<*mut c_char> = args.iter().map(|arg| arg.as_ptr() as *mut c_char).collect();
    argv.push(std::ptr::null_mut());
    let mut envp: Vec<*mut c_char> = env
        .iter()
        .map(|pair| pair.as_ptr() as *mut c_char)
        .collect();
    envp.push(std::ptr::null_mut());

    let mut attr: *mut c_void = std::ptr::null_mut();
    let mut child: i32 = 0;
    // SAFETY: `attr` is initialised before use and destroyed after; `argv`
    // and `envp` are null-terminated arrays of strings that outlive the call.
    let spawned = unsafe {
        if posix_spawnattr_init(&mut attr) != 0 {
            return None;
        }
        responsibility_spawnattrs_setdisclaim(&mut attr, 1);
        let spawned = posix_spawn(
            &mut child,
            path.as_ptr(),
            std::ptr::null(),
            &attr,
            argv.as_ptr(),
            envp.as_ptr(),
        );
        posix_spawnattr_destroy(&mut attr);
        spawned
    };
    if spawned != 0 {
        // Carry on as the bare program: the microphone may be refused, as before.
        eprintln!("Present: could not restart as its own app (error {spawned}); the microphone may be refused");
        return None;
    }

    let mut status: c_int = 0;
    loop {
        // SAFETY: waiting on the child just spawned.
        let waited = unsafe { waitpid(child, &mut status, 0) };
        if waited == child {
            break;
        }
        if waited == -1 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted
        {
            return Some(1);
        }
    }
    // WIFEXITED / WEXITSTATUS, WTERMSIG.
    Some(if status & 0x7f == 0 {
        (status >> 8) & 0xff
    } else {
        128 + (status & 0x7f)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_status_read_never_prompts_and_always_answers() {
        // Whatever this machine's state is, the result must be one of the
        // strings the React side knows how to read.
        for kind in [MediaKind::Microphone, MediaKind::Camera] {
            let result = status(kind);
            assert!(
                matches!(
                    result.status.as_str(),
                    "granted" | "denied" | "restricted" | "not-determined" | "unknown"
                ),
                "unexpected status {}",
                result.status
            );
            assert_eq!(result.granted, result.status == "granted");
        }
    }

    #[test]
    fn the_result_serialises_with_the_shape_the_ui_expects() {
        let json = serde_json::to_value(MediaAccessResult {
            granted: false,
            status: "not-determined".to_owned(),
        })
        .expect("serialisable");

        assert_eq!(json["granted"], false);
        assert_eq!(json["status"], "not-determined");
    }
}
