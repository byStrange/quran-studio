/**
 * Hear — the reciter says one word; which one was it?
 *
 * A child who recites from memory knows these words by their sound long
 * before they know them by sight, so this is the game that meets them where
 * they already are: the word arrives the way it does in their own recitation,
 * and they find it on the screen. Once found, its meaning comes up under it —
 * the sound they knew, the letters they picked and what it means, together.
 *
 * Without a recording (or for a word the timing data has no span for) the
 * same question is asked the other way round: here is a meaning, which word
 * says it? That is decided round by round, so a single unhearable word does
 * not silence the whole scene.
 *
 * A wrong answer shakes and then stays greyed out, so it cannot be given
 * twice and the choices narrow towards the right one — a child always gets
 * there.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useT } from "@/providers/I18nProvider";
import type { JourneyAudio } from "@/hooks/useJourneyAudio";
import type { JourneyVerse, JourneyWord, WordRef } from "@/lib/journey/plan";
import {
  ContinueButton,
  SceneLayout,
  SpeakerButton,
  Tile,
  WordArabic,
  canHear,
  type SceneProps,
  type TileState,
} from "./kit";

/** How long a wrong choice shakes before it settles, greyed, out of play. */
const WRONG_MS = 500;
/**
 * The pause before a round says its word: long enough for the tiles to have
 * risen, so the word is heard with the choices already in front of the child.
 * It is also what makes the autoplay safe under StrictMode — the first,
 * throwaway run of the effect cancels its timer before anything is played.
 */
const AUTOPLAY_DELAY_MS = 350;

interface Entry {
  key: string;
  verse: JourneyVerse;
  word: JourneyWord;
}

interface Round {
  answer: Entry;
  choices: Entry[];
}

const keyOf = (ref: WordRef) => `${ref.verseId}:${ref.wordId}`;

export function HearScene({ scene, index, audio, tajweed, onDone }: SceneProps<"hear">) {
  // Rounds whose answer cannot be looked up are dropped, and so are choices;
  // a round left with nothing to tell apart is not a question.
  const rounds = useMemo(() => {
    const resolve = (ref: WordRef): Entry | null => {
      const verse = index.verse(ref.verseId);
      const word = index.word(ref);
      return verse && word ? { key: keyOf(ref), verse, word } : null;
    };
    const out: Round[] = [];
    for (const round of scene.rounds) {
      const answer = resolve(round.answer);
      if (!answer) continue;
      const choices = round.choices
        .map(resolve)
        .filter((entry): entry is Entry => entry !== null);
      if (!choices.some((choice) => choice.key === answer.key) || choices.length < 2) continue;
      out.push({ answer, choices });
    }
    return out;
  }, [scene.rounds, index]);

  const [at, setAt] = useState(0);
  const [mistakes, setMistakes] = useState(0);

  // Leaving the scene silences it: the next one must not open over a word
  // still being said.
  const stopAudio = audio.stop;
  useEffect(() => stopAudio, [stopAudio]);

  const round = rounds[at];
  if (!round) {
    // Nothing that resolved: let the lesson move on rather than strand it.
    return <EmptyHear onDone={() => onDone(mistakes)} />;
  }

  const last = at === rounds.length - 1;
  return (
    // Keyed by the round, so each one starts clean — nothing picked, nothing
    // revealed — and says its own word when it appears.
    <HearRound
      key={at}
      round={round}
      current={at + 1}
      total={rounds.length}
      audio={audio}
      tajweed={tajweed}
      onWrong={() => setMistakes((count) => count + 1)}
      onNext={() => (last ? onDone(mistakes) : setAt(at + 1))}
    />
  );
}

function EmptyHear({ onDone }: { onDone: () => void }) {
  const t = useT();
  return (
    <SceneLayout title={t("journey.hear.title")} footer={<ContinueButton onClick={onDone} />}>
      {null}
    </SceneLayout>
  );
}

function HearRound({
  round,
  current,
  total,
  audio,
  tajweed,
  onWrong,
  onNext,
}: {
  round: Round;
  current: number;
  total: number;
  audio: JourneyAudio;
  tajweed: boolean;
  onWrong: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const { answer, choices } = round;
  const audible = canHear(audio, answer.verse, answer.word);

  /** Wrong choices already given: out of play. */
  const [ruledOut, setRuledOut] = useState<ReadonlySet<string>>(new Set());
  /** Wrong choices still shaking. */
  const [shaking, setShaking] = useState<ReadonlySet<string>>(new Set());
  const [solved, setSolved] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  /** Whether the word has been heard to the end at least once this round. */
  const [heard, setHeard] = useState(false);

  // `audio` is a new object whenever anything about playback changes; the
  // effects below want the latest one without re-running on every change.
  const audioRef = useRef(audio);
  audioRef.current = audio;

  // Only the newest request may clear `speaking`: when a clip is replaced,
  // the one it replaced resolves false *after* the new one has set it.
  const playToken = useRef(0);
  const say = () => {
    const token = ++playToken.current;
    setSpeaking(true);
    void audioRef.current.playWord(answer.verse.id, answer.word.position).then((finished) => {
      if (playToken.current !== token) return;
      setSpeaking(false);
      // False is not an error — it was interrupted, replaced, or autoplay was
      // refused. The speaker keeps pulsing until it has been heard once.
      if (finished) setHeard(true);
    });
  };
  const sayRef = useRef(say);
  sayRef.current = say;

  // Say the word once when the round appears. Browsers may refuse sound that
  // no gesture started; then the clip resolves false and the pulsing speaker
  // is the way in.
  useEffect(() => {
    if (!audible) return;
    const timer = window.setTimeout(() => sayRef.current(), AUTOPLAY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [audible]);

  const timers = useRef(new Set<number>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) window.clearTimeout(id);
      pending.clear();
    };
  }, []);

  // A choice that goes out of play is disabled, which drops keyboard focus.
  // After an answer from the keyboard, focus goes on to a choice still in
  // play (or, once solved, ContinueButton takes it on its own).
  const grid = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [ruledOut]);

  const pick = (choice: Entry, event: MouseEvent<HTMLButtonElement>) => {
    if (solved || ruledOut.has(choice.key)) return;
    if (choice.key === answer.key) {
      setSolved(true);
      if (audible) sayRef.current();
      return;
    }
    // `detail` is 0 for a click that came from the keyboard.
    if (event.detail === 0) refocus.current = true;
    onWrong();
    setRuledOut((out) => new Set(out).add(choice.key));
    setShaking((now) => new Set(now).add(choice.key));
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      setShaking((now) => {
        const next = new Set(now);
        next.delete(choice.key);
        return next;
      });
    }, WRONG_MS);
    timers.current.add(id);
  };

  const stateOf = (choice: Entry): TileState | undefined => {
    if (shaking.has(choice.key)) return "wrong";
    if (solved) return choice.key === answer.key ? "correct" : "done";
    if (ruledOut.has(choice.key)) return "done";
    return undefined;
  };

  const lastWrong = ruledOut.size > 0 && !solved;

  return (
    <SceneLayout
      title={audible ? t("journey.hear.title") : t("journey.hear.titleSilent")}
      hint={audible ? t("journey.hear.hint") : t("journey.hear.hintSilent")}
      footer={
        <>
          <span className="text-[0.875rem] tabular-nums text-fg-subtle">
            {t("journey.hear.round", { current, total })}
          </span>
          <ContinueButton onClick={onNext} disabled={!solved} />
        </>
      }
    >
      {/* The question: a voice, or a meaning. */}
      <div className="journey-rise mb-8 flex justify-center" style={{ "--i": 1 } as React.CSSProperties}>
        {audible ? (
          <SpeakerButton
            size="lg"
            label={t("journey.audio.hearWord")}
            active={speaking || (!heard && !solved)}
            onClick={() => sayRef.current()}
          />
        ) : (
          <div className="w-full max-w-sm rounded-2xl border border-border-strong bg-surface px-6 py-5 text-center shadow-sm">
            <p dir="auto" className="text-[1.375rem] font-semibold leading-snug text-fg">
              {answer.word.meaning ?? answer.word.transliteration ?? "…"}
            </p>
          </div>
        )}
      </div>

      {/* The choices, right to left like the ayah they came out of. */}
      <div ref={grid} dir="rtl" className="flex flex-wrap justify-center gap-3">
        {choices.map((choice, order) => {
          const state = stateOf(choice);
          return (
            // The rise lives on a wrapper: on the tile it would restart when
            // a shake handed the animation back to it.
            <div
              key={choice.key}
              className="journey-rise"
              style={{ "--i": order + 2 } as React.CSSProperties}
            >
              <Tile
                state={state}
                disabled={solved || ruledOut.has(choice.key)}
                onClick={(event) => pick(choice, event)}
                className="min-h-20 min-w-24 px-5"
              >
                <span lang="ar" className="journey-arabic">
                  <WordArabic word={choice.word} tajweed={tajweed} />
                </span>
              </Tile>
            </div>
          );
        })}
      </div>

      {/* What the word just found means — or a gentle nudge to try again. */}
      <div className="mt-6 flex min-h-20 flex-col items-center justify-start" aria-live="polite">
        {solved ? (
          <div className="journey-pop flex flex-col items-center gap-1 rounded-2xl bg-accent-soft px-6 py-3 text-center text-accent-soft-fg">
            <span className="text-[0.8125rem] font-semibold">{t("journey.feedback.correct")}</span>
            {answer.word.meaning ? (
              <span dir="auto" className="text-[1.125rem] font-semibold leading-snug">
                {answer.word.meaning}
              </span>
            ) : null}
            {answer.word.transliteration ? (
              <span dir="ltr" className="text-[0.8125rem] italic opacity-80">
                {answer.word.transliteration}
              </span>
            ) : null}
          </div>
        ) : lastWrong ? (
          <p className="text-[0.875rem] text-fg-muted">{t("journey.feedback.tryAgain")}</p>
        ) : null}
      </div>
    </SceneLayout>
  );
}
