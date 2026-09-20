/**
 * The vocabulary round: one card at a time, answered from memory and graded.
 *
 * The front is the Arabic and nothing else. There is no "do you know it?" to
 * answer first — a claim made before the reveal only ever measured confidence,
 * and the grade after the reveal measures the same thing better, because by
 * then the reader can see what they were claiming about. So: show the word,
 * turn it over, say how it went.
 *
 * "How it went" is four answers rather than two, and that is the whole point
 * of the round. A boolean could only put a word on or off a list, so the only
 * schedule it could support was "missed words first" — which in a ten-card
 * round means the four you just failed are the first four you see next, while
 * you still remember failing them. A grade buys an interval instead: minutes
 * after a lapse, a day once it graduates, then weeks. The intervals are drawn
 * on the buttons, so the choice is between consequences rather than adjectives.
 *
 * A grade also advances the card. There is no confirm step and no Next button,
 * because the grade *is* the answer and asking for a second click after it is
 * how a review session stops being one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, GraduationCap, Repeat2, RotateCcw, Settings2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage, useT, useIntervalUnits } from "@/providers/I18nProvider";
import { verseTranslation } from "@/lib/language";
import { formatInterval, gradePassed, isDue, minutesUntil, type ReviewGrade } from "@/lib/vocabulary";
import type { WordStatus } from "@/lib/types";
import { verseKey } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { GradeBar } from "./GradeBar";
import { HighlightedArabic, RoundHeader, RoundSummary, type RoundConfig } from "./round";

/** One card as the round drew it: the word, its ayah, and its schedule. */
interface QuizWord {
  word_id: number;
  arabic: string;
  transliteration: string | null;
  gloss: string;
  status: WordStatus;
  tracked: boolean;
  surah_number: number;
  ayah_number: number;
  ruku_number: number;
  verse_id: number;
  verse_arabic: string;
  translation_en: string;
  translation_ru: string;
  translation_uz: string;
  ease: number;
  interval_days: number;
  reps: number;
  due_at: string | null;
  next_again_minutes: number;
  next_hard_minutes: number;
  next_good_minutes: number;
  next_easy_minutes: number;
  pool_size: number;
  due_count: number;
}

export function VocabularyRound({
  config,
  onSetup,
}: {
  config: RoundConfig;
  onSetup: () => void;
}) {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const language = useLanguage();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [missed, setMissed] = useState<QuizWord[]>([]);
  const [done, setDone] = useState(false);
  /** A round rebuilt from the cards failed in the previous one, bypassing the draw. */
  const [custom, setCustom] = useState<QuizWord[] | null>(null);

  const round = useQuery({
    queryKey: ["quiz-round", user?.id, language, config.scope, config.surah, config.ruku, config.limit, config.seed],
    enabled: Boolean(user) && custom === null,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<QuizWord[]> => {
      const { data, error } = await supabase.rpc("quiz_pool", {
        p_scope: config.scope,
        p_limit: config.limit,
        p_language: language,
        p_surah: config.scope === "surah" ? (config.surah ?? undefined) : undefined,
        p_ruku: config.scope === "ruku" ? (config.ruku ?? undefined) : undefined,
      });
      if (error) throw error;
      return (data ?? []) as QuizWord[];
    },
  });

  const record = useMutation({
    mutationFn: async (input: { wordId: number; grade: ReviewGrade }) => {
      const { error } = await supabase.rpc("record_vocab_review", {
        p_word_id: input.wordId,
        p_grade: input.grade,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of [
        "vocabulary",
        "vocabulary-overview",
        "word-progress",
        "ruku-word-stats",
        "ruku-progress",
        "quiz-scoreboard",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const questions = custom ?? round.data ?? [];
  const question = questions[index];

  const grade = useCallback(
    (value: ReviewGrade) => {
      if (!question) return;
      record.mutate({ wordId: question.word_id, grade: value });
      if (gradePassed(value)) setCorrectCount((n) => n + 1);
      else setMissed((words) => [...words, question]);

      setRevealed(false);
      if (index + 1 >= questions.length) setDone(true);
      else setIndex(index + 1);
    },
    [index, question, questions.length, record],
  );

  const reset = (words: QuizWord[] | null) => {
    setCustom(words);
    setIndex(0);
    setRevealed(false);
    setCorrectCount(0);
    setMissed([]);
    setDone(false);
  };

  useEffect(() => {
    if (revealed || done) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, done]);

  const intervals = useMemo(
    () =>
      question
        ? {
            again: question.next_again_minutes,
            hard: question.next_hard_minutes,
            good: question.next_good_minutes,
            easy: question.next_easy_minutes,
          }
        : { again: 0, hard: 0, good: 0, easy: 0 },
    [question],
  );

  if (round.isError) {
    return (
      <Card>
        <EmptyState
          icon={<X className="size-5" />}
          title={t("quiz.buildFailed")}
          description={String(round.error)}
          action={
            <Button variant="primary" onClick={onSetup}>
              {t("quiz.backToSetup")}
            </Button>
          }
        />
      </Card>
    );
  }

  if (round.isPending && custom === null) return <LoadingBlock label={t("quiz.drawing")} />;

  if (questions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title={config.scope === "due" ? t("quiz.nothingDue") : t("quiz.emptyScope")}
          description={
            config.scope === "due"
              ? t("quiz.nothingDueDescription")
              : config.scope === "global"
                ? t("quiz.emptyDescription")
                : t("quiz.emptyScopeDescription")
          }
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={onSetup}>
                <Settings2 className="size-4" aria-hidden />
                {t("quiz.changeScope")}
              </Button>
              <Button asChild variant="outline">
                <Link to="/browse">{t("quiz.goRead")}</Link>
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  if (done) {
    const answered = questions.length;
    return (
      <RoundSummary
        correct={correctCount}
        answered={answered}
        revised={0}
        verdicts={{
          strong: t("quiz.verdictStrong"),
          solid: t("quiz.verdictSolid"),
          weak: t("quiz.verdictWeak"),
        }}
        actions={
          <>
            {missed.length > 0 ? (
              <Button variant="primary" onClick={() => reset(missed)}>
                <Repeat2 className="size-4" aria-hidden />
                {t("quiz.practiseMissed", { count: missed.length })}
              </Button>
            ) : null}
            <Button variant={missed.length > 0 ? "outline" : "primary"} onClick={onSetup}>
              <RotateCcw className="size-4" aria-hidden />
              {t("quiz.newRound")}
            </Button>
            {config.scope === "ruku" && config.ruku !== null ? (
              <Button asChild variant="ghost">
                <Link to={`/read/${config.ruku}`}>{t("quiz.backToRuku")}</Link>
              </Button>
            ) : (
              <Button asChild variant="ghost">
                <Link to="/vocabulary">{t("vocab.title")}</Link>
              </Button>
            )}
          </>
        }
      >
        {missed.length > 0 ? (
          <>
            <p className="text-[0.8125rem] font-medium text-fg">{t("quiz.wordsToRevisit")}</p>
            <ul className="mt-3 divide-y divide-border">
              {missed.map((word) => (
                <li key={word.word_id} className="flex items-baseline gap-3 py-2">
                  <span className="arabic-sm shrink-0 text-fg" dir="rtl">
                    {word.arabic}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-fg-muted">
                    {word.gloss}
                  </span>
                  <span className="shrink-0 text-[0.75rem] tabular-nums text-fg-subtle">
                    {verseKey(word.surah_number, word.ayah_number)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </RoundSummary>
    );
  }

  const translation = verseTranslation(
    {
      translation_en: question!.translation_en,
      translation_ru: question!.translation_ru,
      translation_uz: question!.translation_uz,
    },
    language,
  );

  return (
    <>
      <RoundHeader
        index={index}
        total={questions.length}
        answered={revealed}
        onSetup={onSetup}
      />

      <Card>
        <CardBody className="pt-8">
          <div className="text-center">
            <div className="arabic text-fg" dir="rtl">
              {question!.arabic}
            </div>
            {question!.transliteration ? (
              <div className="mt-2 text-sm italic text-fg-subtle">{question!.transliteration}</div>
            ) : null}
            <div className="mt-1.5 flex items-center justify-center gap-2 text-[0.75rem] text-fg-subtle">
              <span className="tabular-nums">
                {verseKey(question!.surah_number, question!.ayah_number)}
              </span>
              <CardState word={question!} />
            </div>
          </div>

          {!revealed ? (
            <div className="mx-auto mt-8 max-w-md">
              <Button variant="primary" className="w-full" onClick={() => setRevealed(true)}>
                <Eye className="size-4" aria-hidden />
                {t("quiz.showAnswer")}
              </Button>
              <p className="mt-3 text-center text-[0.6875rem] text-fg-subtle">
                {t("quiz.showAnswerHint")}
              </p>
            </div>
          ) : (
            <div className="mt-7 animate-fade-in">
              <div className="rounded-xl border border-border bg-surface-2/50 p-4">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                  {t("quiz.itMeans")}
                </p>
                <p className="mt-1.5 text-[0.9375rem] font-medium text-fg">{question!.gloss}</p>

                <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                  {t("quiz.inContext", {
                    reference: verseKey(question!.surah_number, question!.ayah_number),
                  })}
                </p>
                <p className="arabic mt-2 text-fg" dir="rtl">
                  <HighlightedArabic text={question!.verse_arabic} mark={question!.arabic} />
                </p>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-muted">{translation}</p>
              </div>

              <p className="mt-5 text-center text-[0.8125rem] text-fg-subtle">
                {t("quiz.howDidItGo")}
              </p>
              <div className="mt-3">
                <GradeBar intervals={intervals} onGrade={grade} />
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

/**
 * Where this card stands before it is answered — new, waiting, or ahead of
 * schedule. One line, and only when it says something: a word being asked for
 * the first time is a different kind of question from one coming back after
 * three weeks, and the reader grades them differently once they know which is
 * which.
 */
function CardState({ word }: { word: QuizWord }) {
  const t = useT();
  const units = useIntervalUnits();

  if (!word.tracked) {
    return <span className="rounded-full bg-surface-2 px-2 py-0.5">{t("quiz.cardNew")}</span>;
  }
  if (isDue(word.due_at)) {
    return (
      <span className="rounded-full bg-gold-soft/60 px-2 py-0.5 text-fg-muted">
        {t("quiz.cardDue")}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-2 px-2 py-0.5">
      {t("quiz.cardAhead", {
        interval: formatInterval(minutesUntil(word.due_at) ?? 0, units),
      })}
    </span>
  );
}
