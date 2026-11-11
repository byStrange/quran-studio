/**
 * Match — pair each Arabic word with what it means.
 *
 * The first time the child is asked rather than told. Meet has just shown
 * these words with their meanings; here the two halves are pulled apart into
 * two columns and put back together by hand, which is where "I saw that" turns
 * into "I know that". A pair put together right is said aloud in the reciter's
 * voice, so every correct answer is also one more time hearing the word.
 *
 * The meanings are shuffled once, when the scene opens, and the tiles never
 * move after that: a tile that slid away while a finger was on its way to it
 * would turn a right answer into a wrong one. Matched tiles stay where they
 * were, dimmed, so the columns shrink in meaning but not in shape.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { shuffle } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import type { JourneyVerse, JourneyWord, WordRef } from "@/lib/journey/plan";
import {
  ContinueButton,
  SceneLayout,
  Tile,
  WordArabic,
  canHear,
  type SceneProps,
  type TileState,
} from "./kit";

/** How long a right pair shows as "correct" before it settles out of play. */
const CORRECT_MS = 650;
/** How long a wrong pair shakes before both tiles are free again. */
const WRONG_MS = 500;

type Side = "arabic" | "meaning";

interface Pair {
  key: string;
  verse: JourneyVerse;
  word: JourneyWord;
  meaning: string;
}

const keyOf = (ref: WordRef) => `${ref.verseId}:${ref.wordId}`;

/**
 * A shuffle in which, where possible, no meaning sits on the same row as its
 * word. With three to five pairs a plain shuffle leaves one straight across
 * more often than not, and a pair that can be matched by looking sideways
 * teaches nothing.
 */
function crossedOrder(pairs: readonly Pair[]): Pair[] {
  if (pairs.length < 2) return [...pairs];
  for (let attempt = 0; attempt < 12; attempt++) {
    const out = shuffle(pairs);
    if (out.every((pair, row) => pair !== pairs[row])) return out;
  }
  // A rotation is always crossed.
  return [...pairs.slice(1), pairs[0]!];
}

export function MatchScene({ scene, index, audio, tajweed, onDone }: SceneProps<"match">) {
  const t = useT();

  // Only words that resolve and have a meaning can be paired; the planner
  // never sends any other, but a missing one must not take the scene down.
  const pairs = useMemo(() => {
    const out: Pair[] = [];
    for (const ref of scene.words) {
      const verse = index.verse(ref.verseId);
      const word = index.word(ref);
      if (!verse || !word || !word.meaning) continue;
      out.push({ key: keyOf(ref), verse, word, meaning: word.meaning });
    }
    return out;
  }, [scene.words, index]);

  // Decided once. The initializer sees the first `pairs`; the scene is keyed
  // by the lesson, so a different set of words is a different mount.
  const [meaningOrder] = useState(() => crossedOrder(pairs).map((pair) => pair.key));
  const byKey = useMemo(() => new Map(pairs.map((pair) => [pair.key, pair])), [pairs]);
  const meaningColumn = meaningOrder
    .map((key) => byKey.get(key))
    .filter((pair): pair is Pair => pair !== undefined);

  const [selected, setSelected] = useState<{ side: Side; key: string } | null>(null);
  /** Pairs put together, whether still flashing "correct" or settled. */
  const [matched, setMatched] = useState<ReadonlySet<string>>(new Set());
  /** Pairs matched a moment ago, still showing their pop. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  /** The pair that was just wrong, while it shakes. */
  const [wrong, setWrong] = useState<{ arabic: string; meaning: string } | null>(null);
  const [mistakes, setMistakes] = useState(0);
  /** What the live region last said, for anyone not watching the tiles. */
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);

  const timers = useRef(new Set<number>());
  const wrongTimer = useRef<number | null>(null);
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  };
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  // Leaving the scene silences it: the next one must not open over a word
  // still being said.
  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  // A matched tile is disabled, and a disabled button drops keyboard focus on
  // the floor. After a pair made from the keyboard, focus goes on to the next
  // tile still in play on the same side, so Tab is not a trip back to the top.
  const tiles = useRef(new Map<string, HTMLElement>());
  const refocus = useRef<Side | null>(null);
  useEffect(() => {
    const side = refocus.current;
    if (!side) return;
    refocus.current = null;
    const column = side === "arabic" ? pairs : meaningColumn;
    const next = column.find((pair) => !matched.has(pair.key));
    if (next) tiles.current.get(`${side}:${next.key}`)?.querySelector("button")?.focus();
    // Runs on a new match only; the columns themselves never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  const complete = pairs.length > 0 && matched.size === pairs.length;

  const tap = (side: Side, key: string, event: MouseEvent<HTMLButtonElement>) => {
    if (matched.has(key)) return;
    // A tap while a wrong pair is still shaking cuts the shake short: the
    // child has already moved on, and a game that ignores taps feels broken.
    if (wrong) {
      if (wrongTimer.current !== null) window.clearTimeout(wrongTimer.current);
      wrongTimer.current = null;
      setWrong(null);
    }
    const current = selected;

    if (!current || current.side === side) {
      // Nothing held yet, or another tile on the same side: this one is held
      // now — unless it was the one already held, which lets it go.
      setSelected(current?.key === key && current.side === side ? null : { side, key });
      return;
    }

    const arabicKey = side === "arabic" ? key : current.key;
    const meaningKey = side === "meaning" ? key : current.key;
    setSelected(null);

    if (arabicKey === meaningKey) {
      const pair = byKey.get(arabicKey)!;
      // `detail` is 0 for a click that came from the keyboard.
      if (event.detail === 0) refocus.current = side;
      setMatched((done) => new Set(done).add(arabicKey));
      setFresh((now) => new Set(now).add(arabicKey));
      setFeedback("correct");
      later(() => {
        setFresh((now) => {
          const next = new Set(now);
          next.delete(arabicKey);
          return next;
        });
      }, CORRECT_MS);
      if (canHear(audio, pair.verse, pair.word)) {
        // Interrupted or replaced by the next match — either is fine.
        void audio.playWord(pair.verse.id, pair.word.position);
      }
      return;
    }

    setWrong({ arabic: arabicKey, meaning: meaningKey });
    setMistakes((count) => count + 1);
    setFeedback("wrong");
    wrongTimer.current = later(() => {
      wrongTimer.current = null;
      setWrong(null);
    }, WRONG_MS);
  };

  const stateOf = (side: Side, key: string): TileState | undefined => {
    if (fresh.has(key)) return "correct";
    if (matched.has(key)) return "done";
    if (wrong && wrong[side] === key) return "wrong";
    if (selected && selected.side === side && selected.key === key) return "selected";
    return undefined;
  };

  const tileProps = (side: Side, key: string) => {
    const state = stateOf(side, key);
    return {
      state,
      disabled: matched.has(key),
      "aria-pressed": state === "selected",
      onClick: (event: MouseEvent<HTMLButtonElement>) => tap(side, key, event),
    };
  };

  // On the wrapper, since `Tile` does not take a ref.
  const holder = (side: Side, key: string) => (node: HTMLDivElement | null) => {
    if (node) tiles.current.set(`${side}:${key}`, node);
    else tiles.current.delete(`${side}:${key}`);
  };

  return (
    <SceneLayout
      title={t("journey.match.title")}
      hint={t("journey.match.hint")}
      footer={
        <>
          <span className="text-[0.875rem] text-fg-subtle" aria-live="polite">
            {feedback === "wrong"
              ? t("journey.feedback.tryAgain")
              : feedback === "correct"
                ? t("journey.feedback.correct")
                : null}
          </span>
          <ContinueButton
            onClick={() => onDone(mistakes)}
            disabled={!complete && pairs.length > 0}
          />
        </>
      }
    >
      {/*
        Two columns at every width. `dir="rtl"` puts the Arabic first, on the
        right, which is the side it is read from; the meanings carry their own
        direction. At 360px each column is still ~150px — room for a word in
        Arabic, and for a short gloss on two lines.
      */}
      <div dir="rtl" className="mx-auto grid w-full max-w-xl grid-cols-2 gap-3 sm:gap-5">
        <div className="flex flex-col gap-3">
          {pairs.map((pair, row) => (
            // The rise lives on a wrapper: on the tile it would restart every
            // time a shake or a pop handed the animation back to it.
            <div
              key={pair.key}
              ref={holder("arabic", pair.key)}
              className="journey-rise"
              style={{ "--i": row + 1 } as React.CSSProperties}
            >
              <Tile {...tileProps("arabic", pair.key)} className="min-h-16 w-full px-2">
                <span lang="ar" className="journey-arabic-sm">
                  <WordArabic word={pair.word} tajweed={tajweed} />
                </span>
              </Tile>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {meaningColumn.map((pair, row) => (
            <div
              key={pair.key}
              ref={holder("meaning", pair.key)}
              className="journey-rise"
              style={{ "--i": row + 1 } as React.CSSProperties}
            >
              <Tile {...tileProps("meaning", pair.key)} className="min-h-16 w-full px-3">
                <span dir="auto" className="min-w-0 break-words">
                  {pair.meaning}
                </span>
              </Tile>
            </div>
          ))}
        </div>
      </div>
    </SceneLayout>
  );
}
