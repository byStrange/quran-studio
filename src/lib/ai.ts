/**
 * AI generation, cached in Supabase.
 *
 * Generation always goes through a Rust Tauri command so the Ollama Cloud key
 * stays in the backend process. Results are cached in shared tables and reused
 * by every user, so each word explanation and ruku summary is produced once.
 */
import { invoke } from "@tauri-apps/api/core";
import { verseTranslation, wordGloss, type ContentLanguage } from "./language";
import { supabase } from "./supabase";
import type { VerseContext, Word } from "./types";

export interface AiStatus {
  configured: boolean;
  model: string | null;
  error: string | null;
}

/** In a plain browser (`pnpm dev` without Tauri) the Rust backend is absent. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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

// --- word context ----------------------------------------------------------

export interface WordContext {
  explanation: string;
  model_used: string;
  generated_at: string | null;
}

export async function fetchCachedWordContext(
  wordId: number,
  language: ContentLanguage,
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
  language: ContentLanguage,
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
  language: ContentLanguage,
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
    verses: Array<{ ayah_number: number; translation_en: string; translation_ru: string | null }>;
  },
  language: ContentLanguage,
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

/** Turns any thrown value into something worth showing a user. */
export function describeAiError(error: unknown): string {
  if (error instanceof AiUnavailableError) return error.message;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "AI generation failed. Please try again.";
}
