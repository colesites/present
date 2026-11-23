// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A copy of the app started to draw one picture an import could not
    // (`services/pptx/convert_picture.rs`): it does that and exits.
    if present_lib::services::pptx::convert_picture::run_helper_if_asked() {
        return;
    }
    // A development build asks macOS for the microphone as itself, not as
    // the terminal or editor that started it (`run_dev_build_as_own_app`).
    #[cfg(all(target_os = "macos", debug_assertions))]
    if let Some(code) = present_lib::services::permissions::run_dev_build_as_own_app() {
        std::process::exit(code);
    }
    present_lib::run();
}
