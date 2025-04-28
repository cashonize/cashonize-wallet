// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri_plugin_prevent_default::Flags;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_prevent_default::Builder::new()
                .with_flags(Flags::all()) // <-- disable all browser defaults
                .build()
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
