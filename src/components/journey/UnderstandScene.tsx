/**
 * Understand — what the passage teaches, from the tafsir.
 *
 * The other scenes teach what the words say. This one is the step beyond: why
 * the ayahs were revealed, what they ask of the person reciting them. The
 * tafsir is where that lives, and a tafsir entry is exactly the wall of text
 * this mode exists to spare a child — so it arrives here as a few short
 * points, one tap at a time, and then as questions to answer.
 *
 * The content is the tafsir's, condensed by the AI (see `useJourneyInsight`),
 * and the scene says so. It may also simply not exist: no summary cached yet
 * and no AI on this device. Then the scene steps aside without a word — a
 * lesson must never stop because an extra was unavailable.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Lightbulb } from "lucide-react";
import { shuffle } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { useT } from "@/providers/I18nProvider";
import { useJourneyInsight, type JourneyInsight } from "@/hooks/useJourneyInsight";
import { ContinueButton, SceneLayout, Tile, type SceneProps, type TileState } from "./kit";

/** How long a wrong answer stays red before it is put out of play. */
const WRONG_MS = 500;
/** Fewer questions than this cannot supply each other's wrong answers. */
const MIN_FOR_CHOICES = 3;

export function UnderstandScene({ stop, onDone }: SceneProps<"understand">) {
  const t = useT();
  const insight = useJourneyInsight(stop);

  // Nothing to show: carry on. Guarded, because the effect runs twice in
  // development and `onDone` must be called once.
  const skipped = useRef(false);
  const unavailable = !insight.isPending && !insight.data;
  useEffect(() => {
    if (!unavailable || skipped.current) return;
    skipped.current = true;
    onDone(0);
  }, [unavailable, onDone]);

  if (insight.data) return <Insight insight={insight.data} onDone={onDone} />;

  return (
    <SceneLayout
      title={t("journey.understand.title")}
      footer={
        <Button variant="ghost" size="lg" className="ml-auto" onClick={() => onDone(0)}>
          {t("journey.understand.skip")}
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner className="size-7" />
        <p className="max-w-xs text-[0.9375rem] leading-relaxed text-fg-muted">
          {t("journey.understand.loading")}
        </p>
      </div>
    </SceneLayout>
  );
}

function Insight({
  insight,
  onDone,
}: {
  insight: JourneyInsight;
  onDone: (mistakes: number) => void;
}) {
  const t = useT();
  /** How many points are showing. The gist is there from the start. */
  const [shown, setShown] = useState(0);
  /** null while reading the points; then the question being asked. */
  const [asking, setAsking] = useState<number | null>(null);
  const mistakes = useRef(0);

  const allShown = shown >= insight.points.length;
  const latest = useRef<HTMLLIElement>(null);
  useEffect(() => {
    latest.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [shown]);

  if (asking !== null) {
    return (
      <Question
        // A new question starts clean.
        key={asking}
        insight={insight}
        at={asking}
        onAnswered={(wrong) => {
          mistakes.current += wrong;
          if (asking + 1 < insight.questions.length) setAsking(asking + 1);
          else onDone(mistakes.current);
        }}
      />
    );
  }

  return (
    <SceneLayout
      title={t("journey.understand.title")}
      hint={t("journey.understand.hint", { tafsir: insight.tafsirName })}
      className="justify-start"
      footer={
        allShown ? (
          <ContinueButton
            onClick={() => (insight.questions.length > 0 ? setAsking(0) : onDone(0))}
          />
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="journey-pulse ml-auto min-w-40"
            onClick={() => setShown((n) => n + 1)}
          >
            {t("journey.understand.nextPoint")}
          </Button>
        )
      }
    >
      <div className="mx-auto w-full max-w-xl space-y-3">
        {insight.gists.map((gist, i) => (
          <div
            key={i}
            className="journey-rise flex gap-3 rounded-2xl border border-border bg-surface p-4"
            style={{ "--i": i + 1 } as React.CSSProperties}
          >
            <BookOpenText className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            <p dir="auto" data-selectable className="text-[1.0625rem] leading-loose text-fg">
              {gist}
            </p>
          </div>
        ))}
        <ol className="space-y-3">
          {insight.points.slice(0, shown).map((point, i) => (
            <li
              key={i}
              ref={i === shown - 1 ? latest : undefined}
              className="journey-rise flex gap-3 rounded-2xl border border-gold/40 bg-gold-soft/50 p-4"
            >
              <Lightbulb className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
              <p dir="auto" data-selectable className="text-[1rem] leading-loose text-fg">
                {point}
              </p>
            </li>
          ))}
        </ol>
        {insight.points.length > 0 ? (
          <p className="text-center text-[0.8125rem] tabular-nums text-fg-subtle" aria-live="polite">
            {t("journey.hear.round", { current: shown, total: insight.points.length })}
          </p>
        ) : null}
      </div>
    </SceneLayout>
  );
}

function Question({
  insight,
  at,
  onAnswered,
}: {
  insight: JourneyInsight;
  at: number;
  onAnswered: (mistakes: number) => void;
}) {
  const t = useT();
  const item = insight.questions[at]!;
  // The wrong answers are the right answers to the lesson's other questions:
  // all true statements from the same tafsir, so nothing false is ever put in
  // front of the child, even as a decoy.
  const choices = useMemo(
    () =>
      insight.questions.length >= MIN_FOR_CHOICES
        ? shuffle(insight.questions.map((q, i) => ({ id: i, text: q.answer })))
        : null,
    [insight.questions],
  );
  const [states, setStates] = useState<Record<number, TileState>>({});
  const [solved, setSolved] = useState(false);
  const mistakes = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  const pick = (id: number) => {
    if (solved || states[id]) return;
    if (id === at) {
      setSolved(true);
      setStates(
        Object.fromEntries(
          (choices ?? []).map((c) => [c.id, c.id === at ? "correct" : "done"]),
        ) as Record<number, TileState>,
      );
      return;
    }
    mistakes.current += 1;
    setStates((current) => ({ ...current, [id]: "wrong" }));
    timers.current.push(
      window.setTimeout(
        () => setStates((current) => (current[id] === "wrong" ? { ...current, [id]: "done" } : current)),
        WRONG_MS,
      ),
    );
  };

  return (
    <SceneLayout
      title={t("journey.understand.questionTitle")}
      hint={choices ? t("journey.understand.questionHint") : t("journey.understand.thinkHint")}
      footer={
        <>
          <span className="text-[0.875rem] tabular-nums text-fg-subtle">
            {t("journey.hear.round", { current: at + 1, total: insight.questions.length })}
          </span>
          <ContinueButton onClick={() => onAnswered(mistakes.current)} disabled={!solved} />
        </>
      }
    >
      <div className="mx-auto w-full max-w-xl">
        <p
          dir="auto"
          className="journey-rise rounded-2xl border border-border bg-surface p-5 text-center text-[1.125rem] font-semibold leading-relaxed text-fg"
        >
          {item.question}
        </p>

        {choices ? (
          <div className="mt-5 space-y-3">
            {choices.map((choice, i) => (
              // The entrance animation sits on a wrapper: on the tile it would
              // replay each time the tile's own state animation ended.
              <div
                key={choice.id}
                className="journey-rise"
                style={{ "--i": i + 1 } as React.CSSProperties}
              >
                <Tile
                  state={states[choice.id]}
                  disabled={solved || states[choice.id] !== undefined}
                  onClick={() => pick(choice.id)}
                  className="w-full !justify-start px-4 py-3.5 text-start"
                >
                  <span dir="auto">{choice.text}</span>
                </Tile>
              </div>
            ))}
          </div>
        ) : solved ? (
          <p
            dir="auto"
            data-selectable
            className="journey-pop mt-5 rounded-2xl border border-success/50 bg-accent-soft p-5 text-center text-[1.0625rem] leading-relaxed text-accent-soft-fg"
          >
            {item.answer}
          </p>
        ) : (
          <div className="mt-6 flex justify-center">
            <Button variant="secondary" size="lg" onClick={() => setSolved(true)}>
              {t("journey.understand.showAnswer")}
            </Button>
          </div>
        )}
      </div>
    </SceneLayout>
  );
}
