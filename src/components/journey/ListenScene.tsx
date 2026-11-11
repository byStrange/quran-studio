/**
 * Listen — the reciter recites, and the meaning arrives with every word.
 *
 * This is the scene the whole mode exists for. A child who has memorised a
 * surah knows its sound from end to end and, usually, none of its words; a
 * translation printed underneath does not fix that, because nothing ties
 * "the Lord of mankind" to the sounds *rabbi n-nās*. Here each word lights up
 * as it is sung and its meaning rises under it at that moment, so the sound
 * and the sense are learned as one thing.
 *
 * A meaning stays once it has appeared: by the end of an ayah the whole line
 * can be read back, and only then does the ayah's translation fade in beneath
 * as the sentence those words make.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/providers/I18nProvider";
import type { JourneyAudio } from "@/hooks/useJourneyAudio";
import type { JourneyVerse } from "@/lib/journey/plan";
import { AyahNumber, ContinueButton, SceneLayout, WordArabic, type SceneProps } from "./kit";

const SLOW_RATE = 0.75;
/** With no recording, how long each word holds the light. */
const SILENT_WORD_MS = 900;

export function ListenScene({ stop, audio, tajweed, onDone }: SceneProps<"listen">) {
  return (
    <ListenStage verses={stop.verses} audio={audio} tajweed={tajweed} onDone={() => onDone(0)} />
  );
}

/**
 * The stage itself, apart from the scene, because the surah page plays a whole
 * surah on it too — the same thing, with more ayahs and no lesson around it.
 */
export function ListenStage({
  verses,
  audio,
  tajweed,
  onDone,
  doneLabel,
}: {
  verses: JourneyVerse[];
  audio: JourneyAudio;
  tajweed: boolean;
  onDone: () => void;
  doneLabel?: string;
}) {
  const t = useT();
  const verseIds = useMemo(() => verses.map((verse) => verse.id), [verses]);

  /** Words whose meaning has been shown, as "verseId:position". */
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  /** Ayahs recited to the end, whose translation is therefore showing. */
  const [finished, setFinished] = useState<ReadonlySet<number>>(new Set());
  const [heardAll, setHeardAll] = useState(false);
  // The silent walk-through's own cursor, standing in for the reciter.
  const [silent, setSilent] = useState<{ verseId: number; position: number } | null>(null);
  const silentTimer = useRef<number | null>(null);

  const activeVerseId = audio.playing ? audio.currentVerseId : (silent?.verseId ?? null);
  const activePosition = audio.playing ? audio.currentWordPosition : (silent?.position ?? null);

  // Each word the reciter reaches is revealed, and stays revealed.
  useEffect(() => {
    if (activeVerseId === null || activePosition === null) return;
    const key = `${activeVerseId}:${activePosition}`;
    setRevealed((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, [activeVerseId, activePosition]);

  // Moving on to an ayah means the one before it is complete.
  const previousVerse = useRef<number | null>(null);
  useEffect(() => {
    const before = previousVerse.current;
    previousVerse.current = activeVerseId;
    if (before !== null && before !== activeVerseId) completeVerse(before);
    // `completeVerse` only touches state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVerseId]);

  const completeVerse = useCallback(
    (verseId: number) => {
      const verse = verses.find((v) => v.id === verseId);
      if (!verse) return;
      // Every word of it, including any the timing data had no span for —
      // a finished ayah must not be left with a hole in its meaning.
      setRevealed((current) => {
        const next = new Set(current);
        for (const word of verse.words) next.add(`${verseId}:${word.position}`);
        return next;
      });
      setFinished((current) => (current.has(verseId) ? current : new Set(current).add(verseId)));
    },
    [verses],
  );

  // The ayah being recited is kept in view; a long stop is taller than a phone.
  const verseRefs = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (activeVerseId === null) return;
    verseRefs.current
      .get(activeVerseId)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeVerseId]);

  const stopSilent = useCallback(() => {
    if (silentTimer.current !== null) window.clearTimeout(silentTimer.current);
    silentTimer.current = null;
    setSilent(null);
  }, []);

  /** Walks the words on a timer, for a passage with no recording. */
  const playSilently = useCallback(() => {
    const steps = verses.flatMap((verse) =>
      verse.words.map((word) => ({ verseId: verse.id, position: word.position })),
    );
    let at = 0;
    const step = () => {
      if (at >= steps.length) {
        silentTimer.current = null;
        setSilent(null);
        for (const verse of verses) completeVerse(verse.id);
        setHeardAll(true);
        return;
      }
      setSilent(steps[at]!);
      at += 1;
      silentTimer.current = window.setTimeout(step, SILENT_WORD_MS);
    };
    step();
  }, [verses, completeVerse]);

  const play = useCallback(
    (from?: number) => {
      stopSilent();
      if (!audio.available) {
        playSilently();
        return;
      }
      const ids = from === undefined ? verseIds : verseIds.slice(verseIds.indexOf(from));
      void audio.playVerses(ids).then((completed) => {
        if (!completed) return;
        completeVerse(ids[ids.length - 1]!);
        // Only a recital from the top counts as having heard the passage.
        if (from === undefined || from === verseIds[0]) setHeardAll(true);
      });
    },
    [audio, verseIds, playSilently, stopSilent, completeVerse],
  );

  const pause = useCallback(() => {
    stopSilent();
    audio.stop();
  }, [audio, stopSilent]);

  useEffect(() => stopSilent, [stopSilent]);
  // Leaving the stage silences it: the next scene must not open over the
  // tail of this one's recitation.
  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  const running = audio.playing || audio.loading || silent !== null;
  const started = revealed.size > 0 || running;

  /** A word, tapped: hear it again and (re)show what it means. */
  const tapWord = (verse: JourneyVerse, position: number) => {
    if (running) return;
    setRevealed((current) => new Set(current).add(`${verse.id}:${position}`));
    if (audio.hasWord(verse.id, position)) void audio.playWord(verse.id, position);
  };

  return (
    <SceneLayout
      title={t("journey.listen.title")}
      hint={
        audio.available || !started ? t("journey.listen.hint") : t("journey.listen.noAudioHint")
      }
      className="justify-start"
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            className="px-4"
            onClick={running ? pause : () => play()}
            aria-label={running ? t("audio.pause") : t("audio.play")}
          >
            {audio.loading ? (
              // Asked for and not audible yet: say so, or the stage looks
              // stuck for as long as the recording takes to arrive.
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : running ? (
              <Pause className="size-4" aria-hidden />
            ) : started ? (
              <RotateCcw className="size-4" aria-hidden />
            ) : (
              <Play className="size-4" aria-hidden />
            )}
            <span className="max-sm:sr-only">
              {running
                ? t("journey.audio.pause")
                : started
                  ? t("journey.audio.replay")
                  : t("journey.audio.play")}
            </span>
          </Button>
          {audio.available ? (
            <Button
              variant={audio.rate < 1 ? "primary" : "secondary"}
              size="lg"
              className="px-4"
              aria-pressed={audio.rate < 1}
              onClick={() => audio.setRate(audio.rate < 1 ? 1 : SLOW_RATE)}
              aria-label={t("journey.audio.slow")}
            >
              <Gauge className="size-4" aria-hidden />
              <span className="max-sm:sr-only">{t("journey.audio.slow")}</span>
            </Button>
          ) : null}
          <ContinueButton onClick={onDone} disabled={!heardAll} label={doneLabel} />
        </>
      }
    >
      {!started ? (
        <div className="journey-rise mb-8 flex justify-center" style={{ "--i": 2 } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => play()}
            className="journey-pulse grid size-24 place-items-center rounded-full bg-accent text-accent-fg transition-transform active:scale-95"
            aria-label={t("audio.play")}
          >
            <Play className="size-10 translate-x-0.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="space-y-9">
        {verses.map((verse, verseIndex) => (
          <section
            key={verse.id}
            ref={(node) => {
              if (node) verseRefs.current.set(verse.id, node);
              else verseRefs.current.delete(verse.id);
            }}
            className={cn(
              "journey-rise scroll-mt-6 transition-opacity duration-300",
              // While reciting, the other ayahs step back so the eye stays
              // with the voice.
              running && activeVerseId !== null && activeVerseId !== verse.id && "opacity-45",
            )}
            style={{ "--i": verseIndex + 1 } as React.CSSProperties}
          >
            <div dir="rtl" className="flex flex-wrap items-start justify-center gap-x-1.5 gap-y-4">
              {verse.words.map((word) => {
                const key = `${verse.id}:${word.position}`;
                const active = activeVerseId === verse.id && activePosition === word.position;
                const shown = revealed.has(key);
                return (
                  <button
                    key={word.id}
                    type="button"
                    onClick={() => tapWord(verse, word.position)}
                    data-active={active ? "" : undefined}
                    className="journey-word flex min-w-12 flex-col items-center px-2 pb-2 text-center"
                  >
                    <span lang="ar" className="journey-arabic text-fg">
                      <WordArabic word={word} tajweed={tajweed} />
                    </span>
                    <span
                      dir="auto"
                      className={cn(
                        "mt-1 max-w-[9.5rem] text-[0.875rem] font-medium leading-snug transition-all duration-300",
                        active ? "text-gold-soft-fg" : "text-fg-muted",
                        // Invisible rather than absent until it is revealed,
                        // so the line is laid out once and a meaning arriving
                        // never pushes the words around.
                        shown ? "opacity-100" : "translate-y-1 opacity-0",
                      )}
                      aria-hidden={!shown}
                    >
                      {word.meaning ?? word.transliteration ?? "·"}
                    </span>
                  </button>
                );
              })}
              <AyahNumber ayah={verse.ayah} className="mt-4 self-start" />
            </div>
            <p
              dir="auto"
              lang={verse.translationTag}
              data-selectable
              className={cn(
                "mx-auto mt-7 max-w-xl text-center text-[1.0625rem] leading-relaxed text-fg transition-all duration-500",
                finished.has(verse.id) ? "opacity-100" : "translate-y-1 opacity-0",
              )}
              aria-hidden={!finished.has(verse.id)}
            >
              {verse.translation}
            </p>
          </section>
        ))}
      </div>

      {audio.failed || (!audio.available && started) ? (
        <p className="mt-8 text-center text-[0.8125rem] text-fg-subtle">
          {t("journey.audio.unavailable")}
        </p>
      ) : null}
    </SceneLayout>
  );
}
