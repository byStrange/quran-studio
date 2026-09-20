/**
 * The vocabulary deck, as the interface has to talk about it.
 *
 * The schedule itself lives in one place and it is not here — `srs_next` in
 * the database decides where a card goes, and hands the four candidate
 * intervals back with every card it deals, so nothing in the client has to
 * know how an ease factor compounds. What is here is the other half: how to
 * say an interval out loud, and the one reading of the word list that the
 * reader sees as a marker on an ayah rather than as a list of words.
 */
import type { Word, WordStatus } from "./types";

/**
 * How a card was answered, once the gloss was showing.
 *
 * In grading order, which is also the order the buttons sit in: `again` is
 * the only failing grade, and the three that pass do so at rising confidence
 * and buy rising intervals.
 */
export type ReviewGrade = "again" | "hard" | "good" | "easy";

export const REVIEW_GRADES: readonly ReviewGrade[] = ["again", "hard", "good", "easy"] as const;

/** Whether a grade counts as knowing the word. Only `again` does not. */
export function gradePassed(grade: ReviewGrade): boolean {
  return grade !== "again";
}

// --- intervals -------------------------------------------------------------

/** Unit suffixes for `formatInterval`, so it stays callable outside React. */
export interface IntervalUnits {
  minute: string;
  hour: string;
  day: string;
  month: string;
  year: string;
}

const EN_INTERVAL_UNITS: IntervalUnits = {
  minute: "m",
  hour: "h",
  day: "d",
  month: "mo",
  year: "y",
};

/**
 * "10m" / "1d" / "3wk"… — an interval at the coarsest unit that still says
 * something, for the grade buttons.
 *
 * Anki puts these on the buttons and it is the single thing that makes the
 * four grades mean anything: "hard" and "good" are adjectives a reader has to
 * guess the consequence of, "6m" and "10d" are the consequence. Rounded, never
 * precise — the number is there to be compared with the one next to it.
 */
export function formatInterval(
  minutes: number,
  units: IntervalUnits = EN_INTERVAL_UNITS,
): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return `1${units.minute}`;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}${units.minute}`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}${units.hour}`;

  const days = minutes / 1440;
  if (days < 30) return `${Math.round(days)}${units.day}`;
  if (days < 365) return `${Math.round(days / 30)}${units.month}`;
  return `${(days / 365).toFixed(days < 730 ? 1 : 0)}${units.year}`;
}

/** The same, for a card's current interval, which is stored in days. */
export function formatIntervalDays(days: number, units?: IntervalUnits): string {
  return formatInterval(days * 1440, units);
}

/**
 * How long until a card is due, as a signed count of minutes.
 *
 * Negative means overdue, which is the normal state of a deck that has been
 * left for a few days and is not worth distinguishing from "due now" anywhere
 * the reader can see.
 */
export function minutesUntil(dueAt: string | null): number | null {
  if (!dueAt) return null;
  const at = Date.parse(dueAt);
  return Number.isFinite(at) ? (at - Date.now()) / 60_000 : null;
}

export function isDue(dueAt: string | null): boolean {
  const minutes = minutesUntil(dueAt);
  return minutes !== null && minutes <= 0;
}

// --- the ayah-level marker -------------------------------------------------

/**
 * Whether a word can be quizzed at all.
 *
 * The English gloss is the test rather than the reader's own language,
 * because every other language falls back to it — a word with no English
 * gloss has no gloss in any language, and one that has it can always be asked.
 * The database applies exactly this rule; the two have to agree or an ayah
 * would light up green here and not in the browser's ruku grid.
 */
export function isQuizzable(word: Pick<Word, "gloss_en">): boolean {
  return (word.gloss_en ?? "").trim() !== "";
}

export function quizzableWordIds(words: Word[]): number[] {
  return words.filter(isQuizzable).map((word) => word.id);
}

/**
 * Whether an ayah's words count as learned.
 *
 * Derived, and deliberately not stored. It used to be its own table, which
 * meant an ayah could have every one of its words marked learned and still
 * show as unlearned, or the reverse — two answers to one question, and no way
 * to tell which was the true one. Now there is one fact, the word list, and
 * this is a reading of it: every word that can be asked has been learned. Drop
 * a single word back to learning and the marker goes out, which is the whole
 * point of it.
 *
 * An ayah with no quizzable words at all is not learned — there is nothing to
 * have learned — rather than vacuously true.
 */
export function verseWordsLearned(words: Word[], statuses: Map<number, WordStatus>): boolean {
  const quizzable = words.filter(isQuizzable);
  if (quizzable.length === 0) return false;
  return quizzable.every((word) => statuses.get(word.id) === "learned");
}

/** The ids of the ayahs in `verses` whose words are all learned. */
export function learnedVerseIds(
  verses: Array<{ id: number; words: Word[] }>,
  statuses: Map<number, WordStatus>,
): Set<number> {
  const learned = new Set<number>();
  for (const verse of verses) {
    if (verseWordsLearned(verse.words, statuses)) learned.add(verse.id);
  }
  return learned;
}
