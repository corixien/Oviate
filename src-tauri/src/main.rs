// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's AT-SPI accessibility layer aborts the web process (CrashOnOverflow in
    // AccessibilityObjectAtspi::selectionChanged) on text selection changes. Keep it from
    // ever connecting: no ATK bridge and an unreachable accessibility bus.
    #[cfg(target_os = "linux")]
    // SAFETY: called first thing in main, before any other thread exists.
    unsafe {
        std::env::set_var("NO_AT_BRIDGE", "1");
        std::env::set_var("GTK_A11Y", "none");
        std::env::set_var("WEBKIT_A11Y_BUS_ADDRESS", "unix:path=/nonexistent/oviate-no-a11y");
        std::env::set_var("AT_SPI_BUS_ADDRESS", "unix:path=/nonexistent/oviate-no-a11y");
    }
    oviate_lib::run()
}
