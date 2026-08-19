/**
 * Content language.
 *
 * This is the language of the *scripture material* — the verse translation,
 * the word-by-word gloss, the tafsir edition, and the AI explanations. It is
 * deliberately not the language of the interface chrome, which stays English:
 * a reader who wants the Quran in Russian is not necessarily asking for the
 * settings screen in Russian, and conflating the two would make the choice
 * much harder to reverse.
 *
 * Every place that used to reach for `translation_en` or `gloss_en` directly
 * now goes through the accessors here, so adding a third language is a matter
 * of a column, a row in `CONTENT_LANGUAGES`, and nothing else.
 */
import type { Verse, Word } from "./types";

export type ContentLanguage = "en" | "ru";

export interface ContentLanguageInfo {
  code: ContentLanguage;
  /** Name in English, for the settings list. */
  label: string;
  /** Name in the language itself, as that list's subtitle. */
  nativeLabel: string;
  /** Whose translation this language shows, for attribution. */
  translator: string;
}

export const CONTENT_LANGUAGES: readonly ContentLanguageInfo[] = [
  {
    code: "en",
    label: "English",
    nativeLabel: "English",
    translator: "Saheeh International",
  },
  {
    code: "ru",
    label: "Russian",
    nativeLabel: "Русский",
    translator: "Эльмир Кулиев",
  },
] as const;

export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = "en";

export function isContentLanguage(value: unknown): value is ContentLanguage {
  return CONTENT_LANGUAGES.some((l) => l.code === value);
}

export function contentLanguageInfo(language: ContentLanguage): ContentLanguageInfo {
  return CONTENT_LANGUAGES.find((l) => l.code === language) ?? CONTENT_LANGUAGES[0]!;
}

/** The fields `verseTranslation` needs, so a partial verse row satisfies it. */
export type TranslatedVerse = Pick<Verse, "translation_en" | "translation_ru">;

/**
 * The verse translation in the chosen language.
 *
 * Falls back to English when the Russian column is null, which is what a
 * database seeded before the Russian import looks like. Scripture rendering
 * blank is the one outcome worth any amount of fallback.
 */
export function verseTranslation(verse: TranslatedVerse, language: ContentLanguage): string {
  if (language === "ru") return verse.translation_ru || verse.translation_en;
  return verse.translation_en;
}

export type GlossedWord = Pick<Word, "gloss_en" | "gloss_ru">;

/**
 * The word-by-word gloss in the chosen language.
 *
 * The Russian corpus covers ~98.5% of the Quran's words, so the fallback here
 * is not a migration artefact but the steady state: roughly a thousand words
 * have no Russian gloss and show the English one rather than an empty chip.
 */
export function wordGloss(word: GlossedWord, language: ContentLanguage): string | null {
  if (language === "ru") return word.gloss_ru || word.gloss_en;
  return word.gloss_en;
}

/**
 * Whether a tafsir edition belongs to this language.
 *
 * Editions carry an ISO code in `tafsir_editions.language_code`. Uzbek is not
 * a content language, so its edition matches nothing here and stays reachable
 * only by picking it explicitly — which is the intent: it is a real edition
 * for the readers who want it, not a default for anybody.
 */
export function editionMatchesLanguage(
  edition: { language_code: string },
  language: ContentLanguage,
): boolean {
  return edition.language_code === language;
}
