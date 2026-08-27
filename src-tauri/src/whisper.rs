use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

const MODEL_URL: &str =
    "https://huggingface.co/ram-a-dhan/tarteel-whisper-quran-ggml/resolve/main/tarteel-ai-whisper-base-ar-quran-ggml-q8_0.bin";

#[derive(Default)]
pub struct WhisperState {
    context: Mutex<Option<Arc<whisper_rs::WhisperContext>>>,
    cancel_download: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[derive(Debug, thiserror::Error)]
pub enum WhisperError {
    #[error("could not resolve the app data directory")]
    NoDataDir,
    #[error("network error: {0}")]
    Http(String),
    #[error("the server returned {0}")]
    Status(u16),
    #[error("filesystem error: {0}")]
    Io(String),
    #[error("download cancelled")]
    Cancelled,
    #[error("whisper error: {0}")]
    Whisper(String),
}

impl Serialize for WhisperError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Serialize)]
pub struct WhisperStatusResponse {
    downloaded: bool,
    model_size_bytes: Option<u64>,
    ready: bool,
    supported: bool,
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    received: u64,
    total: Option<u64>,
}

/// Resolves the absolute path to the local model file.
fn model_path(app: &AppHandle) -> Result<PathBuf, WhisperError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| WhisperError::NoDataDir)?;
    Ok(base.join("models").join("ggml-base-ar-quran.bin"))
}

#[tauri::command]
pub async fn whisper_status(
    app: AppHandle,
    state: State<'_, WhisperState>,
) -> Result<WhisperStatusResponse, WhisperError> {
    let path = model_path(&app)?;
    let (downloaded, size) = match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_file() => (true, Some(meta.len())),
        _ => (false, None),
    };

    let ready = state.context.lock().unwrap().is_some();

    Ok(WhisperStatusResponse {
        downloaded,
        model_size_bytes: size,
        ready,
        supported: true,
    })
}

#[tauri::command]
pub async fn whisper_download_model(
    app: AppHandle,
    state: State<'_, WhisperState>,
) -> Result<(), WhisperError> {
    let path = model_path(&app)?;

    if tokio::fs::metadata(&path).await.is_ok() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| WhisperError::Io(e.to_string()))?;
    }

    state.cancel_download.store(false, std::sync::atomic::Ordering::Relaxed);

    // The URL might need adjustment or verification if huggingface structure changes.
    let response = reqwest::Client::new()
        .get(MODEL_URL)
        .send()
        .await
        .map_err(|e| WhisperError::Http(e.to_string()))?;

    if !response.status().is_success() {
        return Err(WhisperError::Status(response.status().as_u16()));
    }

    let total = response.content_length();

    let part = path.with_extension("part");
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| WhisperError::Io(e.to_string()))?;

    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response;

    loop {
        if state.cancel_download.load(std::sync::atomic::Ordering::Relaxed) {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(WhisperError::Cancelled);
        }

        let chunk = stream
            .chunk()
            .await
            .map_err(|e| WhisperError::Http(e.to_string()))?;
            
        let Some(bytes) = chunk else { break };

        file.write_all(&bytes)
            .await
            .map_err(|e| WhisperError::Io(e.to_string()))?;
        received += bytes.len() as u64;

        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "whisper-download-progress",
                DownloadProgress {
                    received,
                    total,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| WhisperError::Io(e.to_string()))?;
    drop(file);

    tokio::fs::rename(&part, &path)
        .await
        .map_err(|e| WhisperError::Io(e.to_string()))?;

    let _ = app.emit(
        "whisper-download-progress",
        DownloadProgress {
            received,
            total: Some(received),
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn whisper_transcribe(
    audio_pcm: Vec<f32>,
    state: State<'_, WhisperState>,
    app: AppHandle,
) -> Result<String, WhisperError> {
    let path = model_path(&app)?;

    // Lazy load the model on the first transcription request
    let ctx = {
        let mut context_guard = state.context.lock().unwrap();
        if context_guard.is_none() {
            if !path.exists() {
                return Err(WhisperError::Whisper("Model not downloaded".to_string()));
            }
            let ctx = whisper_rs::WhisperContext::new_with_params(
                &*path.to_string_lossy(),
                whisper_rs::WhisperContextParameters::default(),
            )
            .map_err(|e| WhisperError::Whisper(e.to_string()))?;
            *context_guard = Some(Arc::new(ctx));
        }
        context_guard.as_ref().unwrap().clone()
    };

    // Run inference in a blocking task since it is highly CPU-bound and would
    // stall the async runtime otherwise.
    let text = tokio::task::spawn_blocking(move || {
        let mut whisper_state = ctx
            .create_state()
            .map_err(|e| WhisperError::Whisper(e.to_string()))?;

        let mut params =
            whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("ar"));
        params.set_translate(false);
        params.set_single_segment(true);

        whisper_state
            .full(params, &audio_pcm)
            .map_err(|e| WhisperError::Whisper(e.to_string()))?;

        // In whisper-rs 0.16, full_n_segments returns i32 directly, and
        // segment text is accessed via get_segment().text.
        let num_segments = whisper_state.full_n_segments();
        let mut result = String::new();
        for i in 0..num_segments {
            if let Some(segment) = whisper_state.get_segment(i) {
                if let Ok(text) = segment.to_str_lossy() {
                    result.push_str(&text);
                }
            }
        }
        Ok::<String, WhisperError>(result)
    })
    .await
    .map_err(|e| WhisperError::Whisper(e.to_string()))??;

    Ok(text)
}
