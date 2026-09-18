/**
 * The knowledge round: questions about the passage, written for this round.
 *
 * The vocabulary round can only ask what a word means, because that is what
 * the table holds. What a memorizer actually wants tested is the passage —
 * which ayah says a thing, which word carried a meaning, what follows a
 * phrase — and those questions have to be written, not queried. So the app
 * draws ayahs from the scope and the model writes one question per ayah.
 *
 * The ayah is shown with every answer, always. The reader is marking
 * themselves against scripture, not against the model, and a generated answer
 * that drifted from the text should be visibly wrong rather than quietly
 * authoritative. Where the model cited a phrase, that phrase is highlighted in
 * the ayah — the backend has already dropped any citation that was not
 * literally there.
 *
 * Questions are generated per round rather than cached: a second round on the
 * same ruku should not be the same ten questions, and there is nothing to
 * share between users, since what makes a question worth asking is which ayahs
 * this reader has memorized.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Settings2, Sparkles, WandSparkles, X } from "lucide-react";
import { describeAiError } from "@/lib/ai";
import { useAuth } from "@/providers/AuthProvider";
import { useContentLanguage } from "@/hooks/useProfile";
import { verseTranslation } from "@/lib/language";
import {
  drawVerses,
  finishSession,
  generateQuestions,
  recordAnswer,
  startSession,
  KIND_LABELS,
  type KnowledgeQuestion,
} from "@/lib/knowledgeQuiz";
import { verseKey } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { SelfAssess, type SelfAssessResult } from "./SelfAssess";
import { HighlightedArabic, RoundHeader, RoundSummary, type RoundConfig } from "./round";

interface BuiltRound {
  sessionId: string;
  questions: KnowledgeQuestion[];
}

export function KnowledgeRound({
  config,
  onSetup,
}: {
  config: RoundConfig;
  onSetup: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const language = useContentLanguage();

  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<SelfAssessResult | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [revisedCount, setRevisedCount] = useState(0);
  const [missed, setMissed] = useState<KnowledgeQuestion[]>([]);
  const [done, setDone] = useState(false);

  /**
   * Building the round is three steps — draw the ayahs, generate the
   * questions, open the session — and they are one query because the reader is
   * waiting on all three and can act on none of them separately. The session
   * is opened last, after generation has succeeded, so a failed generation
   * leaves no empty round in the history.
   */
  const round = useQuery({
    queryKey: ["knowledge-round", user?.id, language, config.scope, config.surah, config.ruku, config.limit, config.seed],
    enabled: Boolean(user),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<BuiltRound> => {
      const verses = await drawVerses({
        scope: config.scope,
        limit: config.limit,
        language,
        surah: config.surah,
        ruku: config.ruku,
      });
      if (verses.length === 0) return { sessionId: "", questions: [] };

      const generated = await generateQuestions(verses, language);
      if (generated.questions.length === 0) return { sessionId: "", questions: [] };

      const sessionId = await startSession({
        scope: config.scope,
        questionCount: generated.questions.length,
        language,
        surah: config.surah,
        ruku: config.ruku,
        model: generated.modelUsed,
      });
      return { sessionId, questions: generated.questions };
    },
  });

  const questions = round.data?.questions ?? [];
  const sessionId = round.data?.sessionId ?? "";
  const question = questions[index];

  const record = useMutation({
    mutationFn: (input: { position: number; question: KnowledgeQuestion } & SelfAssessResult) =>
      recordAnswer({
        sessionId,
        position: input.position,
        question: input.question,
        claimed: input.claimed,
        correct: input.correct,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quiz-scoreboard"] }),
  });

  // Closing the round is a separate write from the last answer, so a round
  // abandoned half way still keeps the answers it did get.
  const closed = useRef(false);
  useEffect(() => {
    if (!done || closed.current || !sessionId) return;
    closed.current = true;
    void finishSession(sessionId).then(() => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-history"] });
      queryClient.invalidateQueries({ queryKey: ["quiz-scoreboard"] });
    });
  }, [done, sessionId, queryClient]);

  const next = useCallback(() => {
    if (!question || !answer) return;
    record.mutate({ position: index, question, ...answer });
    if (answer.correct) setCorrectCount((n) => n + 1);
    else setMissed((list) => [...list, question]);
    if (answer.claimed !== answer.correct) setRevisedCount((n) => n + 1);

    setAnswer(null);
    if (index + 1 >= questions.length) setDone(true);
    else setIndex(index + 1);
  }, [answer, index, question, questions.length, record]);

  if (round.isPending) {
    return (
      <Card>
        <CardBody className="py-14">
          <div className="flex flex-col items-center gap-3 text-center">
            <Spinner className="size-6" />
            <p className="text-sm font-medium text-fg">Writing your questions…</p>
            <p className="max-w-sm text-[0.8125rem] text-fg-subtle">
              {config.limit} ayahs from this scope are going to the model, one question each.
              This takes a few seconds.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  if (round.isError) {
    return (
      <Card>
        <EmptyState
          icon={<X className="size-5" />}
          title="Couldn't write the questions"
          description={describeAiError(round.error)}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => round.refetch()}>
                <RotateCcw className="size-4" aria-hidden />
                Try again
              </Button>
              <Button variant="outline" onClick={onSetup}>
                Back to setup
              </Button>
              <Button asChild variant="ghost">
                <Link to="/settings">AI settings</Link>
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  if (questions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<WandSparkles className="size-5" />}
          title="Nothing to ask about yet"
          description={
            config.scope === "surah"
              ? "This surah has no memorized ayahs yet. Mark some as memorized while reading, then come back."
              : config.scope === "ruku"
                ? "That ruku has no ayahs with a translation to build questions from."
                : "Nothing memorized yet — mark ayahs as memorized while reading, then come back."
          }
          action={
            <div className="flex gap-2">
              <Button variant="primary" onClick={onSetup}>
                <Settings2 className="size-4" aria-hidden />
                Change scope
              </Button>
              <Button asChild variant="outline">
                <Link to="/browse">Go read</Link>
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  if (done) {
    return (
      <RoundSummary
        correct={correctCount}
        answered={questions.length}
        revised={revisedCount}
        note="You can be asked about this passage."
        actions={
          <>
            <Button variant="primary" onClick={onSetup}>
              <RotateCcw className="size-4" aria-hidden />
              New round
            </Button>
            {config.scope === "ruku" && config.ruku !== null ? (
              <Button asChild variant="ghost">
                <Link to={`/read/${config.ruku}`}>Back to the ruku</Link>
              </Button>
            ) : null}
          </>
        }
      >
        {missed.length > 0 ? (
          <>
            <p className="text-[0.8125rem] font-medium text-fg">Ayahs to go back to</p>
            <ul className="mt-3 divide-y divide-border">
              {missed.map((item) => (
                <li key={`${item.verse_id}-${item.question}`} className="py-2.5">
                  <div className="flex items-baseline gap-3">
                    <span className="min-w-0 flex-1 text-[0.8125rem] text-fg-muted">
                      {item.question}
                    </span>
                    <span className="shrink-0 text-[0.75rem] tabular-nums text-fg-subtle">
                      {verseKey(item.verse.surah_number, item.verse.ayah_number)}
                    </span>
                  </div>
                  <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
                    {item.answer}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </RoundSummary>
    );
  }

  const translation = verseTranslation(question!.verse, language);

  return (
    <>
      <RoundHeader
        index={index}
        total={questions.length}
        answered={answer !== null}
        onSetup={onSetup}
      />

      <Card>
        <CardBody className="pt-7">
          <div className="flex items-center justify-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
            <Sparkles className="size-3" aria-hidden />
            {KIND_LABELS[question!.kind]}
          </div>
          <p className="mx-auto mt-3 max-w-xl text-center text-[1.0625rem] leading-relaxed text-fg">
            {question!.question}
          </p>

          <SelfAssess
            questionKey={`${question!.verse_id}-${index}`}
            prompt="Do you know the answer?"
            knowLabel="I know the answer"
            dontKnowLabel="I don't know"
            onAnswer={setAnswer}
            onNext={next}
            nextLabel={index + 1 >= questions.length ? "Finish" : "Next"}
          >
            <div className="rounded-xl border border-border bg-surface-2/50 p-4">
              <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                The answer
              </p>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed font-medium text-fg">
                {question!.answer}
              </p>

              <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                {question!.verse.surah_name} ·{" "}
                {verseKey(question!.verse.surah_number, question!.verse.ayah_number)}
              </p>
              <p className="arabic mt-2 text-fg" dir="rtl">
                <HighlightedArabic
                  text={question!.verse.arabic_text}
                  mark={question!.evidence}
                />
              </p>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-muted">{translation}</p>
            </div>
          </SelfAssess>
        </CardBody>
      </Card>
    </>
  );
}
