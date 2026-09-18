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
use tauri::Manager;

const DEFAULT_BASE_URL: &str = "https://ollama.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);

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
    chat_with(state, system, user, max_tokens, 0.3, None).await
}

async fn chat_with(
    state: &AiState,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    format: Option<serde_json::Value>,
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
        options: ChatOptions { temperature, num_predict: max_tokens },
        format,
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
                    "required": ["verse_id", "kind", "question", "answer"]
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

/// Keeps the questions that are about the ayahs we actually sent.
///
/// Four things are enforced, in order of how badly they go wrong unchecked:
/// a question must belong to a verse from this round (otherwise it is about
/// scripture the reader was never shown); there is at most one per verse (the
/// round is built one-to-one, and a model that writes three about ayah 1 has
/// lost the plot); question and answer must be non-empty; and `evidence` must
/// appear verbatim in that ayah's Arabic, or it is dropped rather than shown,
/// because evidence that is not in the text is the one thing here that could
/// teach a false reading.
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

        if !q.evidence.is_empty() && !verse.arabic.contains(&q.evidence) {
            q.evidence = String::new();
        }

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
