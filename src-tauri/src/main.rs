// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's AT-SPI accessibility bridge aborts the web process (CrashOnOverflow in
    // AccessibilityObjectAtspi::selectionChanged) when a focused text input is removed.
    #[cfg(target_os = "linux")]
    if std::env::var_os("NO_AT_BRIDGE").is_none() {
        // SAFETY: called first thing in main, before any other thread exists.
        unsafe { std::env::set_var("NO_AT_BRIDGE", "1") };
    }
    oviate_lib::run()
}
