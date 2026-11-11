import { queryOptions, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  fetchCachedJourneyLesson,
  fetchCachedTafsirSummary,
  generateJourneyLesson,
  isTauri,
  type JourneyLessonBody,
  type TafsirSummaryBody,
} from "@/lib/ai";
import { editionMatchesLanguage } from "@/lib/language";
import type { Language } from "@/lib/i18n";
import { QUIZ_TAFSIR } from "@/lib/knowledgeQuiz";
import { useTafsirEditions, useSurahs } from "@/hooks/useQuranData";
import { useUiPrefs } from "@/hooks/useProfile";
import { useLanguage } from "@/providers/I18nProvider";
import type { Stop } from "@/lib/journey/plan";

/**
 * What a stop's ayahs teach, as a lesson can present it.
 *
 * Nothing here is invented for the app. The source is the tafsir the reader
 * already has; the AI's part is to say what it says about these ayahs in a
 * child's words, and the backend's part is to throw away anything it cannot
 * find in the tafsir's own text.
 *
 * There are two forms of that, and a lesson takes the best one available:
 *
 *  1. A Journey lesson — written for a child, about exactly this stop's
 *     ayahs, with real multiple-choice questions. Cached for every reader in
 *     `journey_ai_lesson`; written on demand where the AI is available.
 *  2. The study reader's tafsir summaries — written for an adult, per tafsir
 *     entry. Used only when (1) cannot be had: a device without the AI and a
 *     stop nobody has prepared, or a database the lesson cache has not been
 *     migrated into yet. Better than nothing, and it is already there.
 */
export interface JourneyInsight {
  /** The tafsir this came from, as the reader knows it. */
  tafsirName: string;
  /** Written for a child (form 1), rather than borrowed from the reader. */
  forChildren: boolean;
  gists: string[];
  points: string[];
  questions: Array<{
    question: string;
    answer: string;
    /** The choices to offer, `answer` among them; absent in the borrowed form. */
    options?: string[];
    /** Shown once answered: why that is the answer. */
    why?: string;
  }>;
}

export interface JourneyTafsir {
  edition: string;
  name: string;
}

/** How many tafsir entries a lesson reads. A per-ayah edition has one per ayah. */
const MAX_ENTRIES = 6;
/** The borrowed form shows fewer: each entry's summary is a lesson in itself. */
const MAX_BORROWED_ENTRIES = 2;
const MAX_POINTS = 4;
const MAX_QUESTIONS = 3;

/** Which tafsir a Journey lesson draws on, for this reader. */
export function useJourneyTafsir(): JourneyTafsir | null {
  const language = useLanguage();
  const prefs = useUiPrefs();
  const { data: editions } = useTafsirEditions();
  if (!editions) return null;
  // The edition the reader has chosen for the tafsir panel, when it is in the
  // language they read — otherwise that language's Ibn Kathir, the same
  // default the tafsir quiz uses.
  const chosen = editions.find(
    (edition) => edition.slug === prefs.tafsirEdition && editionMatchesLanguage(edition, language),
  );
  if (chosen) return { edition: chosen.slug, name: chosen.name };
  const fallback = QUIZ_TAFSIR[language];
  return editions.some((edition) => edition.slug === fallback.edition) ? fallback : null;
}

function fromLesson(lesson: JourneyLessonBody, tafsirName: string): JourneyInsight | null {
  const gist = lesson.gist?.trim();
  const points = (lesson.points ?? []).map((p) => p.point?.trim()).filter((p): p is string => !!p);
  if (!gist || points.length === 0) return null;
  return {
    tafsirName,
    forChildren: true,
    gists: [gist],
    points: points.slice(0, MAX_POINTS),
    questions: (lesson.questions ?? [])
      // The backend has validated these; checked again because the row is
      // JSON that any version of the app may have written.
      .filter(
        (q) =>
          q.question?.trim() &&
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          Number.isInteger(q.answer) &&
          q.options[q.answer]?.trim(),
      )
      .slice(0, MAX_QUESTIONS)
      .map((q) => ({
        question: q.question.trim(),
        answer: q.options[q.answer]!.trim(),
        options: q.options.map((option) => option.trim()),
        why: q.why?.trim() || undefined,
      })),
  };
}

function inStop(ayah: number | null, stop: Stop): boolean {
  return ayah === null || (ayah >= stop.ayahStart && ayah <= stop.ayahEnd);
}

function fromSummaries(
  bodies: TafsirSummaryBody[],
  stop: Stop,
  tafsirName: string,
): JourneyInsight | null {
  const gists = bodies.map((body) => body.gist?.trim()).filter((gist): gist is string => !!gist);
  // An entry can cover more ayahs than the stop does; a point tied to an ayah
  // outside the stop belongs to another lesson.
  const points = bodies
    .flatMap((body) => body.key_points ?? [])
    .filter((point) => point.point?.trim() && inStop(point.ayah, stop))
    .map((point) => point.point.trim())
    .slice(0, MAX_POINTS);
  const questions = bodies
    .flatMap((body) => body.recall ?? [])
    .filter((item) => item.question?.trim() && item.answer?.trim())
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .slice(0, MAX_QUESTIONS);
  if (gists.length === 0 && points.length === 0) return null;
  return { tafsirName, forChildren: false, gists, points, questions };
}

interface InsightRequest {
  stop: Stop;
  tafsir: JourneyTafsir;
  surahName: string;
  language: Language;
}

async function loadJourneyInsight({
  stop,
  tafsir,
  surahName,
  language,
}: InsightRequest): Promise<JourneyInsight | null> {
  const key = {
    edition: tafsir.edition,
    surahNumber: stop.surah,
    ayahStart: stop.ayahStart,
    ayahEnd: stop.ayahEnd,
  };

  const cached = await fetchCachedJourneyLesson(key, language);
  const fromCache = cached ? fromLesson(cached, tafsir.name) : null;
  if (fromCache) return fromCache;

  // Every tafsir entry whose range touches the stop's.
  const { data: entries, error } = await supabase
    .from("tafsir")
    .select("ayah_start, ayah_end, content")
    .eq("edition", tafsir.edition)
    .eq("surah_number", stop.surah)
    .lte("ayah_start", stop.ayahEnd)
    .gte("ayah_end", stop.ayahStart)
    .order("ayah_start")
    .limit(MAX_ENTRIES);
  if (error) throw error;
  const usable = (entries ?? []).filter((entry) => entry.content.trim());
  if (usable.length === 0) return null;

  if (isTauri()) {
    try {
      const lesson = await generateJourneyLesson(
        {
          ...key,
          tafsirName: tafsir.name,
          surahName,
          ayahs: stop.verses.map((verse) => `${verse.ayah}. ${verse.translation}`).join("\n"),
          content: usable.map((entry) => entry.content.trim()).join("\n\n"),
        },
        language,
      );
      const generated = fromLesson(lesson, tafsir.name);
      if (generated) return generated;
    } catch {
      // No key, the model busy, or a reply with nothing in it that could be
      // found in the tafsir. The borrowed form may still exist.
    }
  }

  const bodies: TafsirSummaryBody[] = [];
  for (const entry of usable.slice(0, MAX_BORROWED_ENTRIES)) {
    // Read-only: a summary is borrowed if someone has made one, never made
    // here — this path is the fallback, and generating the wrong kind of text
    // as well would be paying twice for the lesser result.
    const summary = await fetchCachedTafsirSummary(
      { edition: tafsir.edition, surahNumber: stop.surah, ayahStart: entry.ayah_start },
      language,
    ).catch(() => null);
    if (summary) bodies.push(summary.summary);
  }
  return bodies.length > 0 ? fromSummaries(bodies, stop, tafsir.name) : null;
}

/**
 * The query for one stop's insight. Shared by the lesson (which shows it) and
 * the surah page (which prepares a whole surah's ahead of time), so a lesson
 * written by one is found by the other rather than written twice.
 */
export function journeyInsightQuery(request: InsightRequest) {
  return queryOptions({
    queryKey: [
      "journey-insight",
      request.tafsir.edition,
      request.language,
      request.stop.surah,
      request.stop.ayahStart,
      request.stop.ayahEnd,
    ],
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    // One attempt: a failure here is "no AI on this device" or "the model is
    // busy", and the lesson simply goes on without the scene.
    retry: false,
    meta: { persist: false },
    queryFn: () => loadJourneyInsight(request),
  });
}

export function useJourneyInsight(stop: Stop) {
  const language = useLanguage();
  const tafsir = useJourneyTafsir();
  const { data: surahs } = useSurahs();
  const surahName = surahs?.find((s) => s.number === stop.surah)?.name_english;
  const ready = tafsir !== null && surahName !== undefined;

  return useQuery({
    ...journeyInsightQuery({
      stop,
      // Placeholders while disabled; the query does not run until both exist.
      tafsir: tafsir ?? { edition: "", name: "" },
      surahName: surahName ?? "",
      language,
    }),
    enabled: ready,
  });
}
