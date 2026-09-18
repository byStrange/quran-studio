import type { Database } from "./database.types";
import type { Language } from "./i18n";
import type { TajweedSpan } from "./tajweed";

type Tables = Database["public"]["Tables"];

export type Surah = Tables["quran_surahs"]["Row"];
export type Verse = Tables["quran_verses"]["Row"];
export type Ruku = Tables["quran_rukus"]["Row"];
export type Word = Tables["quran_words"]["Row"];
export type TafsirEntry = Tables["tafsir"]["Row"];
export type TafsirEdition = Tables["tafsir_editions"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type StreakState = Tables["streak_state"]["Row"];
export type WordProgress = Tables["user_word_progress"]["Row"];
export type WordStatus = Database["public"]["Enums"]["word_status"];
export type Reciter = Tables["reciters"]["Row"];
export type RecitationFile = Tables["recitation_files"]["Row"];

/**
 * One word's span inside a surah recording, in milliseconds from the start of
 * the file.
 *
 * `position` matches `quran_words.position` and is not guaranteed to increase
 * across an ayah's spans: a reciter who repeats a phrase produces a second
 * span for a word already sung. The player resolves the current word by which
 * span contains the playhead, which handles that without special-casing.
 */
export interface WordSegment {
  position: number;
  startMs: number;
  endMs: number;
}

/** Where one ayah falls inside its surah recording. */
export interface RecitationTiming {
  verseId: number;
  startMs: number;
  endMs: number;
  segments: WordSegment[];
}

/**
 * What repeats when the player reaches the end of what it is playing.
 *
 * `unmemorized` walks only the ayahs of the passage that are not marked
 * memorized, skipping the ones already known — the mode for drilling a ruku
 * where a few ayahs are still shaky.
 */
export type RepeatMode = "off" | "ayah" | "range" | "unmemorized";

/**
 * Which of the three readers a ruku opens in. Stored as a preference rather
 * than chosen per visit: it is a way of reading, not a per-lesson decision, so
 * the toggle in the reader's header sticks until it is turned off again.
 */
export type ReaderMode = "study" | "surah" | "mushaf";

/** How much of the memorized Quran one quiz round draws from. */
export type QuizScope = Database["public"]["Enums"]["quiz_scope"];

/**
 * The verse fields the word explainer needs to describe a word in place.
 * Deliberately narrow, so both the raw row and the reader's richer
 * `VerseWithWords` satisfy it.
 */
export type VerseContext = Pick<
  Verse,
  | "surah_number"
  | "ayah_number"
  | "arabic_text"
  | "translation_en"
  | "translation_ru"
  | "translation_uz"
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
  /**
   * The one language the app speaks: interface chrome, verse translation,
   * word-by-word gloss, tafsir edition, and AI explanations.
   *
   * Replaces the earlier `contentLanguage`, which set the scripture alone
   * while the interface stayed English. `useProfileLanguage` still reads that
   * older key so a profile written before the split was undone keeps its
   * choice; nothing writes it any more.
   */
  language: Language;
  /** Which side of the reader the tafsir panel occupies. */
  tafsirSide: "left" | "right";
  /**
   * Which tafsir edition the panel shows, as a `tafsir_editions.slug`.
   *
   * Stored rather than derived so the choice survives a reload, and kept as a
   * plain string because the set of editions lives in the database — an
   * unknown slug (an edition removed from a later seed) falls back to the
   * default rather than leaving the panel stuck on nothing.
   */
  tafsirEdition: string;
  theme: "light" | "dark" | "system";
  /** Show the word-by-word breakdown expanded by default. */
  wordsExpanded: boolean;
  /**
   * Colour the Arabic by tajweed rule. On by default: readers who rely on the
   * colouring to recite correctly should not have to discover a setting first,
   * and it is a change of colour only, so it costs nothing to those who don't.
   */
  tajweed: boolean;
  /**
   * Which reader opening a ruku lands in.
   *
   * "study" is the ruku reader: translation, word-by-word, tafsir alongside.
   * "surah" is the same reader with the whole surah in one scroll, for someone
   * reading rather than drilling a lesson. "mushaf" is the printed Madani
   * page, which is what someone revising from memory wants — the same words in
   * the same places as the paper copy they memorised from. Study is the
   * default because it is the one that teaches; the other two are one toggle
   * away in the reader's header either way.
   */
  readerMode: ReaderMode;
  /**
   * Which reciter to play, as a `reciters.id`.
   *
   * Null means "not chosen yet" and resolves to the first available reciter
   * rather than to a hardcoded id — the set of reciters lives in the database,
   * and a stored id that a later import removed would otherwise leave the
   * player pointed at nothing.
   */
  reciterId: number | null;
  /**
   * Playback speed. Slower is a real memorization aid, not an accessibility
   * afterthought — it is how a beginner follows a fast murattal.
   */
  playbackRate: number;
  repeatMode: RepeatMode;
  /** Scroll the reader to keep the ayah being recited in view. */
  followRecitation: boolean;
  /** Tint the word currently being recited inside the word-by-word row. */
  highlightWords: boolean;
}

export const DEFAULT_TAFSIR_EDITION = "en-tafisr-ibn-kathir";

export const DEFAULT_UI_PREFS: UiPrefs = {
  language: "en",
  tafsirSide: "right",
  tafsirEdition: DEFAULT_TAFSIR_EDITION,
  theme: "system",
  wordsExpanded: false,
  tajweed: true,
  readerMode: "study",
  reciterId: null,
  playbackRate: 1,
  repeatMode: "off",
  followRecitation: true,
  highlightWords: true,
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
