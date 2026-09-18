/**
 * How the reader is doing, across both quiz types.
 *
 * Three questions, in the order they are worth asking.
 *
 * *Am I getting better?* — accuracy over the last 30 days, with the all-time
 * figure beside it rather than in place of it. An all-time average is settled
 * by whatever happened in the first week and then stops moving, which is the
 * opposite of what a progress number is for.
 *
 * *Can I tell what I know?* — how often a claimed answer was conceded at the
 * reveal. This is not a knowledge measure and is not scored as one: it is the
 * reader's calibration, and it is the number that decides whether their own
 * sense of "I've got this ruku" can be trusted. Its mirror is shown too, since
 * being harsh with yourself reads identically in the accuracy figure and is a
 * completely different problem.
 *
 * *What should I go back to?* — which surahs and which kinds of question are
 * coming out worst. A single percentage tells a reader nothing they can act
 * on; "you cannot place ayahs in an-Nisāʾ" they can act on this evening.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, Library, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { KIND_LABELS, type KnowledgeQuestionKind } from "@/lib/knowledgeQuiz";
import { cn, formatPercent } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/primitives";

interface Scoreboard {
  vocab_attempts: number;
  vocab_correct: number;
  vocab_attempts_30d: number;
  vocab_correct_30d: number;
  vocab_overclaimed: number;
  vocab_recovered: number;
  words_learned: number;
  words_learning: number;
  knowledge_sessions: number;
  knowledge_answered: number;
  knowledge_correct: number;
  knowledge_answered_30d: number;
  knowledge_correct_30d: number;
  knowledge_overclaimed: number;
  knowledge_recovered: number;
  knowledge_by_kind: Array<{ kind: KnowledgeQuestionKind; answered: number; correct: number }>;
}

interface SurahScore {
  surah_number: number;
  surah_name: string;
  answered: number;
  correct: number;
}

/** Below this, a percentage is noise rather than a measurement. */
const ENOUGH_TO_JUDGE = 5;

export function Scoreboard() {
  const { user } = useAuth();

  const scores = useQuery({
    queryKey: ["quiz-scoreboard", user?.id],
    enabled: Boolean(user),
    staleTime: 30_000,
    queryFn: async (): Promise<Scoreboard | null> => {
      const { data, error } = await supabase.rpc("quiz_scoreboard");
      if (error) throw error;
      return ((data ?? [])[0] as unknown as Scoreboard) ?? null;
    },
  });

  const bySurah = useQuery({
    queryKey: ["knowledge-by-surah", user?.id],
    enabled: Boolean(user),
    staleTime: 30_000,
    queryFn: async (): Promise<SurahScore[]> => {
      const { data, error } = await supabase.rpc("knowledge_quiz_by_surah");
      if (error) throw error;
      return (data ?? []) as SurahScore[];
    },
  });

  const s = scores.data;
  if (!s) return null;

  const answeredTotal = s.vocab_attempts + s.knowledge_answered;
  // Nothing to report on is better said by saying nothing: an empty scoreboard
  // above the setup form is a wall of zeroes between the reader and the button
  // they came for.
  if (answeredTotal === 0) return null;

  const overclaimed = s.vocab_overclaimed + s.knowledge_overclaimed;
  const recovered = s.vocab_recovered + s.knowledge_recovered;
  const weakSurahs = (bySurah.data ?? []).filter((row) => row.answered >= ENOUGH_TO_JUDGE).slice(0, 4);
  const byKind = (s.knowledge_by_kind ?? []).filter((row) => row.answered >= ENOUGH_TO_JUDGE);

  return (
    <Card>
      <CardBody className="pt-5 space-y-5">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
          <TrendingUp className="size-3.5" aria-hidden />
          How you're doing
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreColumn
            icon={<Library className="size-3.5" aria-hidden />}
            title="Vocabulary"
            recent={{ correct: s.vocab_correct_30d, answered: s.vocab_attempts_30d }}
            allTime={{ correct: s.vocab_correct, answered: s.vocab_attempts }}
            footnote={`${s.words_learned} learned · ${s.words_learning} still learning`}
          />
          <ScoreColumn
            icon={<BrainCircuit className="size-3.5" aria-hidden />}
            title="Knowledge"
            recent={{ correct: s.knowledge_correct_30d, answered: s.knowledge_answered_30d }}
            allTime={{ correct: s.knowledge_correct, answered: s.knowledge_answered }}
            footnote={
              s.knowledge_sessions > 0
                ? `${s.knowledge_sessions} ${s.knowledge_sessions === 1 ? "round" : "rounds"} so far`
                : "No rounds yet"
            }
          />
        </div>

        {overclaimed + recovered > 0 ? (
          <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
            {overclaimed > 0 ? (
              <>
                You were sure of{" "}
                <span className="font-medium text-fg-muted">{overclaimed}</span>{" "}
                {overclaimed === 1 ? "answer" : "answers"} that turned out to be wrong
                {recovered > 0 ? ", " : ". "}
              </>
            ) : null}
            {recovered > 0 ? (
              <>
                {overclaimed > 0 ? "and gave up on " : "You gave up on "}
                <span className="font-medium text-fg-muted">{recovered}</span>{" "}
                {recovered === 1 ? "answer" : "answers"} you actually had.{" "}
              </>
            ) : null}
            {overclaimed > recovered * 2
              ? "Worth slowing down before you claim one."
              : recovered > overclaimed * 2
                ? "You know more than you're giving yourself credit for."
                : "Your sense of what you know is about right."}
          </p>
        ) : null}

        {byKind.length > 0 ? (
          <div>
            <p className="mb-2 text-[0.75rem] font-medium text-fg">By question type</p>
            <div className="space-y-2">
              {byKind.map((row) => (
                <ScoreBar
                  key={row.kind}
                  label={KIND_LABELS[row.kind]}
                  correct={row.correct}
                  answered={row.answered}
                />
              ))}
            </div>
          </div>
        ) : null}

        {weakSurahs.length > 0 ? (
          <div>
            <p className="mb-2 text-[0.75rem] font-medium text-fg">Weakest surahs</p>
            <div className="space-y-2">
              {weakSurahs.map((row) => (
                <ScoreBar
                  key={row.surah_number}
                  label={row.surah_name}
                  correct={row.correct}
                  answered={row.answered}
                />
              ))}
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function ScoreColumn({
  icon,
  title,
  recent,
  allTime,
  footnote,
}: {
  icon: ReactNode;
  title: string;
  recent: { correct: number; answered: number };
  allTime: { correct: number; answered: number };
  footnote: string;
}) {
  const shown = recent.answered > 0 ? recent : allTime;
  const label = recent.answered > 0 ? "last 30 days" : "all time";

  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4">
      <div className="flex items-center gap-1.5 text-[0.75rem] font-medium text-fg-muted">
        {icon}
        {title}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums text-fg">
          {shown.answered > 0 ? formatPercent((shown.correct / shown.answered) * 100, 0) : "—"}
        </span>
        <span className="text-[0.75rem] text-fg-subtle">
          {shown.answered > 0 ? `${shown.correct}/${shown.answered} ${label}` : "nothing yet"}
        </span>
      </div>
      {recent.answered > 0 && allTime.answered > recent.answered ? (
        <p className="mt-1 text-[0.75rem] text-fg-subtle">
          {formatPercent((allTime.correct / allTime.answered) * 100, 0)} all time ·{" "}
          {allTime.answered} answered
        </p>
      ) : null}
      <p className="mt-1 text-[0.75rem] text-fg-subtle">{footnote}</p>
    </div>
  );
}

function ScoreBar({
  label,
  correct,
  answered,
}: {
  label: string;
  correct: number;
  answered: number;
}) {
  const pct = answered > 0 ? (correct / answered) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-[0.75rem] text-fg-muted">{label}</span>
      <ProgressBar value={pct} tone={pct < 50 ? "gold" : "accent"} className="flex-1" />
      <span
        className={cn(
          "w-16 shrink-0 text-right text-[0.75rem] tabular-nums",
          pct < 50 ? "text-fg-muted" : "text-fg-subtle",
        )}
      >
        {formatPercent(pct, 0)}
      </span>
    </div>
  );
}
