/**
 * Localization.
 *
 * One language drives everything: the interface chrome, the verse translation,
 * the word-by-word gloss, the tafsir edition, and the language the AI writes
 * its explanations in. Splitting "interface language" from "content language"
 * was the earlier design and it was a worse one — a reader who picks Russian
 * is asking for a Russian app, and asking them to find two pickers to get it
 * made the common case harder to serve the rarest one.
 *
 * Where a language has no data for something, the accessor falls back rather
 * than the picker hiding the language: `lib/language.ts` holds those rules.
 * Uzbek is the live example — the interface, the AI and the tafsir are Uzbek
 * today, and the verse translation falls back to English until the import
 * lands.
 *
 * The dictionary is a plain typed object rather than an i18n library. The app
 * needs interpolation and plurals and nothing else, both are a few lines over
 * `Intl.PluralRules`, and a flat keyed record gives compile-time checking that
 * every language covers every string — which is the failure worth catching.
 */

export type Language = "en" | "ru" | "uz";

export interface LanguageInfo {
  code: Language;
  /** Name in English, for prose that names the language. */
  label: string;
  /** Name in the language itself — what the picker actually shows. */
  nativeLabel: string;
  /** Whose verse translation this language reads, for attribution. */
  translator: string;
  /** BCP-47 tag, for `document.documentElement.lang` and `Intl`. */
  tag: string;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  {
    code: "en",
    label: "English",
    nativeLabel: "English",
    translator: "Saheeh International",
    tag: "en",
  },
  {
    code: "ru",
    label: "Russian",
    nativeLabel: "Русский",
    translator: "Эльмир Кулиев",
    tag: "ru",
  },
  {
    // Latin, not the Cyrillic the bundled Uzbek tafsir is written in. The
    // script split is real and unavoidable: the Mukhtasar edition exists only
    // in Cyrillic, while Latin is what the country writes in today. The
    // interface follows the reader; the edition stays as published.
    code: "uz",
    label: "Uzbek",
    nativeLabel: "O'zbekcha",
    translator: "Saheeh International",
    tag: "uz-Latn",
  },
] as const;

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.some((l) => l.code === value);
}

export function languageInfo(language: Language): LanguageInfo {
  return LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]!;
}

// --- dictionary shape ------------------------------------------------------

/**
 * A string with one form per plural category.
 *
 * `other` is the only required form, because it is the one every language has
 * and the one the lookup falls back to. English fills `one`; Russian fills
 * `one`, `few` and `many`; Uzbek needs neither, since a counted noun there
 * does not change shape — `{count} so'z` is right for every count.
 */
export interface PluralForms {
  one?: string;
  few?: string;
  many?: string;
  other: string;
}

export type Entry = string | PluralForms;

export type TranslationParams = Record<string, string | number>;

// --- lookup ----------------------------------------------------------------

const PLURAL_RULES = new Map<Language, Intl.PluralRules>();

function pluralRules(language: Language): Intl.PluralRules {
  let rules = PLURAL_RULES.get(language);
  if (!rules) {
    // `uz-Latn` and `ru` are both understood; the try/catch is for a runtime
    // with a stub ICU, where falling back to English rules still renders a
    // sentence rather than throwing inside a render.
    try {
      rules = new Intl.PluralRules(languageInfo(language).tag);
    } catch {
      rules = new Intl.PluralRules("en");
    }
    PLURAL_RULES.set(language, rules);
  }
  return rules;
}

function selectForm(entry: PluralForms, language: Language, count: number): string {
  const category = pluralRules(language).select(count);
  if (category === "one" && entry.one !== undefined) return entry.one;
  if (category === "few" && entry.few !== undefined) return entry.few;
  if (category === "many" && entry.many !== undefined) return entry.many;
  return entry.other;
}

/** Replaces `{name}` with `params.name`, leaving unknown placeholders alone. */
function interpolate(template: string, params: TranslationParams | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/**
 * Resolves one entry against a language and its parameters.
 *
 * Takes the entry rather than the key so the dictionary type stays generic:
 * `locales/en.ts` defines the keys and every other locale is checked against
 * it, which is what makes a missing string a compile error instead of a blank
 * label in production.
 */
export function resolveEntry(
  entry: Entry,
  language: Language,
  params?: TranslationParams,
): string {
  const template =
    typeof entry === "string"
      ? entry
      : selectForm(entry, language, Number(params?.count ?? 0));
  return interpolate(template, params);
}

// --- persistence -----------------------------------------------------------

/**
 * The chosen language, mirrored outside the profile.
 *
 * The profile is the source of truth, but it is behind auth and a round trip:
 * the sign-in screen has no profile to read, and after a reload the first
 * paint happens before the query resolves. Without this the app would open in
 * English for every Russian and Uzbek reader and then swap, which reads as a
 * bug. Same shape as the theme's `qs.theme`, and for the same reason.
 */
const STORAGE_KEY = "qs.language";

export function readStoredLanguage(): Language | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    /* storage unavailable — the profile still carries the choice */
  }
}

/**
 * The best guess before anything has been chosen.
 *
 * Only consulted when neither the profile nor storage has an answer, i.e. on
 * a brand-new install. A browser reporting `ru-RU` almost certainly wants the
 * Russian app, and guessing wrong costs one visit to Settings.
 */
export function detectLanguage(): Language {
  try {
    for (const tag of navigator.languages ?? [navigator.language]) {
      const base = tag.toLowerCase().split("-")[0];
      if (isLanguage(base)) return base;
    }
  } catch {
    /* no navigator (tests, SSR) */
  }
  return DEFAULT_LANGUAGE;
}
