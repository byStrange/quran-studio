//! Ollama Cloud proxy.
//!
//! Every AI call in the app funnels through here so that `OLLAMA_API_KEY`
//! stays in the Rust process and never reaches the webview or the frontend
//! bundle. The frontend can only ask for specific, prompt-shaped things — a
//! word context explanation, a ruku summary, a knowledge quiz (from the ayahs
//! or from their tafsir) and a tafsir study summary. It cannot pass arbitrary
//! prompts through to the provider.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const DEFAULT_BASE_URL: &str = "https://ollama.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
/// Vision requests carry image data up and read a dense page, so they run well
/// past the text timeout.
const VISION_TIMEOUT: Duration = Duration::from_secs(180);

/// What we ask for unless the catalog says otherwise or `OLLAMA_MODEL` pins
/// something else.
const DEFAULT_MODEL: &str = "gemma4:31b-cloud";

/// Preference order for model discovery. The catalog changes over time, so we
/// resolve against `/api/tags` at runtime rather than trusting a single name;
/// these are only ranking hints, and any catalog entry is acceptable.
const MODEL_PREFERENCES: &[&str] = &[
    DEFAULT_MODEL,
    "gpt-oss:120b",
    "qwen3.5:397b",
    "deepseek-v4-pro:preview",
];

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("Ollama Cloud is not configured. Add OLLAMA_API_KEY in Settings or your .env file.")]
    NotConfigured,
    #[error("network error talking to Ollama Cloud: {0}")]
    Network(String),
    #[error("Ollama Cloud returned {status}: {body}")]
    Api { status: u16, body: String },
    #[error("the Ollama catalog lists no models for this account")]
    NoModel,
    #[error("unexpected response shape from Ollama Cloud")]
    BadResponse,
    #[error("Ollama Cloud did not return the expected gloss JSON — it replied with something else. Try again. (got: {0})")]
    BadGlossShape(String),
    #[error("the model's reply was cut off before it finished; try again")]
    Truncated,
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

/// A vision-capable model, pinned explicitly. The default catalog picks are all
/// text-only, so gloss extraction reads `OLLAMA_VISION_MODEL` and falls back to
/// the normal resolved model only when it is unset (which then needs to be a
/// multimodal one, or the request fails with the provider's own error).
fn vision_model() -> Option<String> {
    std::env::var("OLLAMA_VISION_MODEL")
        .ok()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
}

/// Where `ai_set_api_key` stores the key for bundled builds that have no
/// project tree to read a `.env` from.
///
/// The path has to come from Tauri rather than from `XDG_CONFIG_HOME`/`HOME`:
/// an Android app process is given neither, so a hand-built `~/.config` path
/// resolves to nothing there and the key can never be saved. The resolver
/// returns the app's private data directory on Android and the usual
/// per-user config directory on desktop.
pub fn user_config_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(".env"))
}

/// Earlier desktop builds wrote to `~/.config/quran-studio/.env`, which is not
/// where the resolver points. Read-only fallback so a key saved before the
/// move keeps working; nothing writes here any more.
#[cfg(desktop)]
pub fn legacy_config_path() -> Option<std::path::PathBuf> {
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

/// The catalog lists bare names (`gemma4:31b`) while the hosted variant is
/// also addressable with a suffix (`gemma4:31b-cloud`). Both route to the same
/// model, so compare on the stem to avoid missing a match on spelling alone.
fn base_name(name: &str) -> &str {
    name.strip_suffix("-cloud")
        .or_else(|| name.strip_suffix(":cloud"))
        .unwrap_or(name)
}

/// Resolves a usable hosted model, preferring an explicit `OLLAMA_MODEL`, then
/// our preference list, then whatever the catalog lists first.
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
        .find(|pref| names.iter().any(|n| base_name(n) == base_name(pref)))
        .map(|s| s.to_string())
        .or_else(|| names.first().cloned())
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
    /// Base64-encoded images (no `data:` URL prefix) for a vision model, as
    /// Ollama's chat API takes them. Omitted entirely for the text generators.
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    stream: bool,
    options: ChatOptions,
    /// A JSON schema the reply must satisfy. Ollama constrains decoding to it,
    /// which is worth much more than asking for JSON in the prompt: the reply
    /// cannot come back as prose that happens to mention a brace. Omitted for
    /// the prose generators, which want no constraint at all.
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<serde_json::Value>,
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
    /// "length" when generation stopped at `num_predict` rather than at the
    /// end of the answer.
    #[serde(default)]
    done_reason: Option<String>,
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
    chat_with(state, system, user, max_tokens, 0.3, None, None).await
}

async fn chat_with(
    state: &AiState,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    format: Option<serde_json::Value>,
    // Overrides `REQUEST_TIMEOUT` for a call known to take longer — a
    // summary of a twenty-paragraph tafsir passage is slow to read and write.
    timeout: Option<Duration>,
) -> AiResult<(String, String)> {
    let key = api_key().ok_or(AiError::NotConfigured)?;
    let model = resolve_model(state).await?;
    let format_requested = format.is_some();

    let request = ChatRequest {
        model: &model,
        messages: vec![
            ChatMessage { role: "system", content: system, images: None },
            ChatMessage { role: "user", content: user, images: None },
        ],
        stream: false,
        options: ChatOptions { temperature, num_predict: max_tokens },
        format,
    };

    let mut builder = client()?
        .post(format!("{}/api/chat", base_url()))
        .bearer_auth(&key)
        .json(&request);
    if let Some(timeout) = timeout {
        builder = builder.timeout(timeout);
    }
    let resp = builder
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
    // A structured reply that ran out of tokens is half an object, which no
    // amount of extraction recovers. Saying so is more use to the reader (and
    // to whoever tunes the budget) than "unexpected response shape".
    if format_requested && parsed.done_reason.as_deref() == Some("length") {
        return Err(AiError::Truncated);
    }
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

/// Rewrites one assignment in a `.env` body, leaving every other line alone —
/// the file may also carry `OLLAMA_MODEL` or a hand-added setting.
fn upsert_env_var(existing: &str, key: &str, value: &str) -> String {
    let prefix = format!("{key}=");
    let mut replaced = false;
    let mut out: Vec<String> = existing
        .lines()
        .map(|line| {
            if line.trim_start().starts_with(&prefix) {
                replaced = true;
                format!("{prefix}{value}")
            } else {
                line.to_string()
            }
        })
        .collect();
    if !replaced {
        out.push(format!("{prefix}{value}"));
    }
    let mut body = out.join("\n");
    body.push('\n');
    body
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
    app: tauri::AppHandle,
    state: tauri::State<'_, AiState>,
    api_key: String,
) -> Result<AiStatus, AiError> {
    let trimmed = api_key.trim().to_string();
    let path = user_config_path(&app).ok_or_else(|| {
        AiError::Persist("could not determine a config directory".to_string())
    })?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AiError::Persist(e.to_string()))?;
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::write(&path, upsert_env_var(&existing, "OLLAMA_API_KEY", &trimmed))
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

/// The language an explanation is written in.
///
/// Resolved from the code the frontend sends rather than trusted verbatim: it
/// is interpolated into a prompt, and an unrecognised value should fall back
/// to English rather than instruct the model in whatever string arrived.
fn language_name(code: &str) -> &'static str {
    match code {
        "ru" => "Russian",
        "uz" => "Uzbek",
        _ => "English",
    }
}

/// Per-language writing notes, appended to whichever system prompt is in use.
///
/// Empty for English and Russian. Both are languages the model writes fluently
/// and, more to the point, both have a large body of Quranic writing in them —
/// asking for "Russian" already gets Russian Islamic register, with `аят` and
/// `сура` rather than calques.
///
/// Uzbek is the case that needs saying out loud, for three reasons, and each
/// line below answers one of them:
///
///   - Script. Uzbek is written in both Latin and Cyrillic, and the model will
///     otherwise pick. The interface is Latin, so the explanations beside it
///     must be too — a paragraph in the other alphabet is not a style blemish,
///     it is unreadable to half the audience.
///   - Register. There is far less Uzbek than Russian or English in any
///     training corpus, so the failure mode is calquing: Russian words in
///     Uzbek endings, or Turkish forms that an Uzbek reader finds archaic. The
///     religious vocabulary is the part that matters, and Uzbek already has a
///     settled one — Alloh, oyat, sura, iymon, taqvo — taken from Arabic
///     directly and used in every Uzbek translation and tafsir in print.
///   - Audience. These explanations sit next to a Cyrillic tafsir edition and
///     an English gloss, so the one thing that must not happen is a sentence
///     that mixes all three.
fn language_guidance(code: &str) -> &'static str {
    match code {
        "uz" => {
            "\n\nUZBEK WRITING NOTES\n\
- Write in modern standard Uzbek in the LATIN alphabet (o'zbek lotin yozuvi). Never \
use Cyrillic.\n\
- Use the established Uzbek Islamic vocabulary, which is borrowed from Arabic \
directly: Alloh, oyat, sura, ruku, tafsir, iymon, taqvo, ibodat, rahmat, shukr, \
sabr, halol, harom. Do not translate these into everyday words and do not route \
them through Russian or English equivalents.\n\
- Do not use a Russian loanword where an ordinary Uzbek word exists.\n\
- Write the way Uzbek religious books are written today — plain, clear literary \
Uzbek. Avoid archaic Chagatai forms and avoid Turkish words that are not Uzbek.\n\
- Quoted Arabic stays in Arabic script. When transliterating Arabic, use Uzbek \
Latin spelling.\n\
- Use the apostrophe forms o' and g' (as in so'z, o'rganish, bog'liq)."
        }
        _ => "",
    }
}

fn word_system(language: &str, guidance: &str) -> String {
    format!(
        "You are a Quranic Arabic teacher helping a {language}-speaking student understand \
individual words while reading the Quran. You will be given one specific word as it appears in a \
specific ayah.\n\n\
First, give the plain meaning of this word in context, in a short, simple phrase — no jargon.\n\n\
Then, in one or two more sentences, add whatever actually helps the student's understanding of THIS \
word: that might be a nuance vs. a near-synonym, why this grammatical form was chosen, or a \
connotation the plain meaning misses. If the word is grammatically simple (a pronoun, particle, or \
common function word) and there is nothing meaningful to add, stop after the plain meaning — do not \
invent significance.\n\n\
Stay scoped to this one word. Do not explain the verse's broader argument, theology, or how this \
word relates to other groups or clauses mentioned elsewhere in the ayah — that belongs to a \
different, verse-level explanation, not a word-level one.\n\n\
Do not use markdown, headings, or lists, and do not add any preamble. Write your entire answer in \
{language}.{guidance}"
    )
}

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
    language: String,
) -> Result<WordContext, AiError> {
    let guidance = language_guidance(&language);
    let language = language_name(&language);
    let prompt = format!(
        "Word: {arabic} ({transliteration}) — commonly glossed as \"{gloss}\".\n\
         It appears in Surah {surah_number}, ayah {ayah_number}.\n\n\
         Full ayah (Arabic): {verse_arabic}\n\
         Full ayah ({language}): {verse_translation}\n\n\
         Explain why this particular word and form is used here."
    );
    let (explanation, model_used) =
        chat(&state, &word_system(language, guidance), &prompt, 300).await?;
    Ok(WordContext { explanation, model_used })
}

fn ruku_system(language: &str, guidance: &str) -> String {
    format!(
        "You are a Quran study guide writing for a {language}-speaking student \
memorizing the Quran ruku by ruku. Given a passage, write one short paragraph — four to six \
sentences — covering its central theme, how the passage develops, and what a student should take \
away from it. Write plain prose. Do not use markdown, headings, or lists, do not number the \
ayahs, and do not add any preamble. Write your entire answer in {language}.{guidance}"
    )
}

#[tauri::command]
pub async fn ai_generate_ruku_summary(
    state: tauri::State<'_, AiState>,
    ruku_number: i32,
    surah_name: String,
    verse_range: String,
    passage: String,
    language: String,
) -> Result<RukuSummary, AiError> {
    let guidance = language_guidance(&language);
    let language = language_name(&language);
    let prompt = format!(
        "Ruku {ruku_number} of the Quran — Surah {surah_name}, ayahs {verse_range}.\n\n\
         Passage ({language} translation):\n{passage}\n\n\
         Summarize what a student should learn and take away from this ruku."
    );
    let (summary, model_used) =
        chat(&state, &ruku_system(language, guidance), &prompt, 500).await?;
    Ok(RukuSummary { summary, model_used })
}

// --- word-by-word gloss extraction (vision) --------------------------------

/// Like `chat_with`, but attaches image(s) to the user message and resolves a
/// vision-capable model. Kept separate from `chat_with` so the text generators
/// are untouched: this path always carries images, a longer timeout and a
/// vision model, and a shared function would only be a pile of options.
async fn chat_vision(
    state: &AiState,
    system: &str,
    user: &str,
    images: Vec<String>,
    max_tokens: u32,
    format: Option<serde_json::Value>,
) -> AiResult<(String, String)> {
    let key = api_key().ok_or(AiError::NotConfigured)?;
    let model = match vision_model() {
        Some(m) => m,
        None => resolve_model(state).await?,
    };
    let format_requested = format.is_some();

    let request = ChatRequest {
        model: &model,
        messages: vec![
            ChatMessage { role: "system", content: system, images: None },
            // Low temperature: this is transcription, not composition.
            ChatMessage { role: "user", content: user, images: Some(images) },
        ],
        stream: false,
        options: ChatOptions { temperature: 0.1, num_predict: max_tokens },
        format,
    };

    let resp = client()?
        .post(format!("{}/api/chat", base_url()))
        .bearer_auth(&key)
        .timeout(VISION_TIMEOUT)
        .json(&request)
        .send()
        .await
        .map_err(|e| AiError::Network(e.to_string()))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| AiError::Network(e.to_string()))?;
    if !status.is_success() {
        return Err(AiError::Api { status: status.as_u16(), body: truncate(&body, 300) });
    }

    let parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| AiError::BadResponse)?;
    if format_requested && parsed.done_reason.as_deref() == Some("length") {
        return Err(AiError::Truncated);
    }
    let content = parsed.message.map(|m| m.content).ok_or(AiError::BadResponse)?;
    let cleaned = clean_output(&content);
    if cleaned.is_empty() {
        return Err(AiError::BadResponse);
    }
    Ok((cleaned, model))
}

/// One Arabic word to be glossed, with the id it is known by in `quran_words`.
/// The list is the scaffold: the model fills a gloss per id, and the alignment
/// back to the word rows is this list, not the model's own reading of the grid.
#[derive(Deserialize)]
pub struct ScaffoldWord {
    pub id: i32,
    pub arabic: String,
}

#[derive(Serialize, Deserialize)]
pub struct ExtractedGloss {
    pub id: i32,
    pub gloss: String,
}

#[derive(Deserialize)]
struct ExtractedGlosses {
    #[serde(default)]
    glosses: Vec<ExtractedGloss>,
}

fn gloss_extract_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "glosses": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "integer" },
                        "gloss": { "type": "string" }
                    },
                    "required": ["id", "gloss"]
                }
            }
        },
        "required": ["glosses"]
    })
}

fn gloss_extract_system(language: &str) -> String {
    format!(
        "You are transcribing a word-by-word translation from a photographed page of a printed \
word-by-word Quran. Under each Arabic word on the page is its {language} translation. You are given \
the exact list of Arabic words to transcribe, each with a numeric id, in the Quran's reading order \
(right to left, line by line). For each id, return ONLY the {language} translation printed directly \
beneath that Arabic word on the page.\n\n\
Rules:\n\
- Transcribe exactly what is printed, in the SAME SCRIPT as the page (if the page is Cyrillic, keep \
it Cyrillic). Do not translate, transliterate, romanize, or correct it.\n\
- Match words by their Arabic, not by position guessing. If a word from the list is not visible on \
the page(s), return an empty string for its gloss. Never invent a translation.\n\
- Ignore ayah-number medallions, the running paragraph translation, headers and page decoration — \
only the small word-under-word glosses.\n\
- Return every id from the list exactly once.\n\n\
OUTPUT\n\
Return JSON only — no prose, no explanation, no markdown fence:\n\
{{\"glosses\":[{{\"id\":0,\"gloss\":\"…\"}}]}}\n\
Copy each `id` from the list; `gloss` is the transcription (an empty string when the word is not \
on the page)."
    )
}

/// Reads the {language} word-by-word glosses off photographed mushaf page(s).
///
/// `words` is the ordered scaffold the app built from `quran_words`; `images`
/// are base64 (no `data:` prefix). The reply is one gloss per id; the app
/// aligns them back by id and lets the contributor correct them before any are
/// stored, so an imperfect read is a starting point, not a commitment.
#[tauri::command]
pub async fn ai_extract_glosses(
    state: tauri::State<'_, AiState>,
    words: Vec<ScaffoldWord>,
    images: Vec<String>,
    language: String,
) -> Result<Vec<ExtractedGloss>, AiError> {
    if words.is_empty() || images.is_empty() {
        return Err(AiError::BadResponse);
    }
    let language = language_name(&language);

    let list = words
        .iter()
        .map(|w| format!("{}\t{}", w.id, w.arabic))
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        "Transcribe the {language} word-by-word gloss for each of these {} Arabic words (id, then \
the Arabic, tab-separated) from the attached page photo(s):\n\n{list}",
        words.len()
    );

    // Budget generously per word: a gloss is a few words, but in Cyrillic each
    // runs to several tokens, and the structured wrapper (id + braces) adds
    // more — too tight a cap makes the model stop mid-array, and a structured
    // reply cut off at `length` is unrecoverable (half an object parses as
    // nothing), so the whole read would be lost. A page's worth of words stays
    // well under this ceiling; a range large enough to exceed it should be split
    // across more passes, which the per-page workflow already nudges toward.
    let budget = (words.len() as u32 * 48).clamp(1_024, 16_000);
    let (content, _model_used) = chat_vision(
        &state,
        &gloss_extract_system(language),
        &prompt,
        images,
        budget,
        Some(gloss_extract_schema()),
    )
    .await?;

    // `gloss_extract_schema` is sent as Ollama's `format`, but not every model
    // honours it — some ignore the schema and reply in prose. So the prompt also
    // asks for JSON outright, and a reply that still carries no locatable object
    // is reported with a snippet of what did come back, rather than the opaque
    // "unexpected response shape" that gave no clue which of the two failed.
    let json = extract_json(&content)
        .ok_or_else(|| AiError::BadGlossShape(truncate(&content, 200)))?;
    let parsed: ExtractedGlosses =
        serde_json::from_str(json).map_err(|_| AiError::BadGlossShape(truncate(json, 200)))?;
    // Valid JSON of the wrong shape — `{}`, `{"error":…}`, or `{"glosses":[]}` —
    // parses to an empty Vec (`glosses` defaults when absent), which would
    // otherwise return Ok([]) and show the contributor "zero glosses" with no
    // error. A read that produced nothing is the same failure as a prose reply:
    // report it so they can retry.
    if parsed.glosses.is_empty() {
        return Err(AiError::BadGlossShape(truncate(json, 200)));
    }
    Ok(parsed.glosses)
}

// --- knowledge quizzes -----------------------------------------------------

/// One ayah, as the app drew it from `quiz_verse_pool`.
#[derive(Deserialize)]
pub struct QuizVerse {
    pub verse_id: i32,
    pub surah_number: i32,
    pub ayah_number: i32,
    pub surah_name: String,
    pub arabic: String,
    pub translation: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct GeneratedQuestion {
    pub verse_id: i32,
    /// One of `KINDS`; anything else is rewritten to "meaning" on the way out.
    pub kind: String,
    pub question: String,
    pub answer: String,
    /// The stretch of the ayah's Arabic that carries the answer, verbatim.
    /// Empty when the model did not supply one, or supplied one that is not
    /// actually in the ayah — see `validate_questions`.
    #[serde(default)]
    pub evidence: String,
}

#[derive(Deserialize)]
struct GeneratedQuiz {
    #[serde(default)]
    questions: Vec<GeneratedQuestion>,
}

#[derive(Serialize)]
pub struct KnowledgeQuiz {
    pub questions: Vec<GeneratedQuestion>,
    pub model_used: String,
}

const KINDS: &[&str] = &["locate", "wording", "meaning", "continuation", "detail"];

/// The instructions the round is built from.
///
/// Long, and deliberately so. Every paragraph here is load-bearing against a
/// specific way this goes wrong: a model asked for Quran questions without
/// being pinned to supplied text will reach for tafsir it half-remembers,
/// invent a number that sounds Quranic, or ask something whose answer is the
/// question restated. The grounding rules, the worked examples per kind, and
/// the closing self-check are each there because the alternative is a quiz
/// that teaches the reader something false about scripture — which is worse
/// than no quiz.
///
/// `evidence` is the part that makes the rest checkable: a question whose
/// evidence is not literally in the ayah did not come from the ayah, and the
/// app can drop it without having to judge the content itself.
fn knowledge_system(language: &str, guidance: &str, count: usize) -> String {
    format!(
        "ROLE\n\
You write examination questions for a student who is memorizing the Quran. They \
are tested from memory: they do not have the text in front of them while answering. \
They mark their own answer afterwards, so your answer text has to settle the matter \
on its own.\n\n\
INPUT\n\
You are given exactly {count} ayahs, each labelled:\n\
  [n] verse_id=<id>  <Surah> <surah>:<ayah>\n\
  ARABIC: ...\n\
  TRANSLATION: ...\n\n\
TASK\n\
Write exactly one question per ayah, in the order given — {count} questions in total. \
Copy each question's verse_id from the ayah you wrote it from.\n\n\
GROUNDING — these rules come before everything else\n\
1. Every question must be answerable from the ayahs supplied above and from nothing \
else. For this task you have no other source. Do not draw on tafsir, hadith, \
occasions of revelation, or any other ayah of the Quran, including ones you remember.\n\
2. The answer must be something actually present in that ayah's Arabic or its \
translation. If you cannot point to where in the ayah the answer sits, the question \
is wrong — write an easier one about the same ayah.\n\
3. Never invent a number, a name, a place or an attribute. If the ayah does not \
state one, do not ask for one.\n\
4. Ask what the text says, which word it uses, and where it sits. Do not ask for a \
legal ruling, a theological verdict, or the student's opinion.\n\
5. Do not put the answer inside the question.\n\
6. In a 'locate' question, do not name the ayah number — that is what is being asked.\n\n\
QUESTION KINDS — spread them across the round; use no kind more than three times\n\
locate        You describe the content in your own words; the student names the ayah.\n\
              e.g. \"Which ayah of al-Baqara describes those who trade guidance away for error?\"\n\
wording       You give a meaning in {language}; the student names the Arabic word the ayah uses for it.\n\
              e.g. \"In al-Baqara 2:7, which word is used for the covering over their eyes?\"\n\
meaning       You name the ayah; the student states what it says.\n\
              e.g. \"What does al-Baqara 2:3 say the God-conscious do with what they have been provided?\"\n\
continuation  You quote the opening of the ayah in Arabic; the student says what follows.\n\
              e.g. \"How does al-Baqara 2:2 continue after ذَٰلِكَ ٱلْكِتَـٰبُ ?\"\n\
detail        You ask for one specific item the ayah names — a number, a name, an attribute.\n\
              e.g. \"Which two groups does al-Baqara 2:6 say the warning does not reach?\"\n\n\
WRITING THE QUESTION\n\
- One sentence, under 30 words, ending in '?'.\n\
- Written in {language}. Arabic quoted inside it stays in Arabic script.\n\
- Specific enough to have one right answer. \"What is this ayah about?\" is not a \
question; \"Which two things does 2:3 pair with belief in the unseen?\" is.\n\n\
WRITING THE ANSWER\n\
- One or two sentences in {language}, complete enough that a student can tell \
whether what they recalled was right.\n\
- Name the ayah in it, as <surah>:<ayah>.\n\
- An Arabic word in the answer is written in Arabic script, followed by its \
transliteration and meaning in parentheses.\n\n\
EVIDENCE\n\
For each question, copy the exact stretch of that ayah's supplied ARABIC that carries \
the answer — character for character, a short phrase at most. If the whole ayah is \
the evidence, copy its opening words. Never put Arabic in `evidence` that does not \
appear verbatim in that ayah.\n\n\
OUTPUT\n\
Return JSON only — no explanation, no markdown fence:\n\
{{\"questions\":[{{\"verse_id\":0,\"kind\":\"locate\",\"question\":\"…\",\"answer\":\"…\",\"evidence\":\"…\"}}]}}\n\
`kind` is exactly one of: locate, wording, meaning, continuation, detail.\n\n\
BEFORE YOU ANSWER, check every question against this list and rewrite any that fails:\n\
- Is its verse_id one of the ids given above?\n\
- Can it be answered from that ayah alone, with no outside knowledge?\n\
- Is the answer visible in that ayah's Arabic or translation?\n\
- Does the evidence appear verbatim in that ayah's Arabic?\n\
- Is the answer kept out of the question?\n\
- Is the whole reply in {language}, apart from quoted Arabic?{guidance}"
    )
}

/// The shape the reply is decoded against. Ollama constrains generation to it,
/// so the parse below is a formality rather than the first line of defence.
fn knowledge_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "verse_id": { "type": "integer" },
                        "kind": { "type": "string", "enum": KINDS },
                        "question": { "type": "string" },
                        "answer": { "type": "string" },
                        "evidence": { "type": "string" }
                    },
                    "required": ["verse_id", "kind", "question", "answer", "evidence"]
                }
            }
        },
        "required": ["questions"]
    })
}

/// Pulls the JSON object out of a reply that carried anything else with it.
///
/// `format` should make this unnecessary, but a model that ignores it returns
/// prose with an object somewhere inside, and a round is worth recovering.
fn extract_json(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end > start { Some(&text[start..=end]) } else { None }
}

/// Arabic reduced to its letters, with a way back to the original text.
///
/// Roughly 40% of the characters in Uthmani text are combining marks, so a
/// byte-exact comparison of a quoted phrase against the ayah is really a test
/// of whether the model reproduced the harakat, the superscript alef and the
/// waqf signs — not of whether the phrase is in the ayah.
///
/// Measured against `gemma4:31b-cloud`, that turns out not to bite: 16 of 16
/// generated questions across two surahs quoted the ayah byte-for-byte, small
/// high rounded zero and all. The folding is therefore not fixing an observed
/// failure. It is here because `validate_questions` now *drops* a question
/// whose quote cannot be located, which makes a false negative cost a question
/// rather than a highlight — and the model is configurable (`OLLAMA_MODEL`),
/// so the check has to hold for a smaller one that copies less carefully than
/// the one this was measured on.
///
/// Folding only ever widens what matches, so it cannot reject a quote the
/// literal check would have accepted.
///
/// `starts` keeps the byte offset each surviving character came from, so a
/// match found in the folded text can be mapped back to the exact original
/// stretch — which is what the reader is shown, diacritics and all.
struct Folded {
    chars: Vec<char>,
    starts: Vec<usize>,
}

/// Diacritics, Quranic annotation signs, and the tatweel: written, but not
/// part of the word for the purpose of "is this phrase in this ayah".
fn is_arabic_mark(ch: char) -> bool {
    matches!(ch as u32,
        0x0610..=0x061A | 0x064B..=0x065F | 0x0670 | 0x06D6..=0x06ED | 0x08D3..=0x08FF | 0x0640)
}

/// Letters that are written several ways but read as one.
fn fold_letter(ch: char) -> char {
    match ch {
        '\u{0622}' | '\u{0623}' | '\u{0625}' | '\u{0671}' => '\u{0627}', // آ أ إ ٱ -> ا
        '\u{0624}' => '\u{0648}',                                       // ؤ -> و
        '\u{0626}' | '\u{0649}' => '\u{064A}',                           // ئ ى -> ي
        '\u{0629}' => '\u{0647}',                                       // ة -> ه
        other => other,
    }
}

fn fold_arabic(text: &str) -> Folded {
    let mut chars = Vec::new();
    let mut starts = Vec::new();
    let mut in_space = false;

    for (offset, ch) in text.char_indices() {
        if is_arabic_mark(ch) {
            continue;
        }
        if ch.is_whitespace() {
            // A run of whitespace is one separator; the model reproduces the
            // words, not the spacing between them.
            if in_space {
                continue;
            }
            in_space = true;
            chars.push(' ');
            starts.push(offset);
            continue;
        }
        in_space = false;
        chars.push(fold_letter(ch));
        starts.push(offset);
    }

    // A quotation that folds to leading or trailing space would never match.
    while chars.first() == Some(&' ') {
        chars.remove(0);
        starts.remove(0);
    }
    while chars.last() == Some(&' ') {
        chars.pop();
        starts.pop();
    }

    Folded { chars, starts }
}

fn find_subslice(hay: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (0..=hay.len() - needle.len()).find(|&i| hay[i..i + needle.len()] == *needle)
}

/// The stretch of `text` that `quote` refers to, as `text` actually spells it.
///
/// None when the quote is not in the text at all, which is the signal the
/// caller acts on: a question whose evidence is not in the ayah did not come
/// from the ayah.
fn locate_quote(text: &str, quote: &str) -> Option<String> {
    locate_folded(text, &fold_arabic(text), &fold_arabic(quote))
}

/// Prose reduced to its words: lowercased, with punctuation and quotation
/// marks read as spaces, and Arabic folded as in `fold_arabic`.
///
/// Tafsir quotations fail differently from ayah quotations. The model keeps
/// the words but drifts on the punctuation around them — «» against "",
/// a dropped comma, an em dash for a hyphen — and on capitals at the start
/// of a quoted clause. None of that changes whether the sentence is in the
/// passage, so none of it is compared.
fn fold_prose(text: &str) -> Folded {
    let mut chars = Vec::new();
    let mut starts = Vec::new();
    let mut in_space = false;

    for (offset, ch) in text.char_indices() {
        if is_arabic_mark(ch) {
            continue;
        }
        if !ch.is_alphanumeric() {
            if in_space {
                continue;
            }
            in_space = true;
            chars.push(' ');
            starts.push(offset);
            continue;
        }
        in_space = false;
        chars.push(fold_letter(ch.to_lowercase().next().unwrap_or(ch)));
        starts.push(offset);
    }

    // Not trimmed: a trailing separator in the passage is what marks where a
    // match that runs to its last word ends, so the closing punctuation is
    // not swept into the quotation. The needle is trimmed by the caller.
    Folded { chars, starts }
}

/// A tafsir quotation shorter than this proves nothing: a single name or a
/// common word is in every passage, whether or not the claim came from it.
const MIN_PROSE_QUOTE: usize = 12;

/// The stretch of a tafsir passage that `quote` refers to, as the passage
/// spells it. None when the quote is too short to mean anything or is not
/// there.
fn locate_prose(text: &str, quote: &str) -> Option<String> {
    let mut needle = fold_prose(quote);
    while needle.chars.first() == Some(&' ') {
        needle.chars.remove(0);
        needle.starts.remove(0);
    }
    while needle.chars.last() == Some(&' ') {
        needle.chars.pop();
        needle.starts.pop();
    }
    if needle.chars.len() < MIN_PROSE_QUOTE {
        return None;
    }
    locate_folded(text, &fold_prose(text), &needle)
}

fn locate_folded(text: &str, hay: &Folded, needle: &Folded) -> Option<String> {
    let at = find_subslice(&hay.chars, &needle.chars)?;

    let start = hay.starts[at];
    // Up to where the next surviving character begins, so the marks hanging
    // off the last matched letter come with it.
    let end = hay
        .starts
        .get(at + needle.chars.len())
        .copied()
        .unwrap_or(text.len());
    Some(text[start..end].trim().to_string())
}

/// Keeps the questions that are about the ayahs we actually sent.
///
/// Four things are enforced, in order of how badly they go wrong unchecked:
/// a question must belong to a verse from this round (otherwise it is about
/// scripture the reader was never shown); there is at most one per verse (the
/// round is built one-to-one, and a model that writes three about ayah 1 has
/// lost the plot); question and answer must be non-empty; and the cited
/// evidence must be locatable in that ayah — if it is not, **the question is
/// dropped**, not merely its citation.
///
/// That last rule is the one doing the real work. A model asked to quote the
/// stretch of the ayah carrying the answer can only do it if the answer came
/// from the ayah; when it reaches for half-remembered tafsir instead, it has
/// nothing to quote and invents something, and the invention is detectable
/// without anyone having to judge the religious content. So the failure is
/// treated as a failed question rather than a missing footnote.
///
/// `locate_quote` compares on letters rather than bytes, and hands back the
/// ayah's own spelling of the matched phrase, so what the reader sees
/// highlighted is the mushaf's text rather than the model's retyping of it.
fn validate_questions(
    raw: Vec<GeneratedQuestion>,
    verses: &[QuizVerse],
) -> Vec<GeneratedQuestion> {
    let mut out: Vec<GeneratedQuestion> = Vec::new();

    for mut q in raw {
        let Some(verse) = verses.iter().find(|v| v.verse_id == q.verse_id) else {
            continue;
        };
        if out.iter().any(|kept| kept.verse_id == q.verse_id) {
            continue;
        }

        q.question = q.question.trim().to_string();
        q.answer = q.answer.trim().to_string();
        q.evidence = q.evidence.trim().to_string();
        if q.question.is_empty() || q.answer.is_empty() {
            continue;
        }

        let kind = q.kind.trim().to_lowercase();
        q.kind = if KINDS.contains(&kind.as_str()) { kind } else { "meaning".to_string() };

        // No quote, or a quote that is not in the ayah: nothing anchors this
        // question to the text, so it does not get asked.
        let Some(evidence) = locate_quote(&verse.arabic, &q.evidence) else {
            continue;
        };
        q.evidence = evidence;

        out.push(q);
    }

    // Back into the order the verses were drawn in, so the round walks the
    // passage the way the reader read it rather than the way the model replied.
    out.sort_by_key(|q| {
        verses.iter().position(|v| v.verse_id == q.verse_id).unwrap_or(usize::MAX)
    });
    out
}

/// Builds one round of knowledge questions from the ayahs the app drew.
///
/// Returns whatever survived validation rather than failing on a partial
/// reply: nine good questions is a round, and the tenth being dropped is not
/// worth making the reader wait through a second generation.
#[tauri::command]
pub async fn ai_generate_knowledge_quiz(
    state: tauri::State<'_, AiState>,
    verses: Vec<QuizVerse>,
    language: String,
) -> Result<KnowledgeQuiz, AiError> {
    if verses.is_empty() {
        return Err(AiError::BadResponse);
    }
    let guidance = language_guidance(&language);
    let language = language_name(&language);

    let passage = verses
        .iter()
        .enumerate()
        .map(|(i, v)| {
            format!(
                "[{}] verse_id={}  {} {}:{}\nARABIC: {}\nTRANSLATION: {}",
                i + 1,
                v.verse_id,
                v.surah_name,
                v.surah_number,
                v.ayah_number,
                v.arabic,
                v.translation
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = format!(
        "{passage}\n\n\
         Write exactly {} questions — one per ayah above, in that order.",
        verses.len()
    );

    // Budgeted per question rather than fixed: a 30-ayah round truncated
    // half way through would fail validation for reasons the reader cannot
    // act on. Warmer than the prose generators because ten questions off one
    // passage should not all be the same question.
    let budget = (verses.len() as u32 * 220).clamp(600, 8_000);
    let (content, model_used) = chat_with(
        &state,
        &knowledge_system(language, guidance, verses.len()),
        &prompt,
        budget,
        0.6,
        Some(knowledge_schema()),
        None,
    )
    .await?;

    let json = extract_json(&content).ok_or(AiError::BadResponse)?;
    let parsed: GeneratedQuiz = serde_json::from_str(json).map_err(|_| AiError::BadResponse)?;

    let questions = validate_questions(parsed.questions, &verses);
    if questions.is_empty() {
        return Err(AiError::BadResponse);
    }

    Ok(KnowledgeQuiz { questions, model_used })
}

// --- tafsir questions ------------------------------------------------------

/// One ayah with the stretch of tafsir its question is to be written from.
///
/// The excerpt is chosen by the app, not the model: a window of the passage
/// rather than all of it, so a twenty-paragraph commentary does not crowd the
/// other ayahs of the batch out of the context, and so two rounds on the same
/// ayah can land on different parts of it.
#[derive(Deserialize)]
pub struct TafsirQuizItem {
    pub verse_id: i32,
    pub surah_number: i32,
    pub ayah_number: i32,
    pub surah_name: String,
    pub arabic: String,
    pub translation: String,
    pub excerpt: String,
}

/// Uzbek tafsir is imported in Cyrillic while everything the app writes for
/// an Uzbek reader is Latin. Said out loud, because the easy mistake in either
/// direction is plausible: answering in the script of the source, or
/// "helpfully" transliterating the one field that must be copied verbatim.
fn tafsir_source_note(code: &str) -> &'static str {
    match code {
        "uz" => {
            "\n- The tafsir text you are given is in Uzbek CYRILLIC. Read it, but write \
everything of your own in Uzbek LATIN. Only text you copy verbatim out of the tafsir \
(the `evidence` or `quote` field) stays in Cyrillic, exactly as it is written there."
        }
        _ => "",
    }
}

/// The instructions for tafsir-grounded questions.
///
/// This is `knowledge_system` with its first rule turned around: there the
/// model is forbidden tafsir because nothing it remembers can be checked; here
/// it is handed a specific stretch of one, and held to that stretch the same
/// way — `evidence` must be a sentence of the excerpt, and a question whose
/// evidence is not in it is dropped. What a memorizer gains is the layer the
/// ayah alone does not carry: who "they" are, what occasioned the ayah, which
/// hadith the commentator reads it with.
/// The script rule again, for the end of the user message.
///
/// Stated once in the system prompt, it held for short passages and was lost
/// on 2:1 in Uzbek: after twenty-four thousand characters of Cyrillic the
/// model answered in Cyrillic. Repeating it as the last thing read fixed it.
fn tafsir_script_reminder(code: &str) -> &'static str {
    match code {
        "uz" => {
            " Write in Uzbek using the LATIN alphabet (o'zbek lotin yozuvi), not Cyrillic — \
only text copied verbatim from the tafsir stays in Cyrillic."
        }
        _ => "",
    }
}

fn tafsir_quiz_system(
    language: &str,
    guidance: &str,
    source_note: &str,
    tafsir_name: &str,
    count: usize,
) -> String {
    format!(
        "ROLE\n\
You write examination questions for a student who is memorizing the Quran and studying \
it with the tafsir of {tafsir_name}. They are tested from memory: they do not have the \
text in front of them while answering. They mark their own answer afterwards, so your \
answer text has to settle the matter on its own.\n\n\
INPUT\n\
You are given exactly {count} ayahs, each labelled:\n\
  [n] verse_id=<id>  <Surah> <surah>:<ayah>\n\
  ARABIC: ...\n\
  TRANSLATION: ...\n\
  TAFSIR: an excerpt from {tafsir_name}'s commentary on that ayah\n\n\
TASK\n\
Write exactly one question per ayah, in the order given — {count} questions in total. \
Copy each question's verse_id from the ayah you wrote it from. Each question tests \
something that ayah's TAFSIR excerpt explains.\n\n\
GROUNDING — these rules come before everything else\n\
1. Every question must be answerable from that ayah's TAFSIR excerpt (read together with \
the ayah). You have no other source. Do not add anything you remember of this or any \
other tafsir, hadith, or history, even if you are sure of it.\n\
2. The answer must be stated in the excerpt. If you cannot point to the sentence that \
says it, the question is wrong — write one about something the excerpt does say.\n\
3. Never invent a number, a name, a place, a narrator or a hadith collection.\n\
4. Good things to ask: what a word or phrase of the ayah means according to the tafsir; \
who or what the ayah refers to; the occasion of revelation, if the excerpt gives one; \
a hadith or a Companion's saying the tafsir brings to explain the ayah, and what it says; \
a lesson or distinction the commentator draws.\n\
5. Do not ask about chains of narration (isnad), which narrator reported from whom, the \
grading of a hadith, or page-level trivia. Do not ask for a legal ruling or for the \
student's opinion.\n\
6. Do not put the answer inside the question.\n\n\
WRITING THE QUESTION\n\
- One sentence, under 35 words, ending in '?'.\n\
- Name the ayah it is about as <surah>:<ayah>.\n\
- Written in {language}. Arabic quoted inside it stays in Arabic script.\n\
- Specific enough to have one right answer. \"What does the tafsir say about 2:3?\" is \
not a question; \"According to {tafsir_name}, what does 'the unseen' in 2:3 include?\" is.\n\n\
WRITING THE ANSWER\n\
- One or two sentences in {language}, complete enough that a student can tell whether \
what they recalled was right.\n\
- Attribute it: begin with \"According to {tafsir_name}\" or its natural equivalent in \
{language}.\n\
- An Arabic word in the answer is written in Arabic script, followed by its \
transliteration and meaning in parentheses.\n\n\
EVIDENCE\n\
For each question, copy the sentence (or the part of a sentence, at least five words) \
of that ayah's TAFSIR excerpt that carries the answer — character for character, in the \
excerpt's own language and script. Do not translate it, do not shorten it with '…', \
do not join two separate sentences.\n\n\
OUTPUT\n\
Return JSON only — no explanation, no markdown fence:\n\
{{\"questions\":[{{\"verse_id\":0,\"kind\":\"tafsir\",\"question\":\"…\",\"answer\":\"…\",\"evidence\":\"…\"}}]}}\n\
`kind` is always \"tafsir\".\n\n\
BEFORE YOU ANSWER, check every question against this list and rewrite any that fails:\n\
- Is its verse_id one of the ids given above?\n\
- Is the answer stated in that ayah's TAFSIR excerpt, and nowhere only in your memory?\n\
- Is the evidence copied verbatim from that excerpt?\n\
- Is the answer kept out of the question?\n\
- Are the question and answer in {language}, apart from quoted Arabic?{guidance}{source_note}"
    )
}

fn tafsir_quiz_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "verse_id": { "type": "integer" },
                        "kind": { "type": "string", "enum": ["tafsir"] },
                        "question": { "type": "string" },
                        "answer": { "type": "string" },
                        "evidence": { "type": "string" }
                    },
                    "required": ["verse_id", "kind", "question", "answer", "evidence"]
                }
            }
        },
        "required": ["questions"]
    })
}

/// `validate_questions` for tafsir questions: the same four rules, with the
/// evidence located in the item's excerpt rather than its Arabic.
fn validate_tafsir_questions(
    raw: Vec<GeneratedQuestion>,
    items: &[TafsirQuizItem],
) -> Vec<GeneratedQuestion> {
    let mut out: Vec<GeneratedQuestion> = Vec::new();

    for mut q in raw {
        let Some(item) = items.iter().find(|i| i.verse_id == q.verse_id) else {
            continue;
        };
        if out.iter().any(|kept| kept.verse_id == q.verse_id) {
            continue;
        }

        q.question = q.question.trim().to_string();
        q.answer = q.answer.trim().to_string();
        if q.question.is_empty() || q.answer.is_empty() {
            continue;
        }
        q.kind = "tafsir".to_string();

        // The one check that matters: an answer the model cannot quote from
        // the excerpt came from somewhere else.
        let Some(evidence) = locate_prose(&item.excerpt, &q.evidence) else {
            continue;
        };
        q.evidence = evidence;

        out.push(q);
    }

    out.sort_by_key(|q| {
        items.iter().position(|i| i.verse_id == q.verse_id).unwrap_or(usize::MAX)
    });
    out
}

/// Tafsir-grounded questions for a small batch of ayahs.
///
/// The app sends a round's tafsir questions a few ayahs at a time, in
/// parallel, rather than in one call: each ayah carries up to a few thousand
/// characters of commentary, and one call carrying twenty of them would be
/// slow to read and slower to fail.
#[tauri::command]
pub async fn ai_generate_tafsir_quiz(
    state: tauri::State<'_, AiState>,
    items: Vec<TafsirQuizItem>,
    tafsir_name: String,
    language: String,
) -> Result<KnowledgeQuiz, AiError> {
    if items.is_empty() {
        return Err(AiError::BadResponse);
    }
    let guidance = language_guidance(&language);
    let source_note = tafsir_source_note(&language);
    let reminder = tafsir_script_reminder(&language);
    let language = language_name(&language);
    let tafsir_name = tafsir_name.trim();

    let passage = items
        .iter()
        .enumerate()
        .map(|(i, v)| {
            format!(
                "[{}] verse_id={}  {} {}:{}\nARABIC: {}\nTRANSLATION: {}\nTAFSIR:\n{}",
                i + 1,
                v.verse_id,
                v.surah_name,
                v.surah_number,
                v.ayah_number,
                v.arabic,
                v.translation,
                v.excerpt.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let prompt = format!(
        "{passage}\n\n\
         Write exactly {} questions — one per ayah above, in that order.{reminder}",
        items.len()
    );

    // Per question: a question, an answer and a copied sentence of evidence,
    // which in Uzbek runs to several hundred tokens on its own.
    let budget = (items.len() as u32 * 600).clamp(1_000, 3_000);
    let (content, model_used) = chat_with(
        &state,
        &tafsir_quiz_system(language, guidance, source_note, tafsir_name, items.len()),
        &prompt,
        budget,
        0.6,
        Some(tafsir_quiz_schema()),
        None,
    )
    .await?;

    let json = extract_json(&content).ok_or(AiError::BadResponse)?;
    let parsed: GeneratedQuiz = serde_json::from_str(json).map_err(|_| AiError::BadResponse)?;

    let questions = validate_tafsir_questions(parsed.questions, &items);
    if questions.is_empty() {
        return Err(AiError::BadResponse);
    }

    Ok(KnowledgeQuiz { questions, model_used })
}

// --- tafsir summaries ------------------------------------------------------

const SUMMARY_TIMEOUT: Duration = Duration::from_secs(180);

/// Enough for every Ibn Kathir passage but the very longest; anything past it
/// is cut at a paragraph boundary rather than mid-sentence.
///
/// Measured on `gemma4:31b-cloud`: the Uzbek 17:1 entry, 190k characters, is
/// about 84k prompt tokens and summarizes whole in ~15s, the gist reaching the
/// end of the passage. The old 40k cap sent the first fifth of it. Past ~240k
/// the prompt nears the model's context window, which is where this stops.
const SUMMARY_MAX_CHARS: usize = 240_000;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct KeyPoint {
    pub point: String,
    /// The ayah the point is about, when it is about one; always inside the
    /// passage's range or dropped.
    #[serde(default)]
    pub ayah: Option<i32>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct RecallItem {
    pub question: String,
    pub answer: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Narration {
    /// "hadith" (the Prophet ﷺ) or "athar" (a Companion or Successor).
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub narrator: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    /// Where the narration sits in the tafsir, in the tafsir's own spelling.
    pub quote: String,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct TafsirSummaryBody {
    #[serde(default)]
    pub gist: String,
    #[serde(default)]
    pub key_points: Vec<KeyPoint>,
    #[serde(default)]
    pub recall: Vec<RecallItem>,
    #[serde(default)]
    pub narrations: Vec<Narration>,
}

#[derive(Serialize)]
pub struct TafsirSummary {
    pub summary: TafsirSummaryBody,
    pub model_used: String,
}

/// The instructions for a memorization summary of one tafsir passage.
///
/// Not a retelling. A reader who has just gone through twenty paragraphs of
/// Ibn Kathir wants to leave with the handful of things worth keeping, in a
/// form that sticks: one sentence to hang the passage on, a few concrete
/// points, and questions to test themselves with — retrieval is what makes a
/// thing stay, and rereading is not.
///
/// The narrations are pulled out because they are what a tafsir reader most
/// often wants to find again, and because they are the part a model is most
/// likely to embellish from memory. So each one must carry a verbatim `quote`
/// from the passage, and one that cannot be located is dropped — the same
/// rule the quiz lives by.
fn tafsir_summary_system(
    language: &str,
    guidance: &str,
    source_note: &str,
    tafsir_name: &str,
) -> String {
    format!(
        "ROLE\n\
You are a study companion for someone memorizing the Quran. They have just read a passage \
of the tafsir of {tafsir_name}, and you help them keep what matters from it: the few points \
worth remembering, phrased so they stick, and questions to test themselves with. You are \
not retelling the passage.\n\n\
GROUNDING — these rules come before everything else\n\
1. Use only the tafsir text supplied. If the tafsir says it, you may say it; if it does not, \
leave it out — even if you know it to be true.\n\
2. Add no hadith, ruling, story or explanation that is not in the text.\n\
3. Never invent or complete a narrator's name, a hadith collection, or a grading.\n\n\
GIST\n\
One sentence a reader could repeat from memory: what these ayahs are about, as this tafsir \
explains them.\n\n\
KEY POINTS\n\
- Three to seven points, the most important first.\n\
- Each is one concrete, memorable claim from the tafsir: what a word or phrase means, who is \
meant, what occasioned the ayah, a distinction the commentator draws, a lesson. At most two \
short sentences.\n\
- Be specific. \"The tafsir discusses belief\" is not a point; \"'Belief in the unseen' covers \
Allah, the angels, the Books, the Messengers, the Last Day and the decree\" is.\n\
- Set `ayah` to the ayah number the point is about when it is about one ayah of the passage; \
otherwise null.\n\
- An Arabic key term stays in Arabic script, followed by its transliteration and meaning in \
parentheses.\n\n\
RECALL\n\
Two to four questions that test the key points, each answerable from them, with an answer of \
one or two sentences. Do not put the answer in the question.\n\n\
NARRATIONS\n\
List the narrations the tafsir quotes in this passage, in the order they appear — at most \
eight; if there are more, keep the ones that explain the ayah most directly:\n\
- kind \"hadith\": a saying, action or approval of the Prophet ﷺ.\n\
- kind \"athar\": a saying of a Companion or of one of the Tabi'in (for example Ibn Abbas, \
Ibn Mas'ud, Mujahid, Qatada).\n\
Leave out the commentator's own words and his summaries of other scholars' views.\n\
- `text`: the narration itself, translated faithfully into {language}. Leave out the chain of \
narrators; do not paraphrase. If a narration runs past about sixty words, give the part of \
it that bears on the ayah.\n\
- `narrator`: the Companion (or Successor) it is narrated from or attributed to, if the tafsir \
names one; otherwise null.\n\
- `source`: the collection or scholar who recorded it (for example Sahih al-Bukhari, Muslim, \
Imam Ahmad, Ibn Abi Hatim), only if the tafsir names it; otherwise null.\n\
- `quote`: six to fifteen consecutive words copied character for character from the tafsir \
where this narration appears, in the tafsir's own language and script — just enough to find the \
place, not the whole narration. Do not translate it and do not shorten it with '…'.\n\
If the passage quotes no narrations, return an empty list. Never fill this list from memory.\n\n\
LANGUAGE\n\
Write everything except `quote` and quoted Arabic in {language}.{guidance}{source_note}\n\n\
OUTPUT\n\
Return JSON only — no explanation, no markdown fence:\n\
{{\"gist\":\"…\",\"key_points\":[{{\"point\":\"…\",\"ayah\":null}}],\
\"recall\":[{{\"question\":\"…\",\"answer\":\"…\"}}],\
\"narrations\":[{{\"kind\":\"hadith\",\"text\":\"…\",\"narrator\":null,\"source\":null,\"quote\":\"…\"}}]}}\n\n\
BEFORE YOU ANSWER, check:\n\
- Is every point, answer and narration actually in the supplied tafsir?\n\
- Is every `quote` copied verbatim from it?\n\
- Is every narrator and source named in the tafsir itself?\n\
- Is everything but the quotes and Arabic in {language}?"
    )
}

fn tafsir_summary_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "gist": { "type": "string" },
            "key_points": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "point": { "type": "string" },
                        "ayah": { "type": ["integer", "null"] }
                    },
                    "required": ["point", "ayah"]
                }
            },
            "recall": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "question": { "type": "string" },
                        "answer": { "type": "string" }
                    },
                    "required": ["question", "answer"]
                }
            },
            "narrations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string", "enum": ["hadith", "athar"] },
                        "text": { "type": "string" },
                        "narrator": { "type": ["string", "null"] },
                        "source": { "type": ["string", "null"] },
                        "quote": { "type": "string" }
                    },
                    "required": ["kind", "text", "narrator", "source", "quote"]
                }
            }
        },
        "required": ["gist", "key_points", "recall", "narrations"]
    })
}

/// The passage as the model should read it: the Uzbek import's `### ` heading
/// markers dropped (the heading text stays), and anything past
/// `SUMMARY_MAX_CHARS` cut at the last paragraph break before it.
fn prepare_tafsir(content: &str) -> String {
    let text = content
        .lines()
        .map(|line| line.trim_start().strip_prefix("### ").unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");

    if text.chars().count() <= SUMMARY_MAX_CHARS {
        return text;
    }
    let cut = text
        .char_indices()
        .nth(SUMMARY_MAX_CHARS)
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    let head = &text[..cut];
    match head.rfind("\n\n") {
        Some(at) if at > 0 => head[..at].to_string(),
        _ => head.to_string(),
    }
}

/// Reads a summary reply field by field, taking what it can.
///
/// `format` asks Ollama for the schema but does not hold the model to it: on
/// 2:1 in Uzbek it wrote `"ayah": "1"`, and a strict parse threw away an
/// otherwise good summary over one quoted digit. So a number may arrive as a
/// string, a key point as a bare string, a narrator as anything; what is
/// unusable is skipped rather than failing the whole reply. `validate_summary`
/// still decides what is kept.
fn summary_from_value(value: &serde_json::Value) -> TafsirSummaryBody {
    use serde_json::Value;

    fn text(value: Option<&Value>) -> String {
        match value {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        }
    }
    fn number(value: Option<&Value>) -> Option<i32> {
        match value {
            Some(Value::Number(n)) => n.as_i64().and_then(|n| i32::try_from(n).ok()),
            Some(Value::String(s)) => s.trim().parse().ok(),
            _ => None,
        }
    }
    fn list<'a>(value: &'a Value, key: &str) -> &'a [Value] {
        value.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
    }

    TafsirSummaryBody {
        gist: text(value.get("gist")),
        key_points: list(value, "key_points")
            .iter()
            .map(|p| match p {
                Value::String(point) => KeyPoint { point: point.clone(), ayah: None },
                _ => KeyPoint { point: text(p.get("point")), ayah: number(p.get("ayah")) },
            })
            .collect(),
        recall: list(value, "recall")
            .iter()
            .map(|r| RecallItem { question: text(r.get("question")), answer: text(r.get("answer")) })
            .collect(),
        narrations: list(value, "narrations")
            .iter()
            .map(|n| Narration {
                kind: text(n.get("kind")),
                text: text(n.get("text")),
                narrator: Some(text(n.get("narrator"))),
                source: Some(text(n.get("source"))),
                quote: text(n.get("quote")),
            })
            .collect(),
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Tidies a generated summary and drops what cannot be trusted.
///
/// Lists are capped at what the prompt asked for, a key point's ayah outside
/// the passage is cleared, and — the rule that matters — a narration whose
/// `quote` is not in the tafsir is dropped: the model did not find it there.
fn validate_summary(
    mut body: TafsirSummaryBody,
    content: &str,
    ayah_start: i32,
    ayah_end: i32,
) -> Option<TafsirSummaryBody> {
    body.gist = body.gist.trim().to_string();

    body.key_points = body
        .key_points
        .into_iter()
        .filter_map(|mut p| {
            p.point = p.point.trim().to_string();
            if p.point.is_empty() {
                return None;
            }
            p.ayah = p.ayah.filter(|a| (ayah_start..=ayah_end).contains(a));
            Some(p)
        })
        .take(7)
        .collect();

    body.recall = body
        .recall
        .into_iter()
        .filter_map(|mut r| {
            r.question = r.question.trim().to_string();
            r.answer = r.answer.trim().to_string();
            (!r.question.is_empty() && !r.answer.is_empty()).then_some(r)
        })
        .take(4)
        .collect();

    let mut narrations: Vec<Narration> = Vec::new();
    for mut n in body.narrations {
        n.text = n.text.trim().to_string();
        if n.text.is_empty() {
            continue;
        }
        let Some(quote) = locate_prose(content, &n.quote) else {
            continue;
        };
        if narrations.iter().any(|kept| kept.quote == quote) {
            continue;
        }
        n.quote = quote;
        n.kind = if n.kind.trim().eq_ignore_ascii_case("hadith") { "hadith" } else { "athar" }
            .to_string();
        n.narrator = non_empty(n.narrator);
        n.source = non_empty(n.source);
        narrations.push(n);
        if narrations.len() >= 12 {
            break;
        }
    }
    body.narrations = narrations;

    if body.gist.is_empty() && body.key_points.is_empty() {
        return None;
    }
    Some(body)
}

#[tauri::command]
pub async fn ai_generate_tafsir_summary(
    state: tauri::State<'_, AiState>,
    tafsir_name: String,
    surah_name: String,
    surah_number: i32,
    ayah_start: i32,
    ayah_end: i32,
    content: String,
    language: String,
) -> Result<TafsirSummary, AiError> {
    let content = prepare_tafsir(&content);
    if content.trim().is_empty() {
        return Err(AiError::BadResponse);
    }
    let guidance = language_guidance(&language);
    let source_note = tafsir_source_note(&language);
    let reminder = tafsir_script_reminder(&language);
    let language = language_name(&language);
    let tafsir_name = tafsir_name.trim();

    let range = if ayah_start == ayah_end {
        format!("{surah_number}:{ayah_start}")
    } else {
        format!("{surah_number}:{ayah_start}-{ayah_end}")
    };
    let prompt = format!(
        "Tafsir of {tafsir_name} on Surah {surah_name}, ayahs {range}.\n\n\
         TAFSIR:\n{content}\n\n\
         Write the study summary for this passage, in {language}.{reminder}"
    );

    let (reply, model_used) = chat_with(
        &state,
        &tafsir_summary_system(language, guidance, source_note, tafsir_name),
        &prompt,
        // Generous on purpose. Uzbek costs far more tokens per word than
        // English, and an Ibn Kathir passage can quote a dozen narrations,
        // each carried twice (translated, and quoted in the original). 2,500
        // was measured running out mid-list on 2:3 in Uzbek.
        8_000,
        0.3,
        Some(tafsir_summary_schema()),
        Some(SUMMARY_TIMEOUT),
    )
    .await?;

    let json = extract_json(&reply).ok_or(AiError::BadResponse)?;
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| AiError::BadResponse)?;
    let parsed = summary_from_value(&value);
    let summary =
        validate_summary(parsed, &content, ayah_start, ayah_end).ok_or(AiError::BadResponse)?;

    Ok(TafsirSummary { summary, model_used })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(verse_id: i32, excerpt: &str) -> TafsirQuizItem {
        TafsirQuizItem {
            verse_id,
            surah_number: 2,
            ayah_number: 3,
            surah_name: "Al-Baqara".into(),
            arabic: "ٱلَّذِينَ يُؤْمِنُونَ بِٱلْغَيْبِ".into(),
            translation: "Who believe in the unseen".into(),
            excerpt: excerpt.into(),
        }
    }

    fn question(verse_id: i32, evidence: &str) -> GeneratedQuestion {
        GeneratedQuestion {
            verse_id,
            kind: "meaning".into(),
            question: "What is the unseen?".into(),
            answer: "According to Ibn Kathir, …".into(),
            evidence: evidence.into(),
        }
    }

    #[test]
    fn prose_quote_ignores_punctuation_and_case() {
        let text = "Ibn Abbas said: «Belief in the unseen means belief in Allah, His angels.»";
        let found = locate_prose(text, "belief in the unseen means belief in Allah His angels");
        assert_eq!(
            found.as_deref(),
            Some("Belief in the unseen means belief in Allah, His angels")
        );
    }

    #[test]
    fn prose_quote_too_short_is_rejected() {
        assert!(locate_prose("Allah knows best.", "Allah").is_none());
    }

    #[test]
    fn tafsir_question_without_evidence_is_dropped() {
        let items = vec![item(10, "The unseen includes the Resurrection and Paradise.")];
        let kept = validate_tafsir_questions(
            vec![question(10, "the unseen is the heart of faith")],
            &items,
        );
        assert!(kept.is_empty());
    }

    #[test]
    fn tafsir_question_with_evidence_is_kept_and_retyped() {
        let items = vec![item(10, "The unseen includes the Resurrection and Paradise.")];
        let kept = validate_tafsir_questions(
            vec![question(10, "the unseen includes the resurrection and paradise")],
            &items,
        );
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].kind, "tafsir");
        assert_eq!(kept[0].evidence, "The unseen includes the Resurrection and Paradise");
    }

    #[test]
    fn cyrillic_evidence_matches_under_a_latin_answer() {
        let excerpt = "Ибн Аббос айтади: «Ғайбга иймон – Аллоҳга иймон келтиришдир».";
        let items = vec![item(10, excerpt)];
        let mut q = question(10, "Ғайбга иймон – Аллоҳга иймон келтиришдир");
        q.answer = "Ibn Kasirga ko'ra, g'aybga iymon Allohga iymondir.".into();
        let kept = validate_tafsir_questions(vec![q], &items);
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn invented_narration_is_dropped() {
        let content = "Abu Hurayra narrated that the Messenger of Allah said: \
                       \"The strong believer is better.\" Recorded by Muslim.";
        let body = TafsirSummaryBody {
            gist: "Gist".into(),
            key_points: vec![KeyPoint { point: "Point".into(), ayah: Some(99) }],
            recall: vec![],
            narrations: vec![
                Narration {
                    kind: "hadith".into(),
                    text: "The strong believer is better.".into(),
                    narrator: Some("Abu Hurayra".into()),
                    source: Some("Muslim".into()),
                    quote: "the Messenger of Allah said: The strong believer is better".into(),
                },
                Narration {
                    kind: "hadith".into(),
                    text: "Made up".into(),
                    narrator: Some(" ".into()),
                    source: None,
                    quote: "whoever reads this ayah at night will be protected".into(),
                },
            ],
        };
        let out = validate_summary(body, content, 1, 5).expect("summary survives");
        assert_eq!(out.narrations.len(), 1);
        assert_eq!(out.narrations[0].narrator.as_deref(), Some("Abu Hurayra"));
        assert_eq!(out.key_points[0].ayah, None);
    }

    #[test]
    fn summary_reply_is_read_leniently() {
        let value = serde_json::json!({
            "gist": "G",
            "key_points": [{ "point": "A", "ayah": "1" }, "B", { "point": "C", "ayah": null }],
            "recall": [{ "question": "Q", "answer": "A" }],
            "narrations": [{ "kind": "hadith", "text": "T", "narrator": null, "source": 5, "quote": "q" }]
        });
        let body = summary_from_value(&value);
        assert_eq!(body.key_points[0].ayah, Some(1));
        assert_eq!(body.key_points[1].point, "B");
        assert_eq!(body.key_points[2].ayah, None);
        assert_eq!(body.narrations[0].narrator.as_deref(), Some(""));
        assert_eq!(body.narrations[0].source.as_deref(), Some("5"));
    }

    #[test]
    fn heading_markers_are_stripped() {
        assert_eq!(prepare_tafsir("### Heading\n\nBody"), "Heading\n\nBody");
    }
}
