/**
 * The app's language, resolved and made available everywhere.
 *
 * Resolution order is profile → localStorage → browser → English. The profile
 * is the source of truth, but it is behind auth and a round trip: the sign-in
 * screen has no profile at all, and after a reload the first paint happens
 * before the query resolves. The mirror in localStorage is what keeps the app
 * from opening in English and then swapping, which reads as a bug rather than
 * as a preference being applied.
 *
 * Nothing here writes the preference: Settings changes it the same way it
 * changes every other preference, through `useUpdateProfile`, whose optimistic
 * update means the new language is in the profile before the request lands.
 * This provider only follows that value and mirrors it outward.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LANGUAGE,
  detectLanguage,
  languageInfo,
  readStoredLanguage,
  resolveEntry,
  writeStoredLanguage,
  type Language,
  type TranslationParams,
} from "@/lib/i18n";
import { en, type Dictionary, type TranslationKey } from "@/locales/en";
import { ru } from "@/locales/ru";
import { uz } from "@/locales/uz";
import { useProfileLanguage } from "@/hooks/useProfile";
import type { DurationUnits } from "@/lib/utils";

const DICTIONARIES: Record<Language, Dictionary> = { en, ru, uz };

export type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

interface I18nContextValue {
  language: Language;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  /** Null until the profile has loaded, or when it holds no language yet. */
  const stored = useProfileLanguage();
  // Read once, at mount: this is the pre-auth and pre-fetch answer, and it is
  // only ever superseded by the profile, never re-read.
  const [fallback] = useState<Language>(() => readStoredLanguage() ?? detectLanguage());
  const language = stored ?? fallback;

  useEffect(() => {
    writeStoredLanguage(language);
    // Drives font selection, hyphenation and the accessibility tree. The
    // Arabic and the tafsir carry their own `lang` where they differ.
    document.documentElement.lang = languageInfo(language).tag;
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const dictionary = DICTIONARIES[language] ?? DICTIONARIES[DEFAULT_LANGUAGE];
    return {
      language,
      t: (key, params) => resolveEntry(dictionary[key], language, params),
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}

/** The translator. `t("nav.read")`, `t("focus.ayah", { number: 3 })`. */
export function useT(): TFunction {
  return useI18n().t;
}

/**
 * The compact duration suffixes, for `formatDuration`.
 *
 * Split out rather than folded into `formatDuration` because that function is
 * also called from scripts, where there is no React context to read.
 */
export function useDurationUnits(): DurationUnits {
  const { t } = useI18n();
  return useMemo(
    () => ({ hour: t("unit.hour"), minute: t("unit.minute"), second: t("unit.second") }),
    [t],
  );
}

/**
 * The active language.
 *
 * The same value the interface is drawn in and the scripture is read in —
 * they are one setting. Content accessors in `lib/language.ts` take this.
 */
export function useLanguage(): Language {
  return useI18n().language;
}
