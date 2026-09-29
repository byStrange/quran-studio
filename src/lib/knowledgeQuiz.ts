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
 * Most of a round (`TAFSIR_SHARE`) is written from Ibn Kathir's commentary on
 * the ayah rather than from the ayah alone, so the round tests what the ayah
 * means as well as what it says. The rest stay Quran-only.
 *
 * Nothing generated is treated as scripture. The ayah a question came from is
 * shown beside the answer every time, so the reader is always marking
 * themselves against the text rather than against the model; and the backend
 * drops any question whose cited evidence cannot be located in that ayah — or,
 * for a tafsir question, in the stretch of commentary it was written from.
 */
import { invoke } from "@tauri-apps/api/core";
import { AiUnavailableError, isTauri } from "./ai";
import { verseTranslation } from "./language";
import { toParagraphs } from "./utils";
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
  tafsir: "quiz.kindTafsir",
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
  /**
   * A phrase from the ayah's Arabic, verified verbatim. For a `tafsir`
   * question, the sentence of the commentary that carries the answer instead,
   * in the commentary's own spelling.
   */
  evidence: string;
}

/** A question together with the ayah it was written from. */
export interface KnowledgeQuestion extends GeneratedQuestion {
  verse: QuizVerse;
  /** The stretch of commentary a `tafsir` question was written from. */
  tafsirExcerpt?: string;
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

// --- tafsir ----------------------------------------------------------------

/**
 * Which commentary tafsir questions come from, per reader language: Ibn
 * Kathir throughout, in the edition the reader can read. The name is what the
 * model attributes answers to, so it is spelled for the reader too — the
 * Uzbek edition is Cyrillic, but an Uzbek reader's answers are Latin.
 */
export const QUIZ_TAFSIR: Record<Language, { edition: string; name: string }> = {
  en: { edition: "en-tafisr-ibn-kathir", name: "Ibn Kathir" },
  ru: { edition: "ru-tafsir-ibne-kahtir", name: "Ибн Касир" },
  uz: { edition: "uz-tafsir-ibn-kathir", name: "Ibn Kasir" },
};

/** The part of a round asked from the tafsir; the rest are Quran-only. */
const TAFSIR_SHARE = 0.7;

/**
 * How much commentary goes with one ayah. An Ibn Kathir entry can run to
 * twenty paragraphs; a window of it keeps a batch of four ayahs readable in
 * one call, and a different window next round asks about a different part.
 */
const EXCERPT_MAX_CHARS = 6_000;

/** Tafsir questions per backend call. The calls run in parallel. */
const TAFSIR_BATCH = 4;

interface TafsirEntry {
  verse_id: number;
  ayah_start: number;
  ayah_end: number;
  content: string;
}

/** A small seeded generator, so a round's choices follow from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchTafsir(
  verses: QuizVerse[],
  edition: string,
): Promise<Map<number, TafsirEntry>> {
  const { data, error } = await supabase.rpc("quiz_tafsir_for_verses", {
    p_edition: edition,
    p_verse_ids: verses.map((verse) => verse.verse_id),
  });
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.verse_id, row]));
}

/**
 * A window of whole paragraphs from the entry, at most `EXCERPT_MAX_CHARS`
 * long, starting at a random paragraph and widened backwards if it runs out
 * of passage before it runs out of room.
 */
function excerptOf(content: string, random: () => number): string {
  const paragraphs = toParagraphs(content.replace(/^\s*### /gm, ""));
  const whole = paragraphs.join("\n\n");
  if (whole.length <= EXCERPT_MAX_CHARS) return whole;

  const start = Math.floor(random() * paragraphs.length);
  let first = start;
  let last = start;
  let length = paragraphs[start]!.length;
  while (last + 1 < paragraphs.length && length + paragraphs[last + 1]!.length + 2 <= EXCERPT_MAX_CHARS) {
    length += paragraphs[++last]!.length + 2;
  }
  while (first > 0 && length + paragraphs[first - 1]!.length + 2 <= EXCERPT_MAX_CHARS) {
    length += paragraphs[--first]!.length + 2;
  }

  const excerpt = paragraphs.slice(first, last + 1).join("\n\n");
  if (excerpt.length <= EXCERPT_MAX_CHARS) return excerpt;
  // One paragraph longer than the whole budget: cut it at a sentence.
  const cut = excerpt.slice(0, EXCERPT_MAX_CHARS);
  const sentence = cut.lastIndexOf(". ");
  return sentence > EXCERPT_MAX_CHARS / 2 ? cut.slice(0, sentence + 1) : cut;
}

interface RoundPlan {
  quran: QuizVerse[];
  tafsir: Array<{ verse: QuizVerse; excerpt: string }>;
}

/**
 * Splits the drawn ayahs between tafsir and Quran-only questions.
 *
 * Only an ayah the edition has commentary on can take a tafsir question, and
 * only one ayah per commentary entry — two ayahs of one 2:1-5 entry would be
 * two questions about the same paragraphs. Everything else, including every
 * ayah in the Uzbek edition's gaps, is asked from the Quran. If the
 * commentary cannot be fetched at all the round is Quran-only rather than
 * not a round.
 */
async function planRound(
  verses: QuizVerse[],
  language: Language,
  seed: number,
): Promise<RoundPlan> {
  let entries = new Map<number, TafsirEntry>();
  try {
    entries = await fetchTafsir(verses, QUIZ_TAFSIR[language].edition);
  } catch (error) {
    console.warn("tafsir unavailable for this round, asking from the Quran only:", error);
  }

  const random = seededRandom(seed);
  const wanted = Math.round(verses.length * TAFSIR_SHARE);
  const usedEntries = new Set<string>();
  const plan: RoundPlan = { quran: [], tafsir: [] };

  for (const verse of verses) {
    const entry = entries.get(verse.verse_id);
    const key = entry ? `${verse.surah_number}:${entry.ayah_start}` : "";
    if (entry && plan.tafsir.length < wanted && !usedEntries.has(key)) {
      usedEntries.add(key);
      plan.tafsir.push({ verse, excerpt: excerptOf(entry.content, random) });
    } else {
      plan.quran.push(verse);
    }
  }
  return plan;
}

// --- generation ------------------------------------------------------------

type GeneratedBatch = { questions: GeneratedQuestion[]; model_used: string };

function describeVerse(verse: QuizVerse, language: Language) {
  return {
    verse_id: verse.verse_id,
    surah_number: verse.surah_number,
    ayah_number: verse.ayah_number,
    surah_name: verse.surah_name,
    arabic: verse.arabic_text,
    // The model writes in the reader's language, so it reasons over the
    // translation in that language rather than translating an English one.
    translation: verseTranslation(verse, language),
  };
}

/**
 * Asks the model for one question per ayah — most from the tafsir, the rest
 * from the ayah alone.
 *
 * The Quran-only questions are one call and the tafsir questions are several
 * small ones, all in flight at once. A call that fails costs its own
 * questions and nothing else; the round only fails if every call does.
 *
 * The backend may return fewer than it was given — a question it could not
 * ground in its source is dropped rather than shown — so the caller sizes the
 * round from what comes back, not from what it asked for.
 */
export async function generateQuestions(
  verses: QuizVerse[],
  language: Language,
  seed: number,
): Promise<KnowledgeRound> {
  if (!isTauri()) throw new AiUnavailableError(NOT_IN_TAURI);

  const plan = await planRound(verses, language, seed);
  const excerpts = new Map(plan.tafsir.map((item) => [item.verse.verse_id, item.excerpt]));

  const calls: Array<Promise<GeneratedBatch>> = [];
  if (plan.quran.length > 0) {
    calls.push(
      invoke<GeneratedBatch>("ai_generate_knowledge_quiz", {
        verses: plan.quran.map((verse) => describeVerse(verse, language)),
        language,
      }),
    );
  }
  for (let i = 0; i < plan.tafsir.length; i += TAFSIR_BATCH) {
    calls.push(
      invoke<GeneratedBatch>("ai_generate_tafsir_quiz", {
        items: plan.tafsir
          .slice(i, i + TAFSIR_BATCH)
          .map(({ verse, excerpt }) => ({ ...describeVerse(verse, language), excerpt })),
        tafsirName: QUIZ_TAFSIR[language].name,
        language,
      }),
    );
  }

  const settled = await Promise.allSettled(calls);
  const batches = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  if (batches.length === 0) {
    const failure = settled.find((result) => result.status === "rejected");
    throw failure ? failure.reason : new Error("no questions were generated");
  }

  // Back into the order the ayahs were drawn in, whichever call wrote them.
  const order = new Map(verses.map((verse, index) => [verse.verse_id, index]));
  const byId = new Map(verses.map((verse) => [verse.verse_id, verse]));
  const questions = batches
    .flatMap((batch) => batch.questions)
    .sort((a, b) => (order.get(a.verse_id) ?? 0) - (order.get(b.verse_id) ?? 0))
    .flatMap((question) => {
      const verse = byId.get(question.verse_id);
      if (!verse) return [];
      const tafsirExcerpt = question.kind === "tafsir" ? excerpts.get(question.verse_id) : undefined;
      return [{ ...question, verse, tafsirExcerpt }];
    });

  return { questions, modelUsed: batches[0]!.model_used };
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
