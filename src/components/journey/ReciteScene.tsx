/**
 * Recite — the reader recites, and the meaning keeps pace with them.
 *
 * Every scene before this one has the reciter's voice in it. This one is
 * silent on purpose: it is the child's own recitation, the thing they will do
 * in prayer tomorrow, and the point of the lesson is that the meaning is in
 * their head while they do it. So they recite aloud and tap once per word, and
 * each tap brings up that word's meaning — the same pairing the listen scene
 * made, but now driven by their voice instead of the recording.
 *
 * Nothing here can be got wrong. There is no way for the app to hear the
 * recitation, and pretending to grade it would teach a child to tap rather
 * than to recite; "from memory" hides the words still to come for the reader
 * who wants to test themselves, and that is as far as checking goes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, RotateCcw, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/providers/I18nProvider";
import { AyahNumber, ContinueButton, SceneLayout, WordArabic, type SceneProps } from "./kit";

export function ReciteScene({ stop, audio, tajweed, onDone }: SceneProps<"recite">) {
  const t = useT();

  /** Every word of the stop in recitation order, with the ayah it closes. */
  const steps = useMemo(
    () =>
      stop.verses.flatMap((verse) =>
        verse.words.map((word, index) => ({
          verse,
          word,
          closesVerse: index === verse.words.length - 1,
        })),
      ),
    [stop],
  );

  /** How many words have been recited. */
  const [said, setSaid] = useState(0);
  const [fromMemory, setFromMemory] = useState(false);
  const done = said >= steps.length;
  const current = said > 0 ? steps[said - 1]! : null;

  const advance = useCallback(() => {
    setSaid((count) => Math.min(count + 1, steps.length));
  }, [steps.length]);

  // The word just said stays in view through a passage taller than the screen.
  const wordRefs = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    if (!current) return;
    wordRefs.current.get(current.word.id)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [current]);

  // Space recites the next word, as the tap does. Enter is left alone: it
  // belongs to whichever button has focus.
  useEffect(() => {
    if (done) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      event.preventDefault();
      advance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, done]);

  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  // A reminder of how the ayah goes, for the reader who has lost the thread:
  // the ayah they are in, or the first one before they have begun.
  const hintVerse = (said < steps.length ? steps[said]! : steps[steps.length - 1]!).verse;

  return (
    <SceneLayout
      title={t("journey.recite.title")}
      hint={t("journey.recite.hint")}
      className="justify-start"
      footer={
        <>
          <Button
            variant="secondary"
            size="lg"
            className="px-4"
            onClick={() => setSaid(0)}
            disabled={said === 0}
            aria-label={t("journey.recite.again")}
          >
            <RotateCcw className="size-4" aria-hidden />
            <span className="max-md:sr-only">{t("journey.recite.again")}</span>
          </Button>
          <Button
            variant={fromMemory ? "primary" : "secondary"}
            size="lg"
            className="px-4"
            aria-pressed={fromMemory}
            onClick={() => setFromMemory((value) => !value)}
            aria-label={fromMemory ? t("journey.recite.show") : t("journey.recite.hide")}
          >
            {fromMemory ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
            <span className="max-md:sr-only">
              {fromMemory ? t("journey.recite.show") : t("journey.recite.hide")}
            </span>
          </Button>
          {audio.available ? (
            <Button
              variant="secondary"
              size="lg"
              className="px-4"
              onClick={() => void audio.playVerses([hintVerse.id])}
              aria-label={t("journey.audio.hearAyah")}
            >
              <Volume2 className="size-4" aria-hidden />
            </Button>
          ) : null}
          {done ? (
            <ContinueButton onClick={() => onDone(0)} />
          ) : (
            <Button
              variant="primary"
              size="lg"
              className={cn("ml-auto min-w-40 flex-1 sm:flex-none", said === 0 && "journey-pulse")}
              onClick={advance}
            >
              {said === 0 ? t("journey.recite.begin") : t("journey.recite.tap")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-8">
        {stop.verses.map((verse) => {
          const firstStep = steps.findIndex((step) => step.verse.id === verse.id);
          const verseDone = said >= firstStep + verse.words.length;
          return (
            <section key={verse.id}>
              <div dir="rtl" className="flex flex-wrap items-start justify-center gap-x-1.5 gap-y-4">
                {verse.words.map((word, wordIndex) => {
                  const at = firstStep + wordIndex;
                  const recited = at < said;
                  const active = at === said - 1 && !done;
                  // From memory, a word not yet said is a blank the size of
                  // the word: the line keeps its shape and gives away only
                  // how long the next word is.
                  const hidden = fromMemory && !recited;
                  return (
                    <span
                      key={word.id}
                      ref={(node) => {
                        if (node) wordRefs.current.set(word.id, node);
                        else wordRefs.current.delete(word.id);
                      }}
                      data-active={active ? "" : undefined}
                      className="journey-word flex min-w-12 scroll-mt-6 flex-col items-center px-2 pb-2 text-center"
                    >
                      <span
                        lang="ar"
                        className={cn(
                          "journey-arabic rounded-lg transition-colors duration-200",
                          hidden
                            ? "bg-surface-3 text-transparent [&_*]:!text-transparent"
                            : recited
                              ? "text-fg"
                              : "text-fg-subtle",
                        )}
                        aria-hidden={hidden}
                      >
                        <WordArabic word={word} tajweed={tajweed && recited} />
                      </span>
                      <span
                        dir="auto"
                        className={cn(
                          "mt-1 max-w-[9.5rem] text-[0.875rem] font-medium leading-snug transition-all duration-200",
                          active ? "text-gold-soft-fg" : "text-fg-muted",
                          recited ? "opacity-100" : "translate-y-1 opacity-0",
                        )}
                        aria-hidden={!recited}
                      >
                        {word.meaning ?? word.transliteration ?? "·"}
                      </span>
                    </span>
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
                  verseDone ? "opacity-100" : "translate-y-1 opacity-0",
                )}
                aria-hidden={!verseDone}
              >
                {verse.translation}
              </p>
            </section>
          );
        })}
      </div>

      {done ? (
        <p className="journey-pop mt-8 text-center text-[1rem] font-semibold text-accent-soft-fg">
          {t("journey.recite.done")}
        </p>
      ) : null}
    </SceneLayout>
  );
}
