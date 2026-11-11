/**
 * Which — read a meaning, pick the ayah that says it.
 *
 * The word games tie single words to their meanings; this ties whole ayahs to
 * theirs. The child reads what an ayah means and finds it among two or three
 * ayahs of the same surah, which is the moment a recited line stops being
 * only a sound: "that is the one that says this".
 *
 * The choices carry no ayah numbers. A child who knows the surah by heart
 * knows its order, and a number would let them answer by counting instead of
 * by understanding.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/providers/I18nProvider";
import type { JourneyVerse } from "@/lib/journey/plan";
import {
  ContinueButton,
  SceneLayout,
  Tile,
  VerseArabic,
  type SceneProps,
  type TileState,
} from "./kit";

/** How long a wrong choice shakes before it is set aside. */
const WRONG_MS = 500;

interface Round {
  answer: JourneyVerse;
  choices: JourneyVerse[];
}

export function WhichScene({ scene, index, audio, tajweed, onDone }: SceneProps<"which">) {
  const t = useT();

  // Rounds whose ayahs resolve. A round left with one choice is no question,
  // so it is dropped rather than played.
  const rounds = useMemo(() => {
    const out: Round[] = [];
    for (const round of scene.rounds) {
      const answer = index.verse(round.verseId);
      if (!answer) continue;
      const choices = round.choiceVerseIds
        .map((id) => index.verse(id))
        .filter((verse): verse is JourneyVerse => verse !== undefined);
      if (choices.length < 2 || !choices.some((verse) => verse.id === answer.id)) continue;
      out.push({ answer, choices });
    }
    return out;
  }, [scene.rounds, index]);

  const [at, setAt] = useState(0);
  /** Wrong choices of this round, set aside. */
  const [out, setOut] = useState<ReadonlySet<number>>(new Set());
  const [shaking, setShaking] = useState<number | null>(null);
  const [solved, setSolved] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const shakeTimer = useRef<number | null>(null);

  // Nothing to ask: move on. Guarded, because StrictMode runs this effect
  // twice and the lesson must hear `onDone` once.
  const empty = rounds.length === 0;
  const skipped = useRef(false);
  useEffect(() => {
    if (!empty || skipped.current) return;
    skipped.current = true;
    onDone(0);
  }, [empty, onDone]);

  const clearShake = () => {
    if (shakeTimer.current !== null) window.clearTimeout(shakeTimer.current);
    shakeTimer.current = null;
  };
  useEffect(() => clearShake, []);
  // Leaving the scene silences it: the next one must not open over an ayah.
  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  const round = rounds[at];
  if (!round) return null;

  const choose = (verse: JourneyVerse) => {
    if (solved || out.has(verse.id) || shaking === verse.id) return;
    if (verse.id === round.answer.id) {
      clearShake();
      setShaking(null);
      setSolved(true);
      // Hearing the ayah just found is the reward, and puts its sound to the
      // meaning that was just read.
      if (audio.available) void audio.playVerses([verse.id]);
      return;
    }
    setMistakes((count) => count + 1);
    setShaking(verse.id);
    clearShake();
    shakeTimer.current = window.setTimeout(() => {
      shakeTimer.current = null;
      setShaking(null);
      setOut((prev) => new Set(prev).add(verse.id));
    }, WRONG_MS);
  };

  const next = () => {
    if (at + 1 >= rounds.length) {
      onDone(mistakes);
      return;
    }
    // The ayah of the last round must not run on under the next question.
    audio.stop();
    clearShake();
    setShaking(null);
    setOut(new Set());
    setSolved(false);
    setAt(at + 1);
  };

  const stateOf = (verse: JourneyVerse): TileState | undefined => {
    if (shaking === verse.id) return "wrong";
    if (solved) return verse.id === round.answer.id ? "correct" : "done";
    if (out.has(verse.id)) return "done";
    return undefined;
  };

  return (
    <SceneLayout
      title={t("journey.which.title")}
      hint={t("journey.which.hint")}
      footer={
        <>
          <span className="text-[0.875rem] tabular-nums text-fg-subtle" aria-live="polite">
            {t("journey.hear.round", { current: at + 1, total: rounds.length })}
          </span>
          <ContinueButton onClick={next} disabled={!solved} />
        </>
      }
    >
      {/* Keyed by round so each new question rises in afresh. */}
      <div key={at} className="flex flex-col gap-6">
        <blockquote
          dir="auto"
          lang={round.answer.translationTag}
          data-selectable
          className="journey-rise rounded-2xl border border-border bg-accent-soft px-5 py-5 text-center text-[1.125rem] font-medium leading-relaxed text-accent-soft-fg sm:px-7 sm:text-[1.25rem]"
        >
          {round.answer.translation}
        </blockquote>

        <div className="flex flex-col gap-3">
          {round.choices.map((verse, order) => {
            const state = stateOf(verse);
            return (
              // The entrance is on a wrapper: on the tile itself it would
              // share `animation` with the shake, and replay when the shake
              // ended.
              <div
                key={verse.id}
                className="journey-rise"
                style={{ "--i": order + 1 } as React.CSSProperties}
              >
                <Tile
                  state={state}
                  // Out of play once set aside, and all of them once answered.
                  disabled={solved || state === "done"}
                  onClick={() => choose(verse)}
                  className="w-full px-5 py-3"
                >
                  <VerseArabic
                    verse={verse}
                    tajweed={tajweed}
                    className="journey-arabic-sm block w-full text-center"
                  />
                </Tile>
              </div>
            );
          })}
        </div>
      </div>
    </SceneLayout>
  );
}
