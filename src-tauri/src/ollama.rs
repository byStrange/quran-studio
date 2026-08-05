//! Ollama Cloud proxy.
//!
//! Every AI call in the app funnels through here so that `OLLAMA_API_KEY`
//! stays in the Rust process and never reaches the webview or the frontend
//! bundle. The frontend can only ask for two specific, prompt-shaped things:
//! a word context explanation and a ruku summary. It cannot pass arbitrary
//! prompts through to the provider.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;

const DEFAULT_BASE_URL: &str = "https://ollama.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

/// Preference order for model discovery. The catalog changes over time, so we
/// resolve against `/api/tags` at runtime rather than hardcoding a single
/// name; these are only ranking hints, and any `*-cloud` model is acceptable.
const MODEL_PREFERENCES: &[&str] = &[
    "qwen3-coder:480b-cloud",
    "gpt-oss:120b-cloud",
    "deepseek-v3.1:671b-cloud",
    "kimi-k2:1t-cloud",
    "glm-4.6:cloud",
];

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("Ollama Cloud is not configured. Add OLLAMA_API_KEY in Settings or your .env file.")]
    NotConfigured,
    #[error("network error talking to Ollama Cloud: {0}")]
    Network(String),
    #[error("Ollama Cloud returned {status}: {body}")]
    Api { status: u16, body: String },
    #[error("no cloud-capable model found in the Ollama catalog")]
    NoModel,
    #[error("unexpected response shape from Ollama Cloud")]
    BadResponse,
    #[error("could not persist the API key: {0}")]
    Persist(String),
}

// Tauri commands must return a serializable error.
impl serde::Serialize for AiError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

type AiResult<T> = Result<T, AiError>;

/// Caches the resolved model name for the process lifetime so that we hit
/// `/api/tags` once rather than on every generation.
#[derive(Default)]
pub struct AiState {
    resolved_model: Mutex<Option<String>>,
}

#[derive(Serialize)]
pub struct AiStatus {
    pub configured: bool,
    pub model: Option<String>,
    /// Present when configured but unreachable/unusable, for the settings UI.
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct WordContext {
    pub explanation: String,
    pub model_used: String,
}

#[derive(Serialize)]
pub struct RukuSummary {
    pub summary: String,
    pub model_used: String,
}

// --- configuration ---------------------------------------------------------

fn api_key() -> Option<String> {
    std::env::var("OLLAMA_API_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
}

fn base_url() -> String {
    std::env::var("OLLAMA_BASE_URL")
        .ok()
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
}

/// `~/.config/quran-studio/.env` (or the platform equivalent) — where
/// `ai_set_api_key` stores the key for bundled builds that have no project
/// tree to read a `.env` from.
pub fn user_config_path() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".config"))
        })?;
    Some(base.join("quran-studio").join(".env"))
}

fn client() -> AiResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| AiError::Network(e.to_string()))
}

// --- model discovery -------------------------------------------------------

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<TagModel>,
}

#[derive(Deserialize)]
struct TagModel {
    #[serde(default)]
    name: String,
    #[serde(default)]
    model: String,
}

/// Resolves a usable hosted model, preferring an explicit `OLLAMA_MODEL`, then
/// our preference list, then any model advertising the `-cloud` suffix.
async fn resolve_model(state: &AiState) -> AiResult<String> {
    if let Ok(pinned) = std::env::var("OLLAMA_MODEL") {
        let pinned = pinned.trim().to_string();
        if !pinned.is_empty() {
            return Ok(pinned);
        }
    }

    if let Some(cached) = state.resolved_model.lock().ok().and_then(|m| m.clone()) {
        return Ok(cached);
    }

    let key = api_key().ok_or(AiError::NotConfigured)?;
    let url = format!("{}/api/tags", base_url());
    let resp = client()?
        .get(&url)
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| AiError::Network(e.to_string()))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AiError::Network(e.to_string()))?;
    if !status.is_success() {
        return Err(AiError::Api {
            status: status.as_u16(),
            body: truncate(&body, 300),
        });
    }

    let tags: TagsResponse = serde_json::from_str(&body).map_err(|_| AiError::BadResponse)?;
    let names: Vec<String> = tags
        .models
        .into_iter()
        .map(|m| if m.name.is_empty() { m.model } else { m.name })
        .filter(|n| !n.is_empty())
        .collect();

    let chosen = MODEL_PREFERENCES
        .iter()
        .find(|pref| names.iter().any(|n| n == *pref))
        .map(|s| s.to_string())
        .or_else(|| names.iter().find(|n| n.contains("-cloud")).cloned())
        .or_else(|| names.iter().find(|n| n.ends_with(":cloud")).cloned())
        .ok_or(AiError::NoModel)?;

    if let Ok(mut slot) = state.resolved_model.lock() {
        *slot = Some(chosen.clone());
    }
    Ok(chosen)
}

// --- chat ------------------------------------------------------------------

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
    options: ChatOptions,
}

#[derive(Serialize)]
struct ChatOptions {
    temperature: f32,
    num_predict: u32,
}

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    message: Option<ChatResponseMessage>,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    #[serde(default)]
    content: String,
}

async fn chat(
    state: &AiState,
    system: &str,
    user: &str,
    max_tokens: u32,
) -> AiResult<(String, String)> {
    let key = api_key().ok_or(AiError::NotConfigured)?;
    let model = resolve_model(state).await?;

    let request = ChatRequest {
        model: &model,
        messages: vec![
            ChatMessage { role: "system", content: system },
            ChatMessage { role: "user", content: user },
        ],
        stream: false,
        options: ChatOptions { temperature: 0.3, num_predict: max_tokens },
    };

    let resp = client()?
        .post(format!("{}/api/chat", base_url()))
        .bearer_auth(&key)
        .json(&request)
        .send()
        .await
        .map_err(|e| AiError::Network(e.to_string()))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AiError::Network(e.to_string()))?;
    if !status.is_success() {
        return Err(AiError::Api { status: status.as_u16(), body: truncate(&body, 300) });
    }

    let parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| AiError::BadResponse)?;
    let content = parsed
        .message
        .map(|m| m.content)
        .ok_or(AiError::BadResponse)?;

    let cleaned = clean_output(&content);
    if cleaned.is_empty() {
        return Err(AiError::BadResponse);
    }
    Ok((cleaned, model))
}

/// Hosted reasoning models sometimes wrap output in `<think>` blocks or
/// markdown fences. Strip those so the cached text is clean prose.
fn clean_output(raw: &str) -> String {
    let mut text = raw.to_string();
    while let (Some(start), Some(end)) = (text.find("<think>"), text.find("</think>")) {
        if start < end {
            text.replace_range(start..end + "</think>".len(), "");
        } else {
            break;
        }
    }
    let text = text.trim();
    let text = text
        .strip_prefix("```markdown")
        .or_else(|| text.strip_prefix("```"))
        .map(|t| t.trim_start_matches('\n').trim_end_matches("```"))
        .unwrap_or(text);
    text.trim().to_string()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // Respect char boundaries so we never panic on multi-byte input.
        let end = s
            .char_indices()
            .map(|(i, _)| i)
            .take_while(|i| *i <= max)
            .last()
            .unwrap_or(0);
        format!("{}…", &s[..end])
    }
}

// --- commands --------------------------------------------------------------

#[tauri::command]
pub async fn ai_status(state: tauri::State<'_, AiState>) -> Result<AiStatus, AiError> {
    if api_key().is_none() {
        return Ok(AiStatus { configured: false, model: None, error: None });
    }
    match resolve_model(&state).await {
        Ok(model) => Ok(AiStatus { configured: true, model: Some(model), error: None }),
        Err(e) => Ok(AiStatus { configured: true, model: None, error: Some(e.to_string()) }),
    }
}

/// Persists the key to the per-user config file and applies it to the running
/// process, so Settings can configure AI without editing files by hand.
#[tauri::command]
pub async fn ai_set_api_key(
    state: tauri::State<'_, AiState>,
    api_key: String,
) -> Result<AiStatus, AiError> {
    let trimmed = api_key.trim().to_string();
    let path = user_config_path().ok_or_else(|| {
        AiError::Persist("could not determine a config directory".to_string())
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AiError::Persist(e.to_string()))?;
    }
    std::fs::write(&path, format!("OLLAMA_API_KEY={trimmed}\n"))
        .map_err(|e| AiError::Persist(e.to_string()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    // SAFETY: single-threaded startup-style mutation; Tauri commands are
    // serialized on the async runtime and nothing else reads env concurrently.
    unsafe { std::env::set_var("OLLAMA_API_KEY", &trimmed) };
    if let Ok(mut slot) = state.resolved_model.lock() {
        *slot = None; // force re-discovery with the new credentials
    }

    if trimmed.is_empty() {
        return Ok(AiStatus { configured: false, model: None, error: None });
    }
    match resolve_model(&state).await {
        Ok(model) => Ok(AiStatus { configured: true, model: Some(model), error: None }),
        Err(e) => Ok(AiStatus { configured: true, model: None, error: Some(e.to_string()) }),
    }
}

const WORD_SYSTEM: &str = "You are a precise Quranic Arabic teacher writing for an English-speaking \
student who is memorizing the Quran. Explain why a specific word form is used in a specific ayah: \
its grammatical role, the nuance that distinguishes it from a near-synonym, or its thematic \
significance in that passage. Write two or three sentences of plain prose. Do not restate the \
translation, do not use markdown, headings, or lists, and do not add any preamble.";

#[tauri::command]
pub async fn ai_generate_word_context(
    state: tauri::State<'_, AiState>,
    arabic: String,
    transliteration: String,
    gloss: String,
    surah_number: i32,
    ayah_number: i32,
    verse_arabic: String,
    verse_translation: String,
) -> Result<WordContext, AiError> {
    let prompt = format!(
        "Word: {arabic} ({transliteration}) — commonly glossed as \"{gloss}\".\n\
         It appears in Surah {surah_number}, ayah {ayah_number}.\n\n\
         Full ayah (Arabic): {verse_arabic}\n\
         Full ayah (English): {verse_translation}\n\n\
         Explain why this particular word and form is used here."
    );
    let (explanation, model_used) = chat(&state, WORD_SYSTEM, &prompt, 300).await?;
    Ok(WordContext { explanation, model_used })
}

const RUKU_SYSTEM: &str = "You are a Quran study guide writing for an English-speaking student \
memorizing the Quran ruku by ruku. Given a passage, write one short paragraph — four to six \
sentences — covering its central theme, how the passage develops, and what a student should take \
away from it. Write plain prose. Do not use markdown, headings, or lists, do not number the \
ayahs, and do not add any preamble.";

#[tauri::command]
pub async fn ai_generate_ruku_summary(
    state: tauri::State<'_, AiState>,
    ruku_number: i32,
    surah_name: String,
    verse_range: String,
    passage: String,
) -> Result<RukuSummary, AiError> {
    let prompt = format!(
        "Ruku {ruku_number} of the Quran — Surah {surah_name}, ayahs {verse_range}.\n\n\
         Passage (English translation):\n{passage}\n\n\
         Summarize what a student should learn and take away from this ruku."
    );
    let (summary, model_used) = chat(&state, RUKU_SYSTEM, &prompt, 500).await?;
    Ok(RukuSummary { summary, model_used })
}
