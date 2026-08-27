mod audio;
mod ollama;
mod whisper;

use audio::DownloadState;
use ollama::AiState;
use whisper::WhisperState;

/// On desktop `main` calls this directly. Android has no `main`: the activity
/// loads this library and calls the entry symbol the macro exports, so without
/// it the `.so` builds fine and then fails validation for missing symbols.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Taken before any file is read, so it holds only what the shell exported.
    let from_shell: std::collections::HashSet<String> = std::env::vars().map(|(k, _)| k).collect();

    // Real process environment variables always win over file contents.
    load_project_dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AiState::default())
        .manage(DownloadState::default())
        .manage(WhisperState::default())
        // The per-user config file needs Tauri's path resolver, which only
        // exists once there is an app handle — hence a setup step rather than
        // another call alongside `load_project_dotenv`. It still runs before
        // the webview can invoke a command, so `ai_status` sees the key.
        .setup(move |app| {
            load_user_config(app.handle(), &from_shell);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ollama::ai_status,
            ollama::ai_set_api_key,
            ollama::ai_generate_word_context,
            ollama::ai_generate_ruku_summary,
            audio::recitation_local_file,
            audio::recitation_downloads,
            audio::recitation_download,
            audio::recitation_cancel_download,
            audio::recitation_remove_download,
            whisper::whisper_status,
            whisper::whisper_download_model,
            whisper::whisper_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quran Studio");
}

/// In development the working directory is `src-tauri/`, so the project root
/// `.env` lives one level up. A bundled build has no project tree and finds
/// nothing here, which is fine — the key then comes from the environment or
/// from the per-user config file written by `ai_set_api_key`.
fn load_project_dotenv() {
    for candidate in [".env", "../.env"] {
        if dotenvy::from_filename(candidate).is_ok() {
            break;
        }
    }
}

/// Applies the per-user config file written by `ai_set_api_key`.
///
/// Precedence, strongest first: the real process environment, the per-user
/// config file, then the project `.env`. The per-user file has to beat the
/// project `.env` — it is what Settings writes, and a key saved there would
/// otherwise be silently ignored on the next launch. `from_shell` is what the
/// process started with, so file values can override the project `.env`
/// without clobbering a variable the user actually exported.
fn load_user_config(app: &tauri::AppHandle, from_shell: &std::collections::HashSet<String>) {
    let mut paths = Vec::new();
    #[cfg(desktop)]
    if let Some(path) = ollama::legacy_config_path() {
        paths.push(path);
    }
    if let Some(path) = ollama::user_config_path(app) {
        paths.push(path);
    }

    // Last one wins, so the resolver path overrides the legacy location.
    for path in paths {
        // `from_path` never overrides an existing variable, so apply the file
        // by hand to let it win over values the project `.env` just set.
        if let Ok(entries) = dotenvy::from_path_iter(&path) {
            for (key, value) in entries.flatten() {
                if !from_shell.contains(&key) {
                    // SAFETY: startup, before any thread reads the environment.
                    unsafe { std::env::set_var(&key, &value) };
                }
            }
        }
    }
}
