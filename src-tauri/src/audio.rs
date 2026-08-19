//! Offline recitation downloads.
//!
//! Surah recordings are streamed from quran.com's CDN by default, which is
//! enough to listen and cheap to start. Downloading exists for the case
//! streaming cannot serve: revising on a commute, or anywhere the network is
//! absent or metered. A surah is one file, so a download is one request — the
//! same file the player would otherwise stream, saved to disk.
//!
//! Files land in the app's data directory under `recitations/<reciter>/<surah>.mp3`
//! and are played back through Tauri's asset protocol. The frontend decides
//! which source to use by asking whether a local copy exists.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;

/// Cancellation flags for downloads currently in flight, keyed by their id.
#[derive(Default)]
pub struct DownloadState {
    cancels: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, thiserror::Error)]
pub enum AudioError {
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
    /// A surah number or reciter id that could never name a real file. Checked
    /// because both are interpolated into a path.
    #[error("invalid recitation reference")]
    InvalidReference,
}

impl Serialize for AudioError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    id: String,
    received: u64,
    total: Option<u64>,
}

#[derive(Serialize)]
pub struct DownloadedFile {
    /// Absolute path, for the frontend to hand to `convertFileSrc`.
    path: String,
    bytes: u64,
}

/// Where one surah's recording is kept.
///
/// The reciter id and surah number are the only variable parts and both are
/// range-checked before they reach the path, so a caller cannot walk out of
/// the data directory by way of a crafted id.
fn recitation_path(
    app: &AppHandle,
    reciter_id: i64,
    surah_number: i64,
) -> Result<PathBuf, AudioError> {
    if !(1..=114).contains(&surah_number) || !(0..=100_000).contains(&reciter_id) {
        return Err(AudioError::InvalidReference);
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| AudioError::NoDataDir)?;
    Ok(base
        .join("recitations")
        .join(reciter_id.to_string())
        .join(format!("{surah_number}.mp3")))
}

/// The local copy of a surah, if one has been downloaded.
#[tauri::command]
pub async fn recitation_local_file(
    app: AppHandle,
    reciter_id: i64,
    surah_number: i64,
) -> Result<Option<DownloadedFile>, AudioError> {
    let path = recitation_path(&app, reciter_id, surah_number)?;
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_file() && meta.len() > 0 => Ok(Some(DownloadedFile {
            path: path.to_string_lossy().into_owned(),
            bytes: meta.len(),
        })),
        _ => Ok(None),
    }
}

/// Every surah downloaded for any reciter, as `(reciter_id, surah_number)`.
#[tauri::command]
pub async fn recitation_downloads(app: AppHandle) -> Result<Vec<(i64, i64)>, AudioError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|_| AudioError::NoDataDir)?
        .join("recitations");

    let mut found = Vec::new();
    let Ok(mut reciters) = tokio::fs::read_dir(&base).await else {
        return Ok(found);
    };
    while let Ok(Some(reciter)) = reciters.next_entry().await {
        let Some(reciter_id) = reciter
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<i64>().ok())
        else {
            continue;
        };
        let Ok(mut surahs) = tokio::fs::read_dir(reciter.path()).await else {
            continue;
        };
        while let Ok(Some(surah)) = surahs.next_entry().await {
            if let Some(number) = surah
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".mp3"))
                .and_then(|stem| stem.parse::<i64>().ok())
            {
                found.push((reciter_id, number));
            }
        }
    }
    Ok(found)
}

/// Downloads one surah, emitting progress as it goes.
///
/// Written to a `.part` file and renamed only once complete, so an interrupted
/// download can never be mistaken for a playable one — the check in
/// `recitation_local_file` is existence, and a half-written mp3 that passed it
/// would fail at the point the reader pressed play.
#[tauri::command]
pub async fn recitation_download(
    app: AppHandle,
    state: State<'_, DownloadState>,
    id: String,
    url: String,
    reciter_id: i64,
    surah_number: i64,
) -> Result<DownloadedFile, AudioError> {
    let path = recitation_path(&app, reciter_id, surah_number)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AudioError::Io(e.to_string()))?;
    }

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state.cancels.lock().unwrap();
        cancels.insert(id.clone(), Arc::clone(&cancel));
    }
    // Whatever happens below, this download stops being cancellable.
    let _guard = CancelGuard {
        state: state.inner(),
        id: id.clone(),
    };

    let response = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| AudioError::Http(e.to_string()))?;

    if !response.status().is_success() {
        return Err(AudioError::Status(response.status().as_u16()));
    }
    let total = response.content_length();

    let part = path.with_extension("part");
    let mut file = tokio::fs::File::create(&part)
        .await
        .map_err(|e| AudioError::Io(e.to_string()))?;

    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response;

    loop {
        if cancel.load(Ordering::Relaxed) {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(AudioError::Cancelled);
        }

        let chunk = stream
            .chunk()
            .await
            .map_err(|e| AudioError::Http(e.to_string()))?;
        let Some(bytes) = chunk else { break };

        file.write_all(&bytes)
            .await
            .map_err(|e| AudioError::Io(e.to_string()))?;
        received += bytes.len() as u64;

        // A surah is tens of megabytes over hundreds of chunks; emitting every
        // one would spend more time in IPC than in the download.
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "recitation-download-progress",
                DownloadProgress {
                    id: id.clone(),
                    received,
                    total,
                },
            );
        }
    }

    file.flush()
        .await
        .map_err(|e| AudioError::Io(e.to_string()))?;
    drop(file);

    tokio::fs::rename(&part, &path)
        .await
        .map_err(|e| AudioError::Io(e.to_string()))?;

    let _ = app.emit(
        "recitation-download-progress",
        DownloadProgress {
            id: id.clone(),
            received,
            total: Some(received),
        },
    );

    Ok(DownloadedFile {
        path: path.to_string_lossy().into_owned(),
        bytes: received,
    })
}

#[tauri::command]
pub fn recitation_cancel_download(state: State<'_, DownloadState>, id: String) {
    if let Some(flag) = state.cancels.lock().unwrap().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub async fn recitation_remove_download(
    app: AppHandle,
    reciter_id: i64,
    surah_number: i64,
) -> Result<(), AudioError> {
    let path = recitation_path(&app, reciter_id, surah_number)?;
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        // Already gone is the desired end state.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AudioError::Io(e.to_string())),
    }
}

struct CancelGuard<'a> {
    state: &'a DownloadState,
    id: String,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut cancels) = self.state.cancels.lock() {
            cancels.remove(&self.id);
        }
    }
}
