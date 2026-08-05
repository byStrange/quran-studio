import type { Database } from "./database.types";
import type { TajweedSpan } from "./tajweed";

type Tables = Database["public"]["Tables"];

export type Surah = Tables["quran_surahs"]["Row"];
export type Verse = Tables["quran_verses"]["Row"];
export type Ruku = Tables["quran_rukus"]["Row"];
export type Word = Tables["quran_words"]["Row"];
export type TafsirEntry = Tables["tafsir_ibn_kathir"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type StreakState = Tables["streak_state"]["Row"];
export type WordProgress = Tables["user_word_progress"]["Row"];
export type WordStatus = Database["public"]["Enums"]["word_status"];

/**
 * The verse fields the word explainer needs to describe a word in place.
 * Deliberately narrow, so both the raw row and the reader's richer
 * `VerseWithWords` satisfy it.
 */
export type VerseContext = Pick<
  Verse,
  "surah_number" | "ayah_number" | "arabic_text" | "translation_en"
>;

/**
 * A verse together with its words, as the reader consumes it.
 *
 * `tajweed` is `Json` on the generated row type; it is narrowed here because
 * the importer is the only writer and its shape is fixed. Null means the verse
 * predates the tajweed import, and renders plain.
 */
export interface VerseWithWords extends Omit<Verse, "tajweed"> {
  words: Word[];
  tajweed: TajweedSpan[] | null;
}

/** UI preferences persisted in `profiles.ui_prefs`. */
export interface UiPrefs {
  /** Which side of the reader the tafsir panel occupies. */
  tafsirSide: "left" | "right";
  theme: "light" | "dark" | "system";
  /** Show the word-by-word breakdown expanded by default. */
  wordsExpanded: boolean;
  /**
   * Colour the Arabic by tajweed rule. On by default: readers who rely on the
   * colouring to recite correctly should not have to discover a setting first,
   * and it is a change of colour only, so it costs nothing to those who don't.
   */
  tajweed: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  tafsirSide: "right",
  theme: "system",
  wordsExpanded: false,
  tajweed: true,
};

export interface ReadingOverview {
  today_seconds: number;
  week_seconds: number;
  month_seconds: number;
  total_seconds: number;
  days_read: number;
  today: string;
}

export interface MemorizationOverview {
  verses_memorized: number;
  total_verses: number;
  surahs_completed: number;
  words_learned: number;
  words_learning: number;
}
