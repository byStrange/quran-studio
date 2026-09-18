/**
 * The vocabulary round: one word at a time, answered from memory.
 *
 * There are no options to pick between, because four answers drawn from the
 * same glossary can be narrowed down without knowing the word — that tested
 * elimination rather than vocabulary. The reader claims, the gloss and the
 * ayah it was used in are shown, and they confirm against them; see
 * `SelfAssess` for why the answer is given twice.
 *
 * What is written down is the confirmation, not the claim: knowing a word
 * marks it learned, missing it marks it learning, including from learned,
 * which is the whole point of coming back to a word you once knew.
 */
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Repeat2, RotateCcw, Settings2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useContentLanguage } from "@/hooks/useProfile";
import { verseTranslation } from "@/lib/language";
import type { WordStatus } from "@/lib/types";
import { verseKey } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { SelfAssess, type SelfAssessResult } from "./SelfAssess";
import { HighlightedArabic, RoundHeader, RoundSummary, type RoundConfig } from "./round";

/** One word as the round drew it, with the ayah it came from. */
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
  pool_size: number;
}

export function VocabularyRound({
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
  const [missed, setMissed] = useState<QuizWord[]>([]);
  const [done, setDone] = useState(false);
  /** A round rebuilt from the words missed in the previous one, bypassing the draw. */
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
    mutationFn: async (input: { wordId: number; claimed: boolean; correct: boolean }) => {
      const { error } = await supabase.rpc("record_quiz_attempt", {
        p_word_id: input.wordId,
        p_correct: input.correct,
        p_claimed: input.claimed,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of ["vocabulary", "vocabulary-overview", "word-progress", "ruku-word-stats", "quiz-scoreboard"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const questions = custom ?? round.data ?? [];
  const question = questions[index];

  // Written down on the way out of a question rather than on the claim: the
  // reader is still allowed to change the answer until they move on, and one
  // question should leave one attempt behind, not one per change of mind.
  const next = useCallback(() => {
    if (!question || !answer) return;
    record.mutate({ wordId: question.word_id, claimed: answer.claimed, correct: answer.correct });
    if (answer.correct) setCorrectCount((n) => n + 1);
    else setMissed((words) => [...words, question]);
    if (answer.claimed !== answer.correct) setRevisedCount((n) => n + 1);

    setAnswer(null);
    if (index + 1 >= questions.length) setDone(true);
    else setIndex(index + 1);
  }, [answer, index, question, questions.length, record]);

  const reset = (words: QuizWord[] | null) => {
    setCustom(words);
    setIndex(0);
    setAnswer(null);
    setCorrectCount(0);
    setRevisedCount(0);
    setMissed([]);
    setDone(false);
  };

  if (round.isError) {
    return (
      <Card>
        <EmptyState
          icon={<X className="size-5" />}
          title="Couldn't build the round"
          description={String(round.error)}
          action={
            <Button variant="primary" onClick={onSetup}>
              Back to setup
            </Button>
          }
        />
      </Card>
    );
  }

  if (round.isPending && custom === null) return <LoadingBlock label="Drawing words…" />;

  if (questions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<GraduationCap className="size-5" />}
          title="No words in this scope"
          description={
            config.scope === "surah"
              ? "This surah has no memorized ayahs yet. Mark some as memorized while reading, then come back."
              : "Nothing here to quiz yet — read a ruku and mark its ayahs as memorized."
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
    const answered = questions.length;
    return (
      <RoundSummary
        correct={correctCount}
        answered={answered}
        revised={revisedCount}
        note="These words are sticking."
        actions={
          <>
            {missed.length > 0 ? (
              <Button variant="primary" onClick={() => reset(missed)}>
                <Repeat2 className="size-4" aria-hidden />
                Practise {missed.length} missed {missed.length === 1 ? "word" : "words"}
              </Button>
            ) : null}
            <Button variant={missed.length > 0 ? "outline" : "primary"} onClick={onSetup}>
              <RotateCcw className="size-4" aria-hidden />
              New round
            </Button>
            {config.scope === "ruku" && config.ruku !== null ? (
              <Button asChild variant="ghost">
                <Link to={`/read/${config.ruku}`}>Back to the ruku</Link>
              </Button>
            ) : (
              <Button asChild variant="ghost">
                <Link to="/vocabulary">Vocabulary</Link>
              </Button>
            )}
          </>
        }
      >
        {missed.length > 0 ? (
          <>
            <p className="text-[0.8125rem] font-medium text-fg">Words to look at again</p>
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
    { translation_en: question!.translation_en, translation_ru: question!.translation_ru },
    language,
  );

  return (
    <>
      <RoundHeader
        index={index}
        total={questions.length}
        answered={answer !== null}
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
            <div className="mt-1.5 text-[0.75rem] text-fg-subtle">
              {verseKey(question!.surah_number, question!.ayah_number)}
            </div>
          </div>

          <SelfAssess
            questionKey={question!.word_id}
            prompt="Do you know what this word means?"
            onAnswer={setAnswer}
            onNext={next}
            nextLabel={index + 1 >= questions.length ? "Finish" : "Next"}
          >
            <div className="rounded-xl border border-border bg-surface-2/50 p-4">
              <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                It means
              </p>
              <p className="mt-1.5 text-[0.9375rem] font-medium text-fg">{question!.gloss}</p>

              <p className="mt-4 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
                In context · {verseKey(question!.surah_number, question!.ayah_number)}
              </p>
              <p className="arabic mt-2 text-fg" dir="rtl">
                <HighlightedArabic text={question!.verse_arabic} mark={question!.arabic} />
              </p>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-muted">{translation}</p>
            </div>
          </SelfAssess>
        </CardBody>
      </Card>
    </>
  );
}
