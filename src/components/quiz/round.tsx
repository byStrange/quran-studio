/**
 * The parts a round is the same in whichever quiz it is: what was asked for,
 * the progress strip above the question, and the scorecard at the end.
 *
 * Both quiz types answer the same way and are scored the same way, so they
 * report the same way too. A reader switching between them should not have to
 * re-learn where the count is.
 */
import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { QuizScope } from "@/lib/types";
import { useT, type TFunction } from "@/providers/I18nProvider";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/primitives";

/** What a reader asked for. `seed` is what makes "start again" draw again. */
export interface RoundConfig {
  scope: QuizScope;
  surah: number | null;
  ruku: number | null;
  limit: number;
  seed: number;
}

export function RoundHeader({
  index,
  total,
  answered,
  onSetup,
}: {
  index: number;
  total: number;
  /**
   * Whether the current question has been answered far enough for the bar to
   * move: claimed, in the comprehension round, or turned over in the
   * vocabulary one.
   */
  answered: boolean;
  onSetup: () => void;
}) {
  const t = useT();
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <div className="flex flex-1 items-center gap-4">
        <ProgressBar value={((index + (answered ? 1 : 0)) / Math.max(1, total)) * 100} />
        <span className="shrink-0 text-[0.8125rem] tabular-nums text-fg-subtle">
          {t("quiz.progress", { index: index + 1, total })}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={onSetup}>
        <Settings2 className="size-4 mr-1.5" />
        {t("quiz.setup")}
      </Button>
    </div>
  );
}

/**
 * The end of a round.
 *
 * `revised` is shown whenever it is non-zero, and phrased as a good thing,
 * because it is: an answer the reader claimed and then conceded is the round
 * doing exactly what the confirm step is for. Hiding it would quietly teach
 * them to claim everything.
 *
 * The three verdicts arrive already translated rather than as a stem this
 * composes with a per-round note. Composing them meant lower-casing the note's
 * first letter to graft it onto "Solid progress — ", which is an English
 * sentence habit: Russian and Uzbek want their own whole sentence, and a round
 * type's verdict is three strings a translator can read, not a joint.
 */
export function RoundSummary({
  correct,
  answered,
  revised,
  verdicts,
  children,
  actions,
}: {
  correct: number;
  answered: number;
  revised: number;
  /** Already translated: the round type supplies its own three sentences. */
  verdicts: { strong: string; solid: string; weak: string };
  children?: ReactNode;
  actions: ReactNode;
}) {
  const t = useT();
  const accuracy = answered > 0 ? (correct / answered) * 100 : 0;

  return (
    <Card>
      <CardBody className="pt-6">
        <div className="text-center">
          <div className="text-5xl font-semibold tabular-nums text-fg">
            {correct}
            <span className="text-fg-subtle">/{answered}</span>
          </div>
          <p className="mt-2 text-sm text-fg-muted">
            {accuracy >= 80 ? verdicts.strong : accuracy >= 50 ? verdicts.solid : verdicts.weak}
          </p>
          {revised > 0 ? (
            <p className="mt-2 text-[0.75rem] text-fg-subtle">
              {t("quiz.revised", { count: revised })}
            </p>
          ) : null}
        </div>

        {children ? <div className="mt-6 border-t border-border pt-5">{children}</div> : null}

        <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      </CardBody>
    </Card>
  );
}

/** Where the scope picker's choice is spelled out for a round in progress. */
export function scopeLabel(
  t: TFunction,
  config: Pick<RoundConfig, "scope" | "surah" | "ruku">,
  surahName: string | undefined,
): string {
  if (config.scope === "due") return t("quiz.scopeDue");
  if (config.scope === "ruku") return t("browse.rukuLabel", { number: config.ruku ?? "" }).trim();
  if (config.scope === "surah") return surahName ?? t("quiz.surah");
  return t("quiz.allMemorized");
}

/**
 * Arabic with one stretch of it picked out.
 *
 * `mark` has to be a literal substring of `text` — the vocabulary round passes
 * a word cut from the verse during seeding, and the knowledge round passes
 * evidence the backend already checked appears verbatim. When it isn't one
 * (a word normalised during import), the text still renders, just without the
 * emphasis: failing to highlight is fine, rendering the ayah wrong is not.
 */
export function HighlightedArabic({ text, mark }: { text: string; mark: string }) {
  const parts = mark && text.includes(mark) ? text.split(mark) : null;
  if (!parts) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <mark className="rounded bg-accent-soft px-0.5 text-accent-soft-fg">{mark}</mark>
          ) : null}
        </span>
      ))}
    </>
  );
}
