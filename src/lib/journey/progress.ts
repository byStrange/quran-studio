/**
 * Journey — what is remembered about a reader's progress.
 *
 * Kept in `profiles.ui_prefs.journey` rather than in tables of its own. The
 * whole record is a few kilobytes even for someone who has finished every
 * surah, it is only ever read whole, and living in the profile means the
 * feature needs no migration and follows the account to every device the way
 * the other preferences already do. If Journey ever grows something that has
 * to be queried across readers (an older brother watching the younger ones'
 * progress, say) that is the point to give it real tables.
 *
 * A copy is also kept in localStorage, and the two are merged rather than one
 * trusted over the other: a stop finished on a phone with no signal must not
 * be lost because the profile write failed, and must not erase a stop finished
 * on the desktop in the meantime. Merging takes the better result per stop, so
 * it is safe to run in any order, any number of times.
 */
import type { Stars } from "./plan";

/** The languages a word-by-word corpus exists in. */
export type GlossLanguage = "en" | "ru";

// `type` rather than `interface` for the two stored shapes: only a type alias
// is assignable to the generated `Json` column type, which is what lets the
// record be written into `ui_prefs` without a cast.
export type StopRecord = {
  /** Best result so far. */
  stars: Stars;
  /** How many times the stop has been finished. */
  times: number;
  /** ISO date-time of the latest finish. */
  at: string;
};

export type JourneyState = {
  v: 1;
  /** By `stopKey` — "surah:firstAyah". */
  stops: Record<string, StopRecord>;
  /** Surahs with every stop finished at least once. */
  surahsDone: number[];
  /**
   * Which language word meanings are shown in, for a reader whose interface
   * language has no word-by-word corpus (Uzbek, today). Unset means "not
   * chosen yet".
   */
  glossLanguage?: GlossLanguage;
};

export const EMPTY_JOURNEY: JourneyState = { v: 1, stops: {}, surahsDone: [] };

function isStars(value: unknown): value is Stars {
  return value === 1 || value === 2 || value === 3;
}

/**
 * Reads a stored value defensively.
 *
 * `ui_prefs` is free-form JSON and localStorage is whatever was last written
 * by any version of the app, so nothing here is trusted to have the right
 * shape — a malformed entry is dropped rather than allowed to crash the map.
 */
export function parseJourney(raw: unknown): JourneyState {
  if (!raw || typeof raw !== "object") return EMPTY_JOURNEY;
  const input = raw as Record<string, unknown>;
  const stops: Record<string, StopRecord> = {};
  if (input.stops && typeof input.stops === "object") {
    for (const [key, value] of Object.entries(input.stops as Record<string, unknown>)) {
      if (!/^\d+:\d+$/.test(key) || !value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (!isStars(record.stars)) continue;
      stops[key] = {
        stars: record.stars,
        times: typeof record.times === "number" && record.times > 0 ? Math.floor(record.times) : 1,
        at: typeof record.at === "string" ? record.at : "",
      };
    }
  }
  const surahsDone = Array.isArray(input.surahsDone)
    ? [...new Set(input.surahsDone.filter((n): n is number => Number.isInteger(n)))].sort(
        (a, b) => a - b,
      )
    : [];
  const glossLanguage =
    input.glossLanguage === "en" || input.glossLanguage === "ru" ? input.glossLanguage : undefined;
  return { v: 1, stops, surahsDone, ...(glossLanguage ? { glossLanguage } : {}) };
}

/**
 * Combines two copies of the record. `preferred` wins only where there is a
 * real choice to respect (the gloss language); everything earned is kept from
 * whichever copy has more of it.
 */
export function mergeJourney(preferred: JourneyState, other: JourneyState): JourneyState {
  const stops: Record<string, StopRecord> = { ...other.stops };
  for (const [key, mine] of Object.entries(preferred.stops)) {
    const theirs = stops[key];
    if (!theirs) {
      stops[key] = mine;
      continue;
    }
    stops[key] = {
      stars: mine.stars >= theirs.stars ? mine.stars : theirs.stars,
      times: Math.max(mine.times, theirs.times),
      at: mine.at >= theirs.at ? mine.at : theirs.at,
    };
  }
  const surahsDone = [...new Set([...preferred.surahsDone, ...other.surahsDone])].sort(
    (a, b) => a - b,
  );
  const glossLanguage = preferred.glossLanguage ?? other.glossLanguage;
  return { v: 1, stops, surahsDone, ...(glossLanguage ? { glossLanguage } : {}) };
}

export function sameJourney(a: JourneyState, b: JourneyState): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(state: JourneyState) {
  return {
    stops: Object.keys(state.stops)
      .sort()
      .map((key) => [key, state.stops[key]!.stars, state.stops[key]!.times, state.stops[key]!.at]),
    surahsDone: [...state.surahsDone].sort((a, b) => a - b),
    glossLanguage: state.glossLanguage ?? null,
  };
}

/** The record after finishing a stop. Never lowers a result already earned. */
export function withStopFinished(
  state: JourneyState,
  key: string,
  stars: Stars,
  now: Date,
): JourneyState {
  const previous = state.stops[key];
  return {
    ...state,
    stops: {
      ...state.stops,
      [key]: {
        stars: previous && previous.stars > stars ? previous.stars : stars,
        times: (previous?.times ?? 0) + 1,
        at: now.toISOString(),
      },
    },
  };
}

export function withSurahDone(state: JourneyState, surah: number): JourneyState {
  if (state.surahsDone.includes(surah)) return state;
  return { ...state, surahsDone: [...state.surahsDone, surah].sort((a, b) => a - b) };
}

// --- totals ----------------------------------------------------------------

export interface SurahTally {
  /** Stops of this surah finished at least once. */
  stops: number;
  stars: number;
}

export function tallyBySurah(state: JourneyState): Map<number, SurahTally> {
  const out = new Map<number, SurahTally>();
  for (const [key, record] of Object.entries(state.stops)) {
    const surah = Number(key.split(":")[0]);
    const tally = out.get(surah) ?? { stops: 0, stars: 0 };
    tally.stops += 1;
    tally.stars += record.stars;
    out.set(surah, tally);
  }
  return out;
}

export function totalStars(state: JourneyState): number {
  return Object.values(state.stops).reduce((sum, record) => sum + record.stars, 0);
}

// --- the path --------------------------------------------------------------

/**
 * The order the map suggests surahs in.
 *
 * Al-Fatiha first, because it is recited in every prayer; then from An-Nas
 * backwards, which is the order children are taught to memorise in and so the
 * order the surahs they already recite will be found in. Nothing is locked —
 * the path is a suggestion, and a reader can open any surah they know.
 */
export const JOURNEY_PATH: readonly number[] = [
  1,
  ...Array.from({ length: 113 }, (_, i) => 114 - i),
];

/** The first surah on the path that is not finished. */
export function nextSurah(state: JourneyState): number {
  const done = new Set(state.surahsDone);
  return JOURNEY_PATH.find((surah) => !done.has(surah)) ?? JOURNEY_PATH[0]!;
}
