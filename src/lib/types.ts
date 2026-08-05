import type { Database } from "./database.types";

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

/** A verse together with its words, as the reader consumes it. */
export interface VerseWithWords extends Verse {
  words: Word[];
}

/** UI preferences persisted in `profiles.ui_prefs`. */
export interface UiPrefs {
  /** Which side of the reader the tafsir panel occupies. */
  tafsirSide: "left" | "right";
  theme: "light" | "dark" | "system";
  /** Show the word-by-word breakdown expanded by default. */
  wordsExpanded: boolean;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  tafsirSide: "right",
  theme: "system",
  wordsExpanded: false,
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
