/**
 * Claim, reveal, confirm — the answering step both quiz types share.
 *
 * A reader who is asked "do you know this?" and believed is being scored on
 * confidence, which is the one thing a memorizer judges worst. Being sure of a
 * word and having it right are different states, and the gap between them is
 * where revision actually belongs.
 *
 * So an answer is given twice. The reader claims first, with nothing revealed;
 * the answer is then shown whichever way they claimed — a claim is not a reason
 * to skip the text, it is a reason to check it — and they are asked again,
 * against what they can now see. The second answer is what scores. The first is
 * kept, because a claim withdrawn at the reveal is worth counting separately
 * from an answer never claimed at all.
 *
 * The confirmation starts on the claim rather than on nothing: the common case
 * is that the reader was right about being right, and making them say so twice
 * in two different words would turn the check into a rhythm they stop reading.
 * Flipping it is one click, and the round is built so that flipping it is
 * expected rather than an admission.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import { Button } from "@/components/ui/button";

export interface SelfAssessResult {
  /** What the reader said before the answer was shown. */
  claimed: boolean;
  /** What they confirmed after seeing it. This is the one that counts. */
  correct: boolean;
}

interface SelfAssessProps {
  /** Resets the control when it changes: a new question, a new claim. */
  questionKey: string | number;
  /** The question put to the reader before anything is revealed. */
  prompt: string;
  /** Both default to the vocabulary round's wording, which is the shorter one. */
  knowLabel?: string;
  dontKnowLabel?: string;
  /** Rendered once the reader has claimed, whichever way they claimed. */
  children: ReactNode;
  /**
   * Fired on the claim, and again on every change of the confirmation. Callers
   * record it each time; the write is an upsert, so the last one wins.
   */
  onAnswer: (result: SelfAssessResult) => void;
  onNext: () => void;
  nextLabel: string;
}

export function SelfAssess({
  questionKey,
  prompt,
  knowLabel,
  dontKnowLabel,
  children,
  onAnswer,
  onNext,
  nextLabel,
}: SelfAssessProps) {
  const t = useT();
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);

  useEffect(() => {
    setClaimed(null);
    setCorrect(null);
  }, [questionKey]);

  const claim = useCallback(
    (value: boolean) => {
      if (claimed !== null) return;
      setClaimed(value);
      setCorrect(value);
      onAnswer({ claimed: value, correct: value });
    },
    [claimed, onAnswer],
  );

  const confirm = useCallback(
    (value: boolean) => {
      if (claimed === null || value === correct) return;
      setCorrect(value);
      onAnswer({ claimed, correct: value });
    },
    [claimed, correct, onAnswer],
  );

  // Y/N answer both questions in turn, so the keyboard rhythm does not change
  // when the control does. Enter moves on, and only once something is claimed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (claimed === null) {
        if (key === "1" || key === "y") claim(true);
        else if (key === "2" || key === "n") claim(false);
        return;
      }
      if (key === "enter") {
        event.preventDefault();
        onNext();
      } else if (key === "y" || key === "1") confirm(true);
      else if (key === "n" || key === "2") confirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [claim, confirm, claimed, onNext]);

  if (claimed === null) {
    return (
      <>
        <p className="mt-7 text-center text-[0.8125rem] text-fg-subtle">{prompt}</p>
        <div className="mx-auto mt-3 grid max-w-md gap-2 sm:grid-cols-2">
          <button
            onClick={() => claim(true)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-medium transition-colors",
              "border-accent/50 bg-accent-soft/50 text-accent-soft-fg",
              "hover:border-accent hover:bg-accent-soft",
            )}
          >
            <Check className="size-4" aria-hidden />
            {knowLabel ?? t("quiz.iKnowIt")}
          </button>
          <button
            onClick={() => claim(false)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-medium transition-colors",
              "border-border bg-surface text-fg-muted",
              "hover:border-border-strong hover:bg-surface-2 hover:text-fg",
            )}
          >
            <X className="size-4" aria-hidden />
            {dontKnowLabel ?? t("quiz.iDontKnow")}
          </button>
        </div>
        <p className="mt-3 text-center text-[0.6875rem] text-fg-subtle">{t("quiz.keyHint")}</p>
      </>
    );
  }

  return (
    <div className="mt-7 animate-fade-in">
      {children}

      <div className="mt-5 rounded-xl border border-border bg-surface-2/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-medium text-fg">
              {claimed ? t("quiz.wereYouRight") : t("quiz.didYouHaveIt")}
            </p>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              {claimed ? t("quiz.wereYouRightHint") : t("quiz.didYouHaveItHint")}
            </p>
          </div>
          <div
            role="group"
            aria-label={t("quiz.wereYouRight")}
            className="flex shrink-0 gap-1 rounded-lg border border-border bg-surface p-1"
          >
            <ConfirmButton selected={correct === true} tone="yes" onClick={() => confirm(true)}>
              {t("quiz.yes")}
            </ConfirmButton>
            <ConfirmButton selected={correct === false} tone="no" onClick={() => confirm(false)}>
              {t("quiz.no")}
            </ConfirmButton>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[0.75rem] text-fg-subtle">
          {correct ? t("quiz.countedKnown") : t("quiz.countedMissed")}
        </span>
        <Button variant="primary" onClick={onNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}

function ConfirmButton({
  selected,
  tone,
  onClick,
  children,
}: {
  selected: boolean;
  tone: "yes" | "no";
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "min-w-16 rounded-md px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
        !selected && "text-fg-subtle hover:bg-surface-2 hover:text-fg",
        selected && tone === "yes" && "bg-accent-soft text-accent-soft-fg",
        selected && tone === "no" && "bg-danger-soft text-danger-soft-fg",
      )}
    >
      {children}
    </button>
  );
}
