/**
 * The four grades, with what each one costs.
 *
 * The buttons carry the interval they would buy, because without it the reader
 * is choosing between adjectives. "Hard" and "Good" are opinions about a word;
 * "6m" and "10d" are the thing actually being decided, and a reader who can
 * see both makes the choice the schedule needs rather than the one that sounds
 * most modest. The numbers come from the same function that will apply them,
 * so the label is a promise the write keeps.
 *
 * `again` sits apart from the other three, in the danger tone: it is the only
 * grade that fails, and the only one that throws an interval away.
 */
import { useEffect } from "react";
import { useT, useIntervalUnits } from "@/providers/I18nProvider";
import { formatInterval, REVIEW_GRADES, type ReviewGrade } from "@/lib/vocabulary";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/locales/en";

const LABELS: Record<ReviewGrade, TranslationKey> = {
  again: "quiz.gradeAgain",
  hard: "quiz.gradeHard",
  good: "quiz.gradeGood",
  easy: "quiz.gradeEasy",
};

export interface GradeIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export function GradeBar({
  intervals,
  onGrade,
  disabled,
}: {
  /** What each grade would schedule, in minutes from now. */
  intervals: GradeIntervals;
  onGrade: (grade: ReviewGrade) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const units = useIntervalUnits();

  // 1–4 across the row, and space for "good" — the grade that is right most of
  // the time, and the one Anki puts under the same key for the same reason.
  useEffect(() => {
    if (disabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " ") {
        event.preventDefault();
        onGrade("good");
        return;
      }
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < REVIEW_GRADES.length) {
        event.preventDefault();
        onGrade(REVIEW_GRADES[index]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onGrade, disabled]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {REVIEW_GRADES.map((grade) => (
          <button
            key={grade}
            type="button"
            disabled={disabled}
            onClick={() => onGrade(grade)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-xl border px-3 py-3 transition-colors",
              "disabled:pointer-events-none disabled:opacity-60",
              grade === "again"
                ? "border-danger/40 bg-danger-soft/40 text-danger-soft-fg hover:border-danger/70 hover:bg-danger-soft"
                : grade === "good"
                  ? "border-accent/50 bg-accent-soft/50 text-accent-soft-fg hover:border-accent hover:bg-accent-soft"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong hover:bg-surface-2 hover:text-fg",
            )}
          >
            <span className="text-sm font-medium">{t(LABELS[grade])}</span>
            <span className="text-[0.75rem] tabular-nums opacity-80">
              {formatInterval(intervals[grade], units)}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2.5 text-center text-[0.6875rem] text-fg-subtle">{t("quiz.gradeHint")}</p>
    </div>
  );
}
