//! The panic hook writes to the error log. In its own test binary, because a
//! panic hook is process-wide and every unit test shares one process.

use std::sync::Arc;

use present_lib::services::error_log::{record_panics, ErrorLog};

#[test]
fn a_panic_on_any_thread_is_written_down_with_where_it_happened() {
    let directory = std::env::temp_dir().join(format!("present-panic-hook-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&directory);
    let log = Arc::new(ErrorLog::new(&directory, "1.2.3"));
    record_panics(Arc::clone(&log));

    let outcome = std::thread::Builder::new()
        .name("ndi-output".to_owned())
        .spawn(|| panic!("the sender went away with token=abc"))
        .unwrap()
        .join();
    assert!(outcome.is_err());

    let written = std::fs::read_to_string(log.path()).expect("the panic was logged");
    let entry: serde_json::Value = serde_json::from_str(written.lines().last().unwrap()).unwrap();
    assert_eq!(entry["category"], "main");
    assert_eq!(entry["name"], "panic");
    assert_eq!(
        entry["message"],
        "the sender went away with token=[REDACTED]"
    );
    assert_eq!(entry["context"]["thread"], "ndi-output");
    assert_eq!(entry["appVersion"], "1.2.3");
    assert!(
        entry["stack"].as_str().unwrap().contains("panic_hook.rs:"),
        "the location: {}",
        entry["stack"]
    );
    let _ = std::fs::remove_dir_all(directory);
}
