mod ollama;

use ollama::AiState;

pub fn run() {
    // Load configuration from the first .env we can find. Real process
    // environment variables always win over file contents.
    load_dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AiState::default())
        .invoke_handler(tauri::generate_handler![
            ollama::ai_status,
            ollama::ai_set_api_key,
            ollama::ai_generate_word_context,
            ollama::ai_generate_ruku_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quran Studio");
}

/// In development the working directory is `src-tauri/`, so the project root
/// `.env` lives one level up. In a bundled build there is no project tree, and
/// the key is expected either in the real environment or in the per-user
/// config file written by `ai_set_api_key`.
fn load_dotenv() {
    for candidate in [".env", "../.env"] {
        if dotenvy::from_filename(candidate).is_ok() {
            break;
        }
    }
    if let Some(path) = ollama::user_config_path() {
        // `from_path` does not override variables that are already set.
        let _ = dotenvy::from_path(&path);
    }
}
