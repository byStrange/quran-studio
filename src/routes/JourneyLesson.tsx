/**
 * One stop of the Journey, played scene by scene.
 *
 * The lesson is the only thing that knows there is a sequence: it asks the
 * planner what this stop's scenes are, shows them one at a time, adds up the
 * wrong answers they report, and when the last one is done turns that into
 * stars and writes it down. A scene never sees the one before or after it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { X } from "lucide-react";
import { useJourneyProgress, useJourneySurah, type JourneySurah } from "@/hooks/useJourney";
import { useJourneyAudio } from "@/hooks/useJourneyAudio";
import { useUiPrefs } from "@/hooks/useProfile";
import { useSetWordsStatus, useWordProgress } from "@/hooks/useProgress";
import { useSurahs } from "@/hooks/useQuranData";
import { useReadingTimer } from "@/hooks/useReadingTimer";
import { useAuth } from "@/providers/AuthProvider";
import { useT } from "@/providers/I18nProvider";
import { ayahRangeLabel } from "@/lib/utils";
import {
  indexVerses,
  planLesson,
  seededRng,
  starsFor,
  stopKey,
  teachableWords,
  type Scene,
  type Stars,
  type Stop,
} from "@/lib/journey/plan";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import type { SceneProps } from "@/components/journey/kit";
import { ListenScene } from "@/components/journey/ListenScene";
import { MeetScene } from "@/components/journey/MeetScene";
import { MatchScene } from "@/components/journey/MatchScene";
import { HearScene } from "@/components/journey/HearScene";
import { BuildScene } from "@/components/journey/BuildScene";
import { WhichScene } from "@/components/journey/WhichScene";
import { OrderScene } from "@/components/journey/OrderScene";
import { ReciteScene } from "@/components/journey/ReciteScene";
import { RewardScreen } from "@/components/journey/RewardScreen";

/**
 * How long a lesson waits to learn whether there is a recording before it
 * starts without one. Long enough for a slow connection, short enough that an
 * offline reader is not left looking at a spinner.
 */
const AUDIO_WAIT_MS = 4000;

export function JourneyLesson() {
  const t = useT();
  const params = useParams();
  const surahNumber = Number(params.surahNumber);
  const ayahStart = Number(params.ayahStart);
  const valid = Number.isInteger(surahNumber) && surahNumber >= 1 && surahNumber <= 114;
  const { data, isLoading, error, refetch } = useJourneySurah(valid ? surahNumber : null);
  // A replay is a fresh lesson: new shuffles, a clean score.
  const [attempt, setAttempt] = useState(0);

  if (!valid) return <NotFound />;
  if (isLoading || (!data && !error)) {
    return (
      <div className="journey-stage grid h-full place-items-center">
        <LoadingBlock label={t("common.loading")} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="journey-stage grid h-full place-items-center p-6">
        <ErrorState message={t("common.somethingWrong")} onRetry={() => void refetch()} />
      </div>
    );
  }
  const stop = data.stops.find((candidate) => candidate.ayahStart === ayahStart);
  if (!stop) return <NotFound />;

  return (
    <LessonPlayer
      // Remounted per stop and per attempt, so no scene state, score or
      // half-played clip can leak from one into the next.
      key={`${stopKey(stop)}:${attempt}`}
      surah={data}
      stop={stop}
      onReplay={() => setAttempt((n) => n + 1)}
    />
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="journey-stage grid h-full place-items-center p-6">
      <EmptyState
        title={t("journey.lesson.notFound")}
        action={
          <Button asChild variant="primary">
            <Link to="/journey">{t("journey.reward.backToMap")}</Link>
          </Button>
        }
      />
    </div>
  );
}

function LessonPlayer({
  surah,
  stop,
  onReplay,
}: {
  surah: JourneySurah;
  stop: Stop;
  onReplay: () => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const prefs = useUiPrefs();
  const { data: surahs } = useSurahs();
  const { state, finishStop } = useJourneyProgress();
  // Time in a lesson is time with the Quran: it counts toward the day's
  // reading and so toward the streak, the same as the reader does.
  useReadingTimer(stop.verses[0]?.ruku ?? null);

  const verseIds = useMemo(() => stop.verses.map((verse) => verse.id), [stop]);
  const audio = useJourneyAudio(stop.surah, verseIds);
  const index = useMemo(() => indexVerses(surah.verses), [surah.verses]);

  // Drawn once per mount: the plan must not reshuffle on a re-render.
  const [seed] = useState(() => Math.floor(Math.random() * 0x7fffffff));
  const scenes = useMemo(
    () => planLesson(stop, surah.verses, seededRng(seed)),
    [stop, surah.verses, seed],
  );

  const [step, setStep] = useState(0);
  const mistakes = useRef(0);
  const [result, setResult] = useState<{ stars: Stars; newWords: number; surahDone: boolean } | null>(
    null,
  );

  // --- the words this stop adds to the vocabulary deck ---------------------

  const taughtWordIds = useMemo(() => teachableWords(stop).map((ref) => ref.wordId), [stop]);
  const { data: wordProgress } = useWordProgress(taughtWordIds);
  const setWordsStatus = useSetWordsStatus();

  const finish = useCallback(() => {
    const stars = starsFor(mistakes.current);
    const key = stopKey(stop);
    const alreadyDone = state.surahsDone.includes(stop.surah);
    const surahComplete = surah.stops.every(
      (other) => stopKey(other) === key || state.stops[stopKey(other)] !== undefined,
    );
    finishStop(key, stars, surahComplete ? stop.surah : null);

    // Words met here join the spaced-repetition deck as "learning", so the
    // vocabulary quiz brings them back on later days. Only words with no
    // history: one already being reviewed, or already learned, keeps the
    // schedule its reviews have earned. Skipped until that history has
    // loaded, since without it every word would look new.
    let newWords = 0;
    if (user && wordProgress) {
      const fresh = taughtWordIds.filter((id) => !wordProgress.has(id));
      newWords = fresh.length;
      if (fresh.length > 0) setWordsStatus.mutate({ wordIds: fresh, status: "learning" });
    }
    setResult({ stars, newWords, surahDone: surahComplete && !alreadyDone });
  }, [stop, surah.stops, state, finishStop, user, wordProgress, taughtWordIds, setWordsStatus]);

  const onSceneDone = useCallback(
    (sceneMistakes: number) => {
      mistakes.current += Math.max(0, sceneMistakes);
      if (step + 1 >= scenes.length) finish();
      setStep(step + 1);
    },
    [step, scenes.length, finish],
  );

  // --- waiting for the reciter ----------------------------------------------

  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), AUDIO_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const started = audio.ready || waited;

  const surahInfo = surahs?.find((s) => s.number === stop.surah);
  const surahName = surahInfo?.name_english ?? String(stop.surah);
  const next = surah.stops[stop.index + 1];
  const scene = scenes[step];

  return (
    <div className="journey-stage flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3 px-3 pb-1 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-6">
        <Link
          to={`/journey/${stop.surah}`}
          aria-label={t("journey.lesson.exit")}
          className="grid size-11 shrink-0 place-items-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <X className="size-5" aria-hidden />
        </Link>
        {/* One segment per scene: a child can see how much is left, which a
            smooth bar does not say. */}
        <div
          className="flex flex-1 gap-1.5"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={scenes.length}
          aria-valuenow={Math.min(step, scenes.length)}
          aria-label={t("journey.lesson.progress", {
            current: Math.min(step + 1, scenes.length),
            total: scenes.length,
          })}
        >
          {scenes.map((_, i) => (
            <span
              key={i}
              className={
                "h-2.5 flex-1 rounded-full transition-colors duration-500 " +
                (i < step ? "bg-accent" : i === step ? "bg-accent/45" : "bg-surface-3")
              }
            />
          ))}
        </div>
        <span className="shrink-0 pr-2 text-[0.8125rem] font-medium tabular-nums text-fg-subtle">
          {surahName} {ayahRangeLabel(stop.ayahStart, stop.ayahEnd)}
        </span>
      </header>

      {result ? (
        <RewardScreen
          stars={result.stars}
          passage={t("journey.reward.passage", {
            surah: surahName,
            range: ayahRangeLabel(stop.ayahStart, stop.ayahEnd),
          })}
          surahName={surahName}
          surahNumber={stop.surah}
          surahDone={result.surahDone}
          newWords={result.newWords}
          nextHref={next ? `/journey/${next.surah}/${next.ayahStart}` : null}
          onReplay={onReplay}
        />
      ) : !started || !scene ? (
        <div className="grid flex-1 place-items-center">
          <LoadingBlock label={t("common.loading")} />
        </div>
      ) : (
        <SceneView
          // Keyed by position: two scenes of the same kind in a row (two
          // groups of words to meet) must not share state.
          key={step}
          scene={scene}
          stop={stop}
          index={index}
          audio={audio}
          tajweed={prefs.tajweed}
          onDone={onSceneDone}
        />
      )}
    </div>
  );
}

function SceneView({ scene, ...rest }: Omit<SceneProps, "scene"> & { scene: Scene }) {
  switch (scene.kind) {
    case "listen":
      return <ListenScene scene={scene} {...rest} />;
    case "meet":
      return <MeetScene scene={scene} {...rest} />;
    case "match":
      return <MatchScene scene={scene} {...rest} />;
    case "hear":
      return <HearScene scene={scene} {...rest} />;
    case "build":
      return <BuildScene scene={scene} {...rest} />;
    case "which":
      return <WhichScene scene={scene} {...rest} />;
    case "order":
      return <OrderScene scene={scene} {...rest} />;
    case "recite":
      return <ReciteScene scene={scene} {...rest} />;
  }
}
