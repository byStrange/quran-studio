/**
 * AI generation, cached in Supabase.
 *
 * Generation always goes through a Rust Tauri command so the Ollama Cloud key
 * stays in the backend process. Results are cached in shared tables and reused
 * by every user, so each word explanation and ruku summary is produced once.
 */
import { invoke } from "@tauri-apps/api/core";
import { verseTranslation, wordGloss } from "./language";
import type { Language } from "./i18n";
import type { TFunction } from "@/providers/I18nProvider";
import { supabase } from "./supabase";
import type { VerseContext, Word } from "./types";
import type { Json } from "./database.types";

export interface AiStatus {
  configured: boolean;
  model: string | null;
  error: string | null;
}

/** In a plain browser (`pnpm dev` without Tauri) the Rust backend is absent. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Raised when generation is asked for outside the desktop backend.
 *
 * The message is English and is never the one shown: `describeAiError` renders
 * this case from the dictionary. It exists so the error is still readable in a
 * console, a log, or a stack trace, where there is no translator.
 */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

const NOT_IN_TAURI =
  "AI generation runs in the desktop backend. Launch the app with `pnpm app:dev` instead of the browser preview.";

export async function getAiStatus(): Promise<AiStatus> {
  if (!isTauri()) {
    return { configured: false, model: null, error: NOT_IN_TAURI };
  }
  return invoke<AiStatus>("ai_status");
}

export async function setAiApiKey(apiKey: string): Promise<AiStatus> {
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);
  return invoke<AiStatus>("ai_set_api_key", { apiKey });
}

// --- word-by-word gloss extraction (vision) --------------------------------

/** One Arabic word to be glossed, keyed by its `quran_words.id`. */
export interface ScaffoldWord {
  id: number;
  arabic: string;
}

/** One gloss the vision model read off the page, keyed back to the word id. */
export interface ExtractedGloss {
  id: number;
  gloss: string;
}

/**
 * Reads the Uzbek word-by-word glosses off photographed mushaf page(s).
 *
 * `words` is the ordered scaffold built from `quran_words`; the model fills a
 * gloss per id and the caller aligns by id. `images` are base64 strings WITHOUT
 * the `data:` URL prefix. Desktop only — the Ollama key lives in the backend.
 * Unlike the other generators this is never cached: it is a one-off transcription
 * a human then edits, not a shared result.
 */
export async function extractGlosses(
  words: ScaffoldWord[],
  images: string[],
  language: Language,
): Promise<ExtractedGloss[]> {
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);
  return invoke<ExtractedGloss[]>("ai_extract_glosses", { words, images, language });
}

// --- word context ----------------------------------------------------------

export interface WordContext {
  explanation: string;
  model_used: string;
  generated_at: string | null;
}

export async function fetchCachedWordContext(
  wordId: number,
  language: Language,
): Promise<WordContext | null> {
  const { data, error } = await supabase
    .from("word_ai_context")
    .select("explanation, model_used, generated_at")
    .eq("word_id", wordId)
    .eq("language", language)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/**
 * Returns the cached explanation, generating and caching one on first request.
 * `force` backs the manual regenerate action.
 */
export async function getWordContext(
  word: Word,
  verse: VerseContext,
  language: Language,
  options: { force?: boolean } = {},
): Promise<WordContext> {
  if (!options.force) {
    const cached = await fetchCachedWordContext(word.id, language);
    if (cached) return cached;
  }
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);

  const generated = await invoke<{ explanation: string; model_used: string }>(
    "ai_generate_word_context",
    {
      arabic: word.arabic,
      transliteration: word.transliteration ?? "",
      gloss: wordGloss(word, language) ?? "",
      surahNumber: verse.surah_number,
      ayahNumber: verse.ayah_number,
      verseArabic: verse.arabic_text,
      verseTranslation: verseTranslation(verse, language),
      language,
    },
  );

  const row = {
    word_id: word.id,
    language,
    explanation: generated.explanation,
    model_used: generated.model_used,
    generated_at: new Date().toISOString(),
  };
  // A cache write failure must never lose the text the user just waited for.
  const { error } = await supabase
    .from("word_ai_context")
    .upsert(row, { onConflict: "word_id,language" });
  if (error) console.warn("could not cache word context:", error.message);

  return row;
}

// --- ruku summaries --------------------------------------------------------

export interface RukuSummary {
  summary: string;
  model_used: string;
  generated_at: string | null;
}

export async function fetchCachedRukuSummary(
  rukuNumber: number,
  language: Language,
): Promise<RukuSummary | null> {
  const { data, error } = await supabase
    .from("ruku_ai_summary")
    .select("summary, model_used, generated_at")
    .eq("ruku_number", rukuNumber)
    .eq("language", language)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function getRukuSummary(
  input: {
    rukuNumber: number;
    surahName: string;
    verseRange: string;
    verses: Array<{
      ayah_number: number;
      translation_en: string;
      translation_ru: string | null;
      translation_uz: string | null;
    }>;
  },
  language: Language,
  options: { force?: boolean } = {},
): Promise<RukuSummary> {
  if (!options.force) {
    const cached = await fetchCachedRukuSummary(input.rukuNumber, language);
    if (cached) return cached;
  }
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);

  // The passage goes to the model in the language it is asked to write in,
  // so a Russian summary reasons over the Russian translation rather than
  // silently translating an English one.
  const passage = input.verses
    .map((v) => `${v.ayah_number}. ${verseTranslation(v, language)}`)
    .join("\n");

  const generated = await invoke<{ summary: string; model_used: string }>(
    "ai_generate_ruku_summary",
    {
      rukuNumber: input.rukuNumber,
      surahName: input.surahName,
      verseRange: input.verseRange,
      passage,
      language,
    },
  );

  const row = {
    ruku_number: input.rukuNumber,
    language,
    summary: generated.summary,
    model_used: generated.model_used,
    generated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("ruku_ai_summary")
    .upsert(row, { onConflict: "ruku_number,language" });
  if (error) console.warn("could not cache ruku summary:", error.message);

  return row;
}

// --- tafsir summaries -------------------------------------------------------

/**
 * A study summary of one tafsir entry, as the backend validated it: every
 * narration in it carries a `quote` the backend found in the entry itself.
 */
export interface TafsirSummaryBody {
  gist: string;
  key_points: Array<{ point: string; ayah: number | null }>;
  recall: Array<{ question: string; answer: string }>;
  narrations: Array<{
    kind: "hadith" | "athar";
    text: string;
    narrator: string | null;
    source: string | null;
    /** Where the narration sits in the tafsir, in the tafsir's own spelling. */
    quote: string;
  }>;
}

export interface TafsirSummary {
  summary: TafsirSummaryBody;
  model_used: string;
  generated_at: string | null;
}

export interface TafsirSummaryKey {
  edition: string;
  surahNumber: number;
  ayahStart: number;
}

export async function fetchCachedTafsirSummary(
  key: TafsirSummaryKey,
  language: Language,
): Promise<TafsirSummary | null> {
  const { data, error } = await supabase
    .from("tafsir_ai_summary")
    .select("summary, model_used, generated_at")
    .eq("edition", key.edition)
    .eq("surah_number", key.surahNumber)
    .eq("ayah_start", key.ayahStart)
    .eq("language", language)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, summary: data.summary as unknown as TafsirSummaryBody } : null;
}

/**
 * The summary is written in the reader's language from the tafsir as it is
 * written — the model reads the Cyrillic Uzbek or the Russian original rather
 * than a translation of it, so a narration's `quote` can be checked against
 * the text the reader has on screen.
 */
export async function getTafsirSummary(
  input: TafsirSummaryKey & {
    tafsirName: string;
    surahName: string;
    ayahEnd: number;
    content: string;
  },
  language: Language,
  options: { force?: boolean } = {},
): Promise<TafsirSummary> {
  if (!options.force) {
    // A cache that cannot be read is a reason to generate, not to fail.
    const cached = await fetchCachedTafsirSummary(input, language).catch(() => null);
    if (cached) return cached;
  }
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);

  const generated = await invoke<{ summary: TafsirSummaryBody; model_used: string }>(
    "ai_generate_tafsir_summary",
    {
      tafsirName: input.tafsirName,
      surahName: input.surahName,
      surahNumber: input.surahNumber,
      ayahStart: input.ayahStart,
      ayahEnd: input.ayahEnd,
      content: input.content,
      language,
    },
  );

  const row = {
    edition: input.edition,
    surah_number: input.surahNumber,
    ayah_start: input.ayahStart,
    language,
    summary: generated.summary as unknown as Json,
    model_used: generated.model_used,
    generated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("tafsir_ai_summary")
    .upsert(row, { onConflict: "edition,surah_number,ayah_start,language" });
  if (error) console.warn("could not cache tafsir summary:", error.message);

  return { summary: generated.summary, model_used: row.model_used, generated_at: row.generated_at };
}

/**
 * Turns any thrown value into something worth showing a user.
 *
 * Only the two cases this app produces itself are translated. A message that
 * came back from Ollama or from Supabase is passed through as it arrived:
 * it is the only description of what actually went wrong, and replacing it
 * with a translated generic would throw away the one useful thing in it.
 */
export function describeAiError(error: unknown, t: TFunction): string {
  if (error instanceof AiUnavailableError) return t("ai.notInTauri");
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  // Supabase errors are plain objects with a message, not `Error`s.
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return t("ai.failed");
}
