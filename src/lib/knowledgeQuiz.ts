/**
 * The generated quiz: drawing the ayahs, asking the model for questions about
 * them, and recording how the reader did.
 *
 * Vocabulary questions come out of a table — there is a word, there is a
 * gloss, the round is a query. Knowledge questions cannot work that way: "which
 * ayah says this" is not a column. So the app draws the ayahs and the model
 * writes the questions, with the instructions for that living in
 * `src-tauri/src/ollama.rs` next to the key they are sent with.
 *
 * Nothing generated is treated as scripture. The ayah a question came from is
 * shown beside the answer every time, so the reader is always marking
 * themselves against the text rather than against the model; and the backend
 * drops any question whose cited evidence is not literally in that ayah.
 */
import { invoke } from "@tauri-apps/api/core";
import { AiUnavailableError, isTauri } from "./ai";
import { verseTranslation } from "./language";
import type { Language } from "./i18n";
import { supabase } from "./supabase";
import type { Database } from "./database.types";
import type { TranslationKey } from "@/locales/en";
import type { QuizScope } from "./types";

export type KnowledgeQuestionKind = Database["public"]["Enums"]["knowledge_question_kind"];

const NOT_IN_TAURI =
  "Generated quizzes run in the desktop backend. Launch the app with `pnpm app:dev` instead of the browser preview.";

/**
 * What each kind asks for, for the label on a question card.
 *
 * The keys rather than the words, because the label is shown to the reader and
 * the reader has a language. The map is exhaustive over the enum, so adding a
 * kind to the database is a type error here until it has been named in every
 * locale — which is the point at which a missing translation is cheap to fix.
 */
const KIND_LABEL_KEYS: Record<KnowledgeQuestionKind, TranslationKey> = {
  locate: "quiz.kindLocate",
  wording: "quiz.kindWording",
  meaning: "quiz.kindMeaning",
  continuation: "quiz.kindContinuation",
  detail: "quiz.kindDetail",
};

export function kindLabelKey(kind: KnowledgeQuestionKind): TranslationKey {
  return KIND_LABEL_KEYS[kind];
}

/** One ayah as `quiz_verse_pool` returned it. */
export interface QuizVerse {
  verse_id: number;
  surah_number: number;
  ayah_number: number;
  ruku_number: number;
  surah_name: string;
  arabic_text: string;
  translation_en: string;
  translation_ru: string;
  translation_uz: string;
  pool_size: number;
}

/** One question as the model wrote it and the backend accepted it. */
export interface GeneratedQuestion {
  verse_id: number;
  kind: KnowledgeQuestionKind;
  question: string;
  answer: string;
  /** A phrase from the ayah's Arabic, verified verbatim, or "". */
  evidence: string;
}

/** A question together with the ayah it was written from. */
export interface KnowledgeQuestion extends GeneratedQuestion {
  verse: QuizVerse;
}

export interface KnowledgeRound {
  questions: KnowledgeQuestion[];
  modelUsed: string;
}

export interface VersePoolRequest {
  scope: QuizScope;
  limit: number;
  language: Language;
  surah: number | null;
  ruku: number | null;
}

/** Ayahs in a scope, in random order. `limit: 1` is how the size is read. */
export async function drawVerses(request: VersePoolRequest): Promise<QuizVerse[]> {
  const { data, error } = await supabase.rpc("quiz_verse_pool", {
    p_scope: request.scope,
    p_limit: request.limit,
    p_language: request.language,
    p_surah: request.scope === "surah" ? (request.surah ?? undefined) : undefined,
    p_ruku: request.scope === "ruku" ? (request.ruku ?? undefined) : undefined,
  });
  if (error) throw error;
  return (data ?? []) as QuizVerse[];
}

/**
 * Asks the model for one question per ayah.
 *
 * The backend may return fewer than it was given — a question it could not
 * ground in its ayah is dropped rather than shown — so the caller sizes the
 * round from what comes back, not from what it asked for.
 */
export async function generateQuestions(
  verses: QuizVerse[],
  language: Language,
): Promise<KnowledgeRound> {
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);

  const result = await invoke<{ questions: GeneratedQuestion[]; model_used: string }>(
    "ai_generate_knowledge_quiz",
    {
      verses: verses.map((verse) => ({
        verse_id: verse.verse_id,
        surah_number: verse.surah_number,
        ayah_number: verse.ayah_number,
        surah_name: verse.surah_name,
        arabic: verse.arabic_text,
        // The model writes in the reader's language, so it reasons over the
        // translation in that language rather than translating an English one.
        translation: verseTranslation(verse, language),
      })),
      language,
    },
  );

  const byId = new Map(verses.map((verse) => [verse.verse_id, verse]));
  const questions = result.questions.flatMap((question) => {
    const verse = byId.get(question.verse_id);
    return verse ? [{ ...question, verse }] : [];
  });

  return { questions, modelUsed: result.model_used };
}

// --- recording -------------------------------------------------------------

export interface SessionRequest {
  scope: QuizScope;
  questionCount: number;
  language: Language;
  surah: number | null;
  ruku: number | null;
  model: string | null;
}

/**
 * Opens a round, after generation has succeeded.
 *
 * Deliberately not before: a round the model could not write questions for
 * should leave nothing behind, or a bad network fills the history with empty
 * sessions and drags the averages down with them.
 */
export async function startSession(request: SessionRequest): Promise<string> {
  const { data, error } = await supabase.rpc("start_knowledge_quiz", {
    p_scope: request.scope,
    p_question_count: request.questionCount,
    p_language: request.language,
    p_surah: request.surah ?? undefined,
    p_ruku: request.ruku ?? undefined,
    p_model: request.model ?? undefined,
  });
  if (error) throw error;
  return data as string;
}

export interface AnswerRecord {
  sessionId: string;
  position: number;
  question: KnowledgeQuestion;
  /** What the reader said before the answer was shown. */
  claimed: boolean;
  /** What they confirmed after seeing it. This is the one that scores. */
  correct: boolean;
}

/**
 * Records one answer. Safe to call again for the same position — the row is
 * upserted, which is what makes changing your mind at the confirm step work.
 */
export async function recordAnswer(record: AnswerRecord): Promise<void> {
  const { error } = await supabase.rpc("record_knowledge_answer", {
    p_session_id: record.sessionId,
    p_position: record.position,
    p_verse_id: record.question.verse_id,
    p_kind: record.question.kind,
    p_question: record.question.question,
    p_expected: record.question.answer,
    p_claimed: record.claimed,
    p_correct: record.correct,
  });
  if (error) throw error;
}

export async function finishSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc("finish_knowledge_quiz", { p_session_id: sessionId });
  if (error) throw error;
}
