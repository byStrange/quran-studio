import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getTafsirSummary, type TafsirSummaryBody } from "@/lib/ai";
import { editionMatchesLanguage } from "@/lib/language";
import { QUIZ_TAFSIR } from "@/lib/knowledgeQuiz";
import { useTafsirEditions, useSurahs } from "@/hooks/useQuranData";
import { useUiPrefs } from "@/hooks/useProfile";
import { useLanguage } from "@/providers/I18nProvider";
import type { Stop } from "@/lib/journey/plan";

/**
 * What a stop's ayahs teach, as a lesson can present it.
 *
 * Nothing here is written by this app or invented for it. The source is the
 * tafsir the reader already has; the AI's part is to condense each tafsir
 * entry into a gist, a few points and a few questions, which is the same
 * summary the study reader shows beside the tafsir — generated once, checked
 * by the backend against the entry's own text, and cached for every reader.
 * Journey only chooses which of those to show and turns the questions into
 * something to tap.
 */
export interface JourneyInsight {
  /** The tafsir this came from, as the reader knows it. */
  tafsirName: string;
  /** One or two sentences per tafsir entry the stop touches. */
  gists: string[];
  points: string[];
  questions: Array<{ question: string; answer: string }>;
}

/** A stop usually sits inside one tafsir entry; a second covers a boundary. */
const MAX_ENTRIES = 2;
const MAX_POINTS = 4;
const MAX_QUESTIONS = 3;

/** Which tafsir a Journey lesson draws on, for this reader. */
export function useJourneyTafsir(): { edition: string; name: string } | null {
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

function inStop(ayah: number | null, stop: Stop): boolean {
  return ayah === null || (ayah >= stop.ayahStart && ayah <= stop.ayahEnd);
}

export function useJourneyInsight(stop: Stop) {
  const language = useLanguage();
  const tafsir = useJourneyTafsir();
  const { data: surahs } = useSurahs();
  const surahName = surahs?.find((s) => s.number === stop.surah)?.name_english;

  return useQuery({
    queryKey: [
      "journey-insight",
      tafsir?.edition,
      language,
      stop.surah,
      stop.ayahStart,
      stop.ayahEnd,
    ],
    enabled: tafsir !== null && surahName !== undefined,
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    // One attempt: a failure here is "no AI on this device" or "the model is
    // busy", and the lesson simply goes on without the scene.
    retry: false,
    meta: { persist: false },
    queryFn: async (): Promise<JourneyInsight | null> => {
      // Every entry whose range touches the stop's.
      const { data: entries, error } = await supabase
        .from("tafsir")
        .select("ayah_start, ayah_end, content")
        .eq("edition", tafsir!.edition)
        .eq("surah_number", stop.surah)
        .lte("ayah_start", stop.ayahEnd)
        .gte("ayah_end", stop.ayahStart)
        .order("ayah_start")
        .limit(MAX_ENTRIES);
      if (error) throw error;

      const bodies: TafsirSummaryBody[] = [];
      for (const entry of entries ?? []) {
        if (!entry.content.trim()) continue;
        try {
          // Cached for everyone once any reader has generated it; generated
          // here only where the AI is available (the desktop and phone apps
          // with a key set). Elsewhere this throws and the entry is skipped.
          const { summary } = await getTafsirSummary(
            {
              edition: tafsir!.edition,
              surahNumber: stop.surah,
              ayahStart: entry.ayah_start,
              ayahEnd: entry.ayah_end,
              tafsirName: tafsir!.name,
              surahName: surahName!,
              content: entry.content,
            },
            language,
          );
          bodies.push(summary);
        } catch {
          // No summary for this entry; another may still have one.
        }
      }
      if (bodies.length === 0) return null;

      const gists = bodies.map((body) => body.gist?.trim()).filter((gist): gist is string => !!gist);
      // An entry can cover more ayahs than the stop does; a point tied to an
      // ayah outside the stop belongs to another lesson.
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
      return { tafsirName: tafsir!.name, gists, points, questions };
    },
  });
}
