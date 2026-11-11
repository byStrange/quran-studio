import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { local, offlineFirst } from "@/lib/offline/packs";
import { CONTENT_QUERY } from "@/hooks/useQuranData";
import { useProfile, useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage } from "@/providers/I18nProvider";
import { selectedVerseTranslations, wordGloss } from "@/lib/language";
import { splitVerseWords } from "@/lib/interlinear";
import { sliceTajweedSpans } from "@/lib/tajweed";
import type { Language } from "@/lib/i18n";
import type { UiPrefs, VerseWithWords } from "@/lib/types";
import { planStops, type JourneyVerse, type Stars, type Stop } from "@/lib/journey/plan";
import {
  EMPTY_JOURNEY,
  mergeJourney,
  parseJourney,
  sameJourney,
  withStopFinished,
  withSurahDone,
  type GlossLanguage,
  type JourneyState,
} from "@/lib/journey/progress";

// --- content ---------------------------------------------------------------

const PAGE = 100;

/**
 * Every ayah of a surah, with its words.
 *
 * The continuous reader pages a surah in as it scrolls; Journey needs the
 * whole thing at once, because where the stops fall depends on every ayah's
 * length. For the surahs Journey is mostly used on this is a few kilobytes.
 * Al-Baqarah is a few megabytes, fetched once and kept for the session.
 */
function useSurahVersesAll(surahNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["journey-surah", surahNumber],
    enabled: surahNumber !== null,
    queryFn: async (): Promise<VerseWithWords[]> =>
      offlineFirst(
        () => local.surahVerses(surahNumber!, null, Number.MAX_SAFE_INTEGER),
        async () => {
          const all: VerseWithWords[] = [];
          let after = 0;
          for (;;) {
            const { data, error } = await supabase
              .from("quran_verses")
              .select("*, words:quran_words(*)")
              .eq("surah_number", surahNumber!)
              .gt("ayah_number", after)
              .order("ayah_number")
              .limit(PAGE);
            if (error) throw error;
            const page = (data ?? []).map((verse) => ({
              ...verse,
              words: [...(verse.words ?? [])].sort((a, b) => a.position - b.position),
            })) as VerseWithWords[];
            all.push(...page);
            if (page.length < PAGE) break;
            after = page[page.length - 1]!.ayah_number;
          }
          return all;
        },
      ),
  });
}

/**
 * The language word meanings are shown in.
 *
 * English and Russian have a word-by-word corpus and use it. Uzbek does not
 * (its glosses are phrase-level and still being contributed), so an Uzbek
 * reader chooses which of the two they would rather read, on the Journey map.
 * Until they choose it is English, which is what the rest of the app falls
 * back to as well.
 */
export function resolveGlossLanguage(
  language: Language,
  chosen: GlossLanguage | undefined,
): GlossLanguage {
  if (language === "en" || language === "ru") return language;
  return chosen ?? "en";
}

/** Whether this interface language has to borrow another language's glosses. */
export function needsGlossChoice(language: Language): boolean {
  return language !== "en" && language !== "ru";
}

function toJourneyVerse(
  verse: VerseWithWords,
  language: Language,
  glossLanguage: GlossLanguage,
  translations: string[] | undefined,
): JourneyVerse {
  const translation = selectedVerseTranslations(verse, translations, language)[0]!;
  // Null when the verse does not divide into the word list's words; those
  // words are drawn in the word list's spelling, uncoloured, rather than
  // colouring the wrong letters.
  const ranges = splitVerseWords(verse.arabic_text, verse.words.length);
  return {
    id: verse.id,
    surah: verse.surah_number,
    ayah: verse.ayah_number,
    ruku: verse.ruku_number,
    arabic: verse.arabic_text,
    tajweed: verse.tajweed,
    translation: translation.text,
    translationTag: translation.tag,
    words: verse.words.map((word, index) => ({
      id: word.id,
      position: word.position,
      arabic: word.arabic,
      text: ranges ? verse.arabic_text.slice(ranges[index]!.start, ranges[index]!.end) : word.arabic,
      tajweed: ranges
        ? sliceTajweedSpans(verse.tajweed, ranges[index]!.start, ranges[index]!.end)
        : null,
      transliteration: word.transliteration,
      meaning: wordGloss(word, glossLanguage)?.trim() || null,
    })),
  };
}

export interface JourneySurah {
  verses: JourneyVerse[];
  stops: Stop[];
}

/** A surah as Journey plays it: its ayahs in the reader's language, cut into stops. */
export function useJourneySurah(surahNumber: number | null) {
  const query = useSurahVersesAll(surahNumber);
  const language = useLanguage();
  const prefs = useUiPrefs();
  const { state } = useJourneyProgress();
  const glossLanguage = resolveGlossLanguage(language, state.glossLanguage);
  const translationsKey = prefs.translations.join(",");

  const data = useMemo((): JourneySurah | undefined => {
    if (!query.data) return undefined;
    const verses = query.data.map((verse) =>
      toJourneyVerse(verse, language, glossLanguage, prefs.translations),
    );
    return { verses, stops: planStops(verses) };
    // `translationsKey` stands in for the array, which is a new one each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, language, glossLanguage, translationsKey]);

  return { data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}

// --- progress --------------------------------------------------------------

const STORAGE_PREFIX = "quran-studio:journey:";

/**
 * The localStorage copy, as an external store.
 *
 * A store rather than component state because several components read the
 * record at once (the map, a lesson, the surah page behind it) and a stop
 * finished in one has to show in the others without a reload.
 */
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; state: JourneyState }>();

function readLocal(key: string): JourneyState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Storage can be unavailable (a locked-down webview); the profile copy
    // still works, so this degrades to "nothing saved on this device".
  }
  const cached = cache.get(key);
  // The same object for the same stored text: `useSyncExternalStore` compares
  // snapshots by identity and would loop on a freshly parsed one every time.
  if (cached && cached.raw === raw) return cached.state;
  let state = EMPTY_JOURNEY;
  if (raw) {
    try {
      state = parseJourney(JSON.parse(raw));
    } catch {
      state = EMPTY_JOURNEY;
    }
  }
  cache.set(key, { raw, state });
  return state;
}

function writeLocal(key: string, state: JourneyState) {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // See `readLocal`.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface JourneyProgress {
  state: JourneyState;
  /** Records a finished stop. `surahComplete` also marks the surah done. */
  finishStop: (key: string, stars: Stars, surahComplete: number | null) => void;
  setGlossLanguage: (language: GlossLanguage) => void;
}

export function useJourneyProgress(): JourneyProgress {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { mutate } = useUpdateProfile();
  const key = STORAGE_PREFIX + (user?.id ?? "guest");

  const stored = useSyncExternalStore(subscribe, () => readLocal(key));
  const remote = useMemo(
    () => parseJourney((profile?.ui_prefs as Partial<UiPrefs> | null)?.journey),
    [profile?.ui_prefs],
  );
  // The profile's copy is preferred where the two differ on a *choice*; what
  // was earned is kept from both.
  const state = useMemo(() => mergeJourney(remote, stored), [remote, stored]);

  // Bring each copy up to the merged record. The profile is only written once
  // it has loaded — before that `remote` is empty because it is unknown, not
  // because there is nothing there.
  const pushed = useRef<string | null>(null);
  useEffect(() => {
    if (!sameJourney(state, stored)) writeLocal(key, state);
    if (!user || !profile || sameJourney(state, remote)) return;
    const fingerprint = JSON.stringify(state);
    // One attempt per distinct record: if the write fails (offline), retrying
    // on every render would spin; the next change, or the next launch, tries
    // again.
    if (pushed.current === fingerprint) return;
    pushed.current = fingerprint;
    mutate({ ui_prefs: { journey: state } });
  }, [state, stored, remote, key, user, profile, mutate]);

  const commit = useCallback(
    (next: JourneyState) => {
      writeLocal(key, next);
      if (user && profile) {
        pushed.current = JSON.stringify(next);
        mutate({ ui_prefs: { journey: next } });
      }
    },
    [key, user, profile, mutate],
  );

  const stateRef = useRef(state);
  stateRef.current = state;

  const finishStop = useCallback(
    (stopKey: string, stars: Stars, surahComplete: number | null) => {
      let next = withStopFinished(stateRef.current, stopKey, stars, new Date());
      if (surahComplete !== null) next = withSurahDone(next, surahComplete);
      commit(next);
    },
    [commit],
  );

  const setGlossLanguage = useCallback(
    (glossLanguage: GlossLanguage) => commit({ ...stateRef.current, glossLanguage }),
    [commit],
  );

  return { state, finishStop, setGlossLanguage };
}
