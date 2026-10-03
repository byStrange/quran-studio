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

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

/// The only host recordings are fetched from — the same one the CSP's
/// `media-src` allows for streaming. The download command takes a URL from the
/// frontend, so without this check it would fetch (and write to disk) anything
/// it was handed.
const RECITATION_HOST: &str = "download.quranicaudio.com";

/// How long to wait for a connection before giving up.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long a response may go without delivering a byte. Without it a stalled
/// connection would hold the download open — and its progress bar frozen —
/// forever.
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Cancellation signals for downloads currently in flight, keyed by their id.
///
/// A `watch` channel rather than a flag, so cancelling can wake a download
/// that is parked waiting on the network instead of only being noticed at the
/// next chunk boundary.
#[derive(Default)]
pub struct DownloadState {
    cancels: std::sync::Mutex<std::collections::HashMap<String, watch::Sender<bool>>>,
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
    /// A second download for an id that is already in flight. Refused rather
    /// than run, because both would write the same `.part` file.
    #[error("this surah is already downloading")]
    AlreadyDownloading,
    /// A download URL that is not on the recitation CDN.
    #[error("this download address is not allowed")]
    DisallowedUrl,
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

/// One downloaded surah, as listed for Settings.
#[derive(Serialize)]
pub struct DownloadEntry {
    reciter_id: i64,
    surah_number: i64,
    bytes: u64,
}

/// Whether a URL points at the recitation CDN over HTTPS.
fn is_allowed_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some(RECITATION_HOST)
        && matches!(url.port(), None | Some(443))
}

/// The HTTP client shared by every download.
///
/// Redirects are followed only while they stay on the recitation host: the
/// CDN may legitimately bounce between paths, but a redirect elsewhere would
/// undo the allowlist check made on the original URL.
fn http_client() -> Result<&'static reqwest::Client, AudioError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(READ_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many redirects")
            } else if is_allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| AudioError::Http(e.to_string()))?;
    Ok(CLIENT.get_or_init(|| client))
}

/// Resolves once the download is cancelled.
///
/// If the sender is gone the download can no longer be cancelled, so this
/// never resolves rather than reporting a cancellation that did not happen.
async fn cancelled(rx: &mut watch::Receiver<bool>) {
    if rx.wait_for(|cancelled| *cancelled).await.is_err() {
        std::future::pending::<()>().await;
    }
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

/// Every surah downloaded for any reciter, with its size on disk.
///
/// Counts only what `recitation_local_file` would accept — a non-empty regular
/// file for a real surah — so the list never claims a download the player
/// would then refuse.
#[tauri::command]
pub async fn recitation_downloads(app: AppHandle) -> Result<Vec<DownloadEntry>, AudioError> {
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
            .filter(|id| (0..=100_000).contains(id))
        else {
            continue;
        };
        let Ok(mut surahs) = tokio::fs::read_dir(reciter.path()).await else {
            continue;
        };
        while let Ok(Some(surah)) = surahs.next_entry().await {
            let Some(surah_number) = surah
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".mp3"))
                .and_then(|stem| stem.parse::<i64>().ok())
                .filter(|number| (1..=114).contains(number))
            else {
                continue;
            };
            match tokio::fs::metadata(surah.path()).await {
                Ok(meta) if meta.is_file() && meta.len() > 0 => found.push(DownloadEntry {
                    reciter_id,
                    surah_number,
                    bytes: meta.len(),
                }),
                _ => {}
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
    let url = reqwest::Url::parse(&url).map_err(|_| AudioError::DisallowedUrl)?;
    if !is_allowed_url(&url) {
        return Err(AudioError::DisallowedUrl);
    }

    // Checked and claimed under one lock, so two calls racing for the same id
    // cannot both get past the check.
    let mut cancel = {
        let mut cancels = state.cancels.lock().unwrap();
        if cancels.contains_key(&id) {
            return Err(AudioError::AlreadyDownloading);
        }
        let (tx, rx) = watch::channel(false);
        cancels.insert(id.clone(), tx);
        rx
    };
    // Whatever happens below, this download stops being cancellable. Created
    // only after the claim succeeds, so a refused duplicate can never remove
    // the running download's entry.
    let _guard = CancelGuard {
        state: state.inner(),
        id: id.clone(),
    };

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AudioError::Io(e.to_string()))?;
    }

    let part = path.with_extension("part");
    match fetch_to_file(&app, &id, url, &part, &path, &mut cancel).await {
        Ok(received) => {
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
        Err(e) => {
            // Every failure — cancel, timeout, network, disk — leaves nothing
            // behind; a stray `.part` would otherwise sit in the data
            // directory unaccounted for. Nothing else can be writing it, since
            // the id is claimed above.
            let _ = tokio::fs::remove_file(&part).await;
            Err(e)
        }
    }
}

/// Streams `url` into `part`, then renames it to `path`. Returns the byte
/// count. Leaves cleanup of `part` on failure to the caller, so there is one
/// place that does it.
async fn fetch_to_file(
    app: &AppHandle,
    id: &str,
    url: reqwest::Url,
    part: &Path,
    path: &Path,
    cancel: &mut watch::Receiver<bool>,
) -> Result<u64, AudioError> {
    let request = http_client()?.get(url).send();
    let response = tokio::select! {
        response = request => response.map_err(|e| AudioError::Http(e.to_string()))?,
        _ = cancelled(cancel) => return Err(AudioError::Cancelled),
    };

    if !response.status().is_success() {
        return Err(AudioError::Status(response.status().as_u16()));
    }
    let total = response.content_length();

    let mut file = tokio::fs::File::create(part)
        .await
        .map_err(|e| AudioError::Io(e.to_string()))?;

    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let mut stream = response;

    loop {
        // Raced against the cancel signal so a cancel lands even while the
        // read is stalled; the read timeout on the client bounds the stall
        // itself.
        let chunk = tokio::select! {
            chunk = stream.chunk() => chunk.map_err(|e| AudioError::Http(e.to_string()))?,
            _ = cancelled(cancel) => return Err(AudioError::Cancelled),
        };
        let Some(bytes) = chunk else { break };

        file.write_all(&bytes)
            .await
            .map_err(|e| AudioError::Io(e.to_string()))?;
        received += bytes.len() as u64;

        // A surah is tens of megabytes over hundreds of chunks; emitting every
        // one would spend more time in IPC than in the download.
        if last_emit.elapsed() >= Duration::from_millis(200) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "recitation-download-progress",
                DownloadProgress {
                    id: id.to_owned(),
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

    tokio::fs::rename(part, path)
        .await
        .map_err(|e| AudioError::Io(e.to_string()))?;

    Ok(received)
}

/// Cancels a download in flight. Unknown ids — already finished, or never
/// started — are ignored.
#[tauri::command]
pub fn recitation_cancel_download(state: State<'_, DownloadState>, id: String) {
    if let Some(cancel) = state.cancels.lock().unwrap().get(&id) {
        cancel.send_replace(true);
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
