/**
 * Scripture content, in the chosen language.
 *
 * `lib/i18n.ts` owns the language itself and the interface strings; this file
 * owns the other half of the same choice — which translation, which gloss,
 * which tafsir edition the reader is shown. There is one setting behind both,
 * so a reader who picks Russian gets a Russian app and a Russian mushaf.
 *
 * Every place that used to reach for `translation_en` or `gloss_en` directly
 * goes through the accessors here, so a new language is a column, a row in
 * `LANGUAGES`, and nothing else.
 *
 * Fallback is the rule rather than the exception. A language arrives in the
 * picker as soon as the interface and the AI can speak it; the corpora follow
 * at their own pace, and scripture rendering blank while they catch up would
 * be far worse than reading it in English for a while.
 */
import type { Language } from "./i18n";
import type { Verse, Word } from "./types";

/** The fields `verseTranslation` needs, so a partial verse row satisfies it. */
export type TranslatedVerse = Pick<Verse, "translation_en" | "translation_ru" | "translation_uz">;

/**
 * The verse translation in the chosen language.
 *
 * Russian falls back where the import has not reached a verse; Uzbek falls
 * back everywhere until `pnpm seed:translation-uz` has run, which is the
 * current steady state rather than a transient one.
 */
export function verseTranslation(verse: TranslatedVerse, language: Language): string {
  if (language === "ru") return verse.translation_ru || verse.translation_en;
  if (language === "uz") return verse.translation_uz || verse.translation_en;
  return verse.translation_en;
}

export type GlossedWord = Pick<Word, "gloss_en" | "gloss_ru">;

/**
 * The word-by-word gloss in the chosen language.
 *
 * The Russian corpus covers ~98.5% of the Quran's words, so the fallback there
 * is not a migration artefact but the steady state: roughly a thousand words
 * have no Russian gloss and show the English one rather than an empty chip.
 * No Uzbek word-by-word corpus exists upstream at all, so Uzbek reads the
 * English glosses throughout — `quran_words` has no `gloss_uz` column to add
 * data to, and adding an empty one would only make the gap harder to see.
 */
export function wordGloss(word: GlossedWord, language: Language): string | null {
  if (language === "ru") return word.gloss_ru || word.gloss_en;
  return word.gloss_en;
}

/**
 * Whether a tafsir edition belongs to this language.
 *
 * Editions carry an ISO code in `tafsir_editions.language_code`, and all three
 * app languages now have at least one: Ibn Kathir in English, two editions in
 * Russian, and Al-Mukhtasar in Uzbek — which is why Uzbek is a real choice
 * here even while its verse translation is still falling back.
 */
export function editionMatchesLanguage(
  edition: { language_code: string },
  language: Language,
): boolean {
  return edition.language_code === language;
}
