import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GraduationCap, X, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useContentLanguage } from "@/hooks/useProfile";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { ProgressBar } from "@/components/ui/primitives";
import { cn, shuffle, verseKey } from "@/lib/utils";
import { Input, Field } from "@/components/ui/field";

interface QuizWord {
  word_id: number;
  arabic: string;
  transliteration: string | null;
  /** The answer, in whichever content language the round was drawn for. */
  gloss: string;
  status: "new" | "learning" | "learned";
  surah_number: number;
  ayah_number: number;
}

interface Question extends QuizWord {
  choices: string[];
}

export function Quiz() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const language = useContentLanguage();

  const [started, setStarted] = useState(false);
  const [limit, setLimit] = useState<number>(10);
  const [status, setStatus] = useState<"learning" | "learned" | "all">("all");
  const [surah, setSurah] = useState<number | "">("");
  const [ruku, setRuku] = useState<number | "">("");

  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState({ correct: 0, answered: 0 });
  const [finished, setFinished] = useState(false);

  const quiz = useQuery({
    queryKey: ["quiz-pool", user?.id, language, limit, status, surah, ruku],
    enabled: Boolean(user) && started,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<Question[]> => {
      const { data: pool, error } = await supabase.rpc("quiz_pool", {
        p_limit: limit,
        p_language: language,
        p_status: status === "all" ? undefined : status,
        p_surah: surah === "" ? undefined : surah,
        p_ruku: ruku === "" ? undefined : ruku,
      });
      if (error) throw error;
      const words = (pool ?? []) as QuizWord[];
      if (words.length === 0) return [];

      // One distractor request covers the whole round.
      const { data: distractors, error: distractorError } = await supabase.rpc(
        "quiz_distractors",
        { p_exclude: words.map((w) => w.gloss), p_limit: 10, p_language: language },
      );
      if (distractorError) throw distractorError;
      const pool2 = ((distractors ?? []) as Array<{ gloss: string }>).map((d) => d.gloss);

      return words.map((word) => {
        // Prefer other answers from this round as distractors — they're
        // Quranic vocabulary too, which makes the choice a real test.
        const others = words
          .filter((w) => w.word_id !== word.word_id && w.gloss !== word.gloss)
          .map((w) => w.gloss);
        const candidates = shuffle([...others, ...pool2]).slice(0, 3);
        return { ...word, choices: shuffle([word.gloss, ...candidates]) };
      });
    },
  });

  const record = useMutation({
    mutationFn: async ({ wordId, correct }: { wordId: number; correct: boolean }) => {
      const { error } = await supabase.rpc("record_quiz_attempt", {
        p_word_id: wordId,
        p_correct: correct,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vocabulary"] });
      queryClient.invalidateQueries({ queryKey: ["vocabulary-overview"] });
    },
  });

  const questions = quiz.data ?? [];
  const question = questions[index];

  const answer = useCallback(
    (choice: string) => {
      if (picked !== null || !question) return;
      const correct = choice === question.gloss;
      setPicked(choice);
      setScore((s) => ({ correct: s.correct + (correct ? 1 : 0), answered: s.answered + 1 }));
      record.mutate({ wordId: question.word_id, correct });
    },
    [picked, question, record],
  );

  const next = useCallback(() => {
    setPicked(null);
    if (index + 1 >= questions.length) setFinished(true);
    else setIndex((i) => i + 1);
  }, [index, questions.length]);

  // Keyboard play: 1-4 to answer, Enter to advance.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!started || finished || !question) return;
      if (picked === null) {
        const n = Number(event.key);
        if (n >= 1 && n <= question.choices.length) answer(question.choices[n - 1]!);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, next, picked, question, finished, started]);

  const restart = () => {
    setIndex(0);
    setPicked(null);
    setScore({ correct: 0, answered: 0 });
    setFinished(false);
    setStarted(false);
  };

  const accuracy = useMemo(
    () => (score.answered > 0 ? (score.correct / score.answered) * 100 : 0),
    [score],
  );

  if (!started) {
    return (
      <Page title="Quiz Configuration" description="Customize your next vocabulary quiz.">
        <Card>
          <CardBody className="pt-6 space-y-6">
            <Field label="Number of Questions">
              {({ id }) => (
                <select
                  id={id}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className={cn(
                    "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg",
                    "focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                  )}
                >
                  <option value={10}>10 Questions</option>
                  <option value={25}>25 Questions</option>
                  <option value={50}>50 Questions</option>
                </select>
              )}
            </Field>

            <Field label="Word Status">
              {({ id }) => (
                <select
                  id={id}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as any)}
                  className={cn(
                    "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg",
                    "focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
                  )}
                >
                  <option value="all">All Saved Words</option>
                  <option value="learning">Learning Only (Needs Practice)</option>
                  <option value="learned">Learned Only (Review)</option>
                </select>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Surah (Optional)" hint="Leave empty for all">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={114}
                    value={surah}
                    onChange={(e) => setSurah(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 2"
                  />
                )}
              </Field>

              <Field label="Ruku (Optional)" hint="Leave empty for all">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={600}
                    value={ruku}
                    onChange={(e) => setRuku(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 15"
                  />
                )}
              </Field>
            </div>

            <Button
              variant="primary"
              className="w-full"
              onClick={() => {
                setStarted(true);
                void quiz.refetch();
              }}
            >
              Start Quiz
            </Button>
          </CardBody>
        </Card>
      </Page>
    );
  }

  if (quiz.isLoading || quiz.isFetching) {
    return (
      <Page title="Quiz">
        <LoadingBlock label="Building your quiz…" />
      </Page>
    );
  }

  if (quiz.isError) {
    return (
      <Page title="Quiz">
        <Card>
          <EmptyState
            icon={<X className="size-5" />}
            title="Error loading quiz"
            description={String(quiz.error)}
            action={
              <Button variant="primary" onClick={() => setStarted(false)}>
                Back
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }

  if (questions.length === 0) {
    return (
      <Page title="Quiz">
        <Card>
          <EmptyState
            icon={<GraduationCap className="size-5" />}
            title="No words matched your criteria"
            description="Try adjusting your filters or go read to save more words."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => setStarted(false)}>
                  <Settings2 className="size-4" aria-hidden />
                  Adjust Filters
                </Button>
                <Button asChild variant="outline">
                  <Link to="/browse">Go read</Link>
                </Button>
              </div>
            }
          />
        </Card>
      </Page>
    );
  }

  if (finished) {
    return (
      <Page title="Quiz complete">
        <Card>
          <CardBody className="pt-6 text-center">
            <div className="text-5xl font-semibold tabular-nums text-fg">
              {score.correct}
              <span className="text-fg-subtle">/{score.answered}</span>
            </div>
            <p className="mt-2 text-sm text-fg-muted">
              {accuracy >= 80
                ? "Strong round. These words are sticking."
                : accuracy >= 50
                  ? "Solid progress — the misses will come back around sooner."
                  : "Worth another pass. Missed words are prioritised next time."}
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <Button variant="primary" onClick={restart}>
                <Settings2 className="size-4" aria-hidden />
                New Quiz
              </Button>
              <Button asChild variant="outline">
                <Link to="/vocabulary">Back to vocabulary</Link>
              </Button>
            </div>
          </CardBody>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Quiz" description="What does this word mean?">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-4">
          <ProgressBar value={((index + (picked ? 1 : 0)) / questions.length) * 100} />
          <span className="shrink-0 text-[0.8125rem] tabular-nums text-fg-subtle">
            {index + 1} / {questions.length}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setStarted(false)}>
          <Settings2 className="size-4 mr-1.5" />
          Settings
        </Button>
      </div>

      <Card>
        <CardBody className="pt-8">
          <div className="text-center">
            <div className="arabic text-fg" dir="rtl">
              {question!.arabic}
            </div>
            {question!.transliteration ? (
              <div className="mt-2 text-sm italic text-fg-subtle">
                {question!.transliteration}
              </div>
            ) : null}
            <div className="mt-1.5 text-[0.75rem] text-fg-subtle">
              {verseKey(question!.surah_number, question!.ayah_number)}
            </div>
          </div>

          <div className="mx-auto mt-8 grid max-w-md gap-2">
            {question!.choices.map((choice, i) => {
              const isCorrect = choice === question!.gloss;
              const isPicked = picked === choice;
              const reveal = picked !== null;

              return (
                <button
                  key={choice}
                  onClick={() => answer(choice)}
                  disabled={reveal}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                    !reveal && "border-border bg-surface hover:border-accent/40 hover:bg-surface-2",
                    reveal && isCorrect && "border-accent/50 bg-accent-soft/60 text-fg",
                    reveal && isPicked && !isCorrect && "border-danger/50 bg-danger-soft/60",
                    reveal && !isCorrect && !isPicked && "border-border opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-md text-[0.6875rem] font-medium",
                      reveal && isCorrect
                        ? "bg-accent text-accent-fg"
                        : reveal && isPicked
                          ? "bg-danger text-white"
                          : "bg-surface-2 text-fg-subtle",
                    )}
                  >
                    {reveal && isCorrect ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : reveal && isPicked ? (
                      <X className="size-3.5" aria-hidden />
                    ) : (
                      i + 1
                    )}
                  </span>
                  {choice}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-[0.75rem] text-fg-subtle">
              {picked === null ? "Press 1–4 to answer" : "Press Enter to continue"}
            </span>
            <Button variant="primary" onClick={next} disabled={picked === null}>
              {index + 1 >= questions.length ? "Finish" : "Next"}
            </Button>
          </div>
        </CardBody>
      </Card>
    </Page>
  );
}
