/**
 * Build — lay the meanings under an ayah's words, in the order they are recited.
 *
 * The word games so far took words one at a time. Here they are put back into
 * the ayah they came from: the ayah stands at the top exactly as it is written,
 * one word lit, and the child finds that word's meaning among the chips below.
 * Word by word, right to left — the order the child already recites it in —
 * the line of meanings fills in under the Arabic, and when it is complete the
 * ayah's own translation arrives beneath it as the sentence those words make.
 *
 * Only the meanings are shuffled. The Arabic of the ayah is never moved or
 * broken up: it is the fixed thing the meanings are laid against.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import type { JourneyWord } from "@/lib/journey/plan";
import { ContinueButton, SceneLayout, Tile, WordArabic, canHear, type SceneProps } from "./kit";

/** How long a wrong chip shakes before it is back in play. */
const WRONG_MS = 500;

/** Meanings are compared as written, give or take stray spaces. */
function sameMeaning(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a.trim() === b.trim();
}

export function BuildScene({ scene, index, audio, tajweed, onDone }: SceneProps<"build">) {
  const t = useT();
  const verse = index.verse(scene.verseId);

  // The chips that resolve, in the order the plan scrambled them.
  const chips = useMemo(
    () =>
      scene.chips
        .map((ref) => index.word(ref))
        .filter((word): word is JourneyWord => word !== undefined && word.meaning !== null),
    [scene.chips, index],
  );

  /**
   * The words the child is asked about, in recitation order.
   *
   * A word is asked only if a chip in the pool carries its meaning — counted,
   * so that a word said twice needs two chips. Anything else (a chip that did
   * not resolve, a word with no gloss) is shown already filled in: a slot that
   * nothing can fill would leave the child stuck with no way on.
   */
  const asked = useMemo(() => {
    const supply = new Map<string, number>();
    for (const chip of chips) {
      const key = chip.meaning!.trim();
      supply.set(key, (supply.get(key) ?? 0) + 1);
    }
    const out = new Set<number>();
    for (const word of verse?.words ?? []) {
      if (word.meaning === null) continue;
      const key = word.meaning.trim();
      const left = supply.get(key) ?? 0;
      if (left === 0) continue;
      supply.set(key, left - 1);
      out.add(word.id);
    }
    return out;
  }, [chips, verse]);

  /** Words whose slot holds their meaning. */
  const [filled, setFilled] = useState<ReadonlySet<number>>(new Set());
  /** Chips that have been placed, by word id. */
  const [used, setUsed] = useState<ReadonlySet<number>>(new Set());
  const [shaking, setShaking] = useState<number | null>(null);
  const [mistakes, setMistakes] = useState(0);
  const shakeTimer = useRef<number | null>(null);

  const words = verse?.words ?? [];
  const current = words.find((word) => asked.has(word.id) && !filled.has(word.id)) ?? null;
  const complete = verse !== undefined && current === null;

  // Nothing to ask (the ayah did not resolve, or none of its chips did): move
  // on rather than show an empty game. Guarded, because StrictMode runs this
  // effect twice and the lesson must hear `onDone` once.
  const empty = verse === undefined || asked.size === 0;
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
  // Leaving the scene silences it, so the next one does not open over a word.
  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  // The finished line and its translation appear below the fold on a phone;
  // bring them up so the payoff is seen, not scrolled past.
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (complete && !empty) doneRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [complete, empty]);

  if (!verse || empty) return null;

  const tapChip = (chip: JourneyWord) => {
    if (!current || used.has(chip.id) || shaking === chip.id) return;
    // Either twin of a repeated word is the right answer: they read the same,
    // and the child cannot be expected to know which one the plan meant.
    if (sameMeaning(chip.meaning, current.meaning)) {
      setUsed((prev) => new Set(prev).add(chip.id));
      setFilled((prev) => new Set(prev).add(current.id));
      if (canHear(audio, verse, current)) void audio.playWord(verse.id, current.position);
      return;
    }
    setMistakes((count) => count + 1);
    setShaking(chip.id);
    if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => {
      shakeTimer.current = null;
      setShaking(null);
    }, WRONG_MS);
  };

  return (
    <SceneLayout
      title={t("journey.build.title")}
      hint={t("journey.build.hint")}
      className="justify-start"
      footer={<ContinueButton onClick={() => onDone(mistakes)} disabled={!complete} />}
    >
      {/* The ayah as it is written, right to left, one column per word. */}
      <div
        dir="rtl"
        className="journey-rise flex flex-wrap items-start justify-center gap-x-1.5 gap-y-4"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        {words.map((word) => {
          const active = current?.id === word.id;
          // A word not asked about is shown with its meaning from the start.
          const shown = filled.has(word.id) || !asked.has(word.id);
          return (
            <div
              key={word.id}
              data-active={active ? "" : undefined}
              aria-current={active ? "true" : undefined}
              className="journey-word flex min-w-12 flex-col items-center gap-1 px-1.5 pb-2 text-center"
            >
              <span lang="ar" className="journey-arabic text-fg">
                <WordArabic word={word} tajweed={tajweed} />
              </span>
              {shown ? (
                <span
                  dir="auto"
                  className={cn(
                    "flex min-h-11 max-w-[8.5rem] items-center justify-center rounded-xl px-2.5 py-1",
                    "text-[0.8125rem] font-semibold leading-snug sm:text-[0.875rem]",
                    filled.has(word.id)
                      ? "journey-pop bg-accent-soft text-accent-soft-fg"
                      : "text-fg-muted",
                  )}
                >
                  {word.meaning ?? word.transliteration ?? "·"}
                </span>
              ) : (
                // Empty, and the size of a chip, so the line does not reflow
                // as it fills. The lit word's slot is drawn in the accent.
                <span
                  aria-hidden
                  className={cn(
                    "block h-11 w-20 rounded-xl border-2 border-dashed transition-colors",
                    active ? "border-accent" : "border-border-strong",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {complete ? (
        <div ref={doneRef} className="mt-8 scroll-mb-6 text-center">
          <p className="journey-rise text-[0.9375rem] font-medium text-fg-muted">
            {t("journey.build.done")}
          </p>
          <p
            dir="auto"
            lang={verse.translationTag}
            data-selectable
            className="journey-rise mx-auto mt-2 max-w-xl text-[1.125rem] leading-relaxed text-fg"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            {verse.translation}
          </p>
        </div>
      ) : (
        // The pool sticks to the bottom of the scrolling body: on a phone an
        // eight-word ayah can be taller than the screen, and the chips must
        // stay under the thumb while the lit word is scrolled into view.
        <div
          className="journey-rise sticky bottom-0 -mx-5 mt-8 bg-bg/85 px-5 pb-1 pt-3 backdrop-blur md:-mx-8 md:px-8"
          style={{ "--i": 2 } as React.CSSProperties}
        >
          <div className="flex flex-wrap justify-center gap-2">
            {chips.map((chip) => {
              const gone = used.has(chip.id);
              return (
                <Tile
                  key={chip.id}
                  dir="auto"
                  // Kept in place once used, faded and out of play, so the
                  // chips around it do not jump under the next tap.
                  state={gone ? "done" : shaking === chip.id ? "wrong" : undefined}
                  disabled={gone}
                  aria-hidden={gone || undefined}
                  onClick={() => tapChip(chip)}
                  className="min-h-11 px-3.5 py-2 text-[0.875rem]"
                >
                  {chip.meaning}
                </Tile>
              );
            })}
          </div>
        </div>
      )}
    </SceneLayout>
  );
}
