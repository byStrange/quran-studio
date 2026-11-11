/**
 * Order — put the stop's ayahs back in order.
 *
 * A child who recites from memory carries the order of a surah as a chain of
 * sounds, each ayah calling up the next. Laying the ayahs out again one after
 * another, reading them rather than hearing them, makes that chain something
 * they can see — and each ayah, once placed, is recited, so the eye and the ear
 * go through the passage together.
 *
 * It is tap-to-order rather than drag-and-drop: dragging inside a scrolling
 * column is fiddly for a child's finger and impossible from a keyboard, while
 * "tap the one that comes next" is one gesture that works everywhere. Each
 * ayah moves whole; its text is never cut or rearranged.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useT } from "@/providers/I18nProvider";
import { bareArabic, type JourneyVerse } from "@/lib/journey/plan";
import { AyahNumber, ContinueButton, SceneLayout, Tile, VerseArabic, type SceneProps } from "./kit";

/** How long a wrong ayah shakes before it is back in play. */
const WRONG_MS = 500;

export function OrderScene({ scene, stop, index, audio, tajweed, onDone }: SceneProps<"order">) {
  const t = useT();

  // The ayahs that resolve: as the plan scrambled them, and in their order.
  const scrambledVerses = useMemo(
    () =>
      scene.verseIds
        .map((id) => index.verse(id))
        .filter((verse): verse is JourneyVerse => verse !== undefined),
    [scene.verseIds, index],
  );
  const ordered = useMemo(
    () => [...scrambledVerses].sort((a, b) => a.ayah - b.ayah),
    [scrambledVerses],
  );

  /** Tiles taken out of the pool, by verse id. */
  const [taken, setTaken] = useState<ReadonlySet<number>>(new Set());
  const [shaking, setShaking] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const shakeTimer = useRef<number | null>(null);

  // One ayah, or none, is nothing to order: move on. Guarded, because
  // StrictMode runs this effect twice and the lesson must hear `onDone` once.
  const empty = ordered.length < 2;
  const skipped = useRef(false);
  useEffect(() => {
    if (!empty || skipped.current) return;
    skipped.current = true;
    onDone(0);
  }, [empty, onDone]);

  useEffect(
    () => () => {
      if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
    },
    [],
  );
  // Leaving the scene silences it: the next one must not open over an ayah.
  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  // The newest placed ayah is kept in view as the list grows down the screen.
  const lastPlacedRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (taken.size > 0) lastPlacedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [taken.size]);

  if (empty) return null;

  // Placed in order, so the placed list is simply the first N of `ordered`.
  const placed = ordered.slice(0, taken.size);
  const expected = ordered[taken.size] ?? null;
  const complete = expected === null;

  const tap = (verse: JourneyVerse) => {
    if (!expected || taken.has(verse.id) || shaking === verse.id) return;
    // A refrain — two ayahs with the same words — cannot be told apart by
    // reading, so either copy is right for the place the first one is due.
    const right =
      verse.id === expected.id || bareArabic(verse.arabic) === bareArabic(expected.arabic);
    if (right) {
      setTaken((prev) => new Set(prev).add(verse.id));
      if (audio.available) void audio.playVerses([expected.id]);
      return;
    }
    setMistakes((count) => count + 1);
    setShaking(verse.id);
    if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => {
      shakeTimer.current = null;
      setShaking(null);
    }, WRONG_MS);
  };

  const remaining = scrambledVerses.filter((verse) => !taken.has(verse.id));

  return (
    <SceneLayout
      title={t("journey.order.title")}
      hint={t("journey.order.hint")}
      className="justify-start"
      footer={
        <>
          {audio.available ? (
            // A free hint: hearing the passage is how the child knows it.
            <Button
              variant="secondary"
              size="lg"
              className="px-4"
              onClick={() => void audio.playVerses(stop.verses.map((verse) => verse.id))}
              aria-label={t("journey.audio.hearPassage")}
            >
              <Volume2 className={cn("size-4", audio.playing && "text-accent")} aria-hidden />
              <span className="max-sm:sr-only">{t("journey.audio.hearPassage")}</span>
            </Button>
          ) : null}
          <ContinueButton onClick={() => onDone(mistakes)} disabled={!complete} />
        </>
      }
    >
      {/* The passage so far, in order, growing as the child goes. */}
      <ol className="flex flex-col gap-2">
        {placed.map((verse, i) => {
          const playingThis = audio.playing && audio.currentVerseId === verse.id;
          return (
            <li
              key={verse.id}
              ref={i === placed.length - 1 ? lastPlacedRef : undefined}
              dir="rtl"
              className={cn(
                "journey-pop journey-word flex items-start gap-3 px-3 py-1.5",
                "scroll-my-24",
              )}
              data-active={playingThis ? "" : undefined}
            >
              <AyahNumber ayah={verse.ayah} className="mt-3" />
              <VerseArabic
                verse={verse}
                tajweed={tajweed}
                className="journey-arabic-sm min-w-0 flex-1 text-fg"
              />
            </li>
          );
        })}
        {expected ? (
          // Where the next ayah goes. Its number is shown: the ayahs on offer
          // all belong to this stop, so the number says where, not which.
          <li
            dir="rtl"
            className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-dashed border-border-strong px-3"
            aria-hidden
          >
            <AyahNumber ayah={expected.ayah} />
          </li>
        ) : null}
      </ol>

      {remaining.length > 0 ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
          {remaining.map((verse, order) => (
            // The entrance is on a wrapper: on the tile itself it would share
            // `animation` with the shake, and replay when the shake ended.
            <div
              key={verse.id}
              className="journey-rise"
              style={{ "--i": order + 1 } as React.CSSProperties}
            >
              <Tile
                state={shaking === verse.id ? "wrong" : undefined}
                onClick={() => tap(verse)}
                className="w-full px-5 py-3"
              >
                <VerseArabic
                  verse={verse}
                  tajweed={tajweed}
                  className="journey-arabic-sm block w-full text-center"
                />
              </Tile>
            </div>
          ))}
        </div>
      ) : null}
    </SceneLayout>
  );
}
