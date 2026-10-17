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
 * The fields `selectedVerseTranslations` needs — every translation column, since
 * the reader can show any of them. Wider than `TranslatedVerse` on purpose: the
 * single-translation accessor reads only three columns and keeps its narrow type
 * so the quiz and AI rows, which have no Mansur column, still satisfy it.
 */
export type MultiTranslatedVerse = Pick<
  Verse,
  "translation_en" | "translation_ru" | "translation_uz" | "translation_uz_mansur"
>;

/**
 * The verse translation in the chosen language.
 *
 * Russian falls back where the import has not reached a verse; Uzbek falls
 * back everywhere until `pnpm seed:translation-uz` has run, which is the
 * current steady state rather than a transient one.
 *
 * This is the single-translation accessor, still the right one wherever the app
 * shows exactly one translation in the interface language: the quiz, the AI
 * prompts, the tafsir nudge. The reader, which lets the user stack several
 * translations, goes through `selectedVerseTranslations` instead.
 */
export function verseTranslation(verse: TranslatedVerse, language: Language): string {
  if (language === "ru") return verse.translation_ru || verse.translation_en;
  if (language === "uz") return verse.translation_uz || verse.translation_en;
  return verse.translation_en;
}

// --- translation editions --------------------------------------------------

/**
 * One selectable verse translation.
 *
 * Where `LANGUAGES` has one translation per interface language, this is the
 * finer grain the reader's picker works in: a language can carry several
 * editions (Uzbek has two), and the reader shows any set of them at once. The
 * key is what the preference stores; the column is where the text lives, which
 * is why adding an edition is a column and a row here and nothing else.
 */
export interface TranslationEdition {
  /** Stable id stored in `ui_prefs.translations`. */
  key: string;
  /** The `quran_verses` column holding this translation's text. */
  column: "translation_en" | "translation_ru" | "translation_uz" | "translation_uz_mansur";
  /** Attribution, shown both in the reader and in the picker. */
  translator: string;
  /**
   * The interface language this edition belongs to — groups the picker and
   * supplies the default for a reader who has not chosen explicitly.
   */
  language: Language;
  /** BCP-47 tag for the rendered text's `lang`, so fonts and hyphenation fit. */
  tag: string;
}

export const TRANSLATION_EDITIONS: readonly TranslationEdition[] = [
  {
    key: "en",
    column: "translation_en",
    translator: "Saheeh International",
    language: "en",
    tag: "en",
  },
  {
    key: "ru",
    column: "translation_ru",
    translator: "Эльмир Кулиев",
    language: "ru",
    tag: "ru",
  },
  {
    key: "uz-sodiq",
    column: "translation_uz",
    translator: "Muhammad Sodiq Muhammad Yusuf",
    language: "uz",
    tag: "uz-Latn",
  },
  {
    // Cyrillic, the one edition that is — see the migration and seed script.
    key: "uz-mansur",
    column: "translation_uz_mansur",
    translator: "Alouddin Mansur",
    language: "uz",
    tag: "uz-Cyrl",
  },
] as const;

export function translationEdition(key: string): TranslationEdition | undefined {
  return TRANSLATION_EDITIONS.find((e) => e.key === key);
}

/**
 * The edition that stood in for a language before the picker existed.
 *
 * The default a reader falls back to when they have selected nothing — so an
 * English reader still sees Saheeh International, a Russian reader Kuliev, an
 * Uzbek reader Shaykh Muhammad Sodiq, exactly as the single `language` setting
 * used to give them.
 */
export function defaultTranslationKey(language: Language): string {
  return TRANSLATION_EDITIONS.find((e) => e.language === language)?.key ?? "en";
}

/**
 * The selected keys, cleaned up.
 *
 * An empty or absent preference means "follow the interface language", which is
 * what keeps every existing reader unchanged until they open the picker; an
 * unknown key (an edition dropped from a later build) is simply ignored. Either
 * way the result is never empty, so the reader never renders no translation.
 */
export function resolveTranslationKeys(
  keys: string[] | undefined,
  language: Language,
): string[] {
  // De-duplicated as well as filtered: `ui_prefs.translations` is free-form
  // JSON, so a hand-edited or legacy value like ["en", "en"] would otherwise
  // render the same translation twice under duplicate React keys. The app's own
  // toggle never writes a duplicate, but the store is not the only writer.
  const known = [...new Set(keys ?? [])].filter((key) => translationEdition(key) !== undefined);
  return known.length > 0 ? known : [defaultTranslationKey(language)];
}

/** One translation, resolved and ready to render. */
export interface RenderedTranslation {
  key: string;
  translator: string;
  tag: string;
  text: string;
}

/**
 * The translations the reader should show, in the chosen order.
 *
 * Each falls back to English per verse the same way `verseTranslation` does, so
 * a translation whose import has not reached a verse shows the English text
 * rather than a blank line. Crucially the attribution follows the text: a verse
 * that falls back is labelled Saheeh International in `en`, not misattributed to
 * the edition the reader selected. That matters now that the label is visible —
 * before the seed runs, `translation_uz_mansur` is null for every verse, and
 * printing Saheeh International's English under the heading "Alouddin Mansur"
 * (and tagged `uz-Cyrl`) would be an actively wrong credit. `key` stays the
 * selected edition's, so it is stable and unique across the rendered list.
 */
export function selectedVerseTranslations(
  verse: MultiTranslatedVerse,
  keys: string[] | undefined,
  language: Language,
): RenderedTranslation[] {
  const english = translationEdition("en")!;
  return resolveTranslationKeys(keys, language).map((key) => {
    const edition = translationEdition(key)!;
    const own = verse[edition.column];
    // The edition that actually supplied the text — the selected one when it
    // has this verse, English when it is falling back.
    const source = own ? edition : english;
    return {
      key,
      translator: source.translator,
      tag: source.tag,
      text: own || verse.translation_en,
    };
  });
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
