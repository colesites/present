// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // A copy of the app started to draw one picture an import could not
    // (`services/pptx/convert_picture.rs`): it does that and exits.
    if present_lib::services::pptx::convert_picture::run_helper_if_asked() {
        return;
    }
    present_lib::run();
}
