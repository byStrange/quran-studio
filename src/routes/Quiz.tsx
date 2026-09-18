import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  Check,
  Globe2,
  GraduationCap,
  Layers,
  Repeat2,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { useLanguage, useT } from "@/providers/I18nProvider";
import { verseTranslation } from "@/lib/language";
import type { QuizScope, WordStatus } from "@/lib/types";
import { cn, verseKey } from "@/lib/utils";
import type { TranslationKey } from "@/locales/en";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { ProgressBar, SelectField } from "@/components/ui/primitives";

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
  translation_uz: string;
  pool_size: number;
}

const LIMITS = [10, 20, 30] as const;

const SCOPES: Array<{
  value: QuizScope;
  title: TranslationKey;
  description: TranslationKey;
  icon: typeof Layers;
}> = [
  {
    value: "ruku",
    title: "quiz.scopeRuku",
    description: "quiz.scopeRukuDescription",
    icon: Layers,
  },
  {
    value: "surah",
    title: "quiz.scopeSurah",
    description: "quiz.scopeSurahDescription",
    icon: BookMarked,
  },
  {
    value: "global",
    title: "quiz.scopeGlobal",
    description: "quiz.scopeGlobalDescription",
    icon: Globe2,
  },
];

type Phase = "config" | "running" | "done";

/**
 * Vocabulary recall, scoped.
 *
 * This is a study round, not an exam: the reader says whether they know a word
 * and the ones they don't open the ayah it was used in. There are no options
 * to pick between, because a choice of four answers drawn from the same
 * glossary can be narrowed down without knowing the word — it tested
 * elimination rather than vocabulary.
 *
 * A round is a scope plus a length. The scope decides which words are asked
 * (a ruku's words, a surah's memorized ayahs, everything memorized), and the
 * answers are what write to `user_word_progress`: knowing a word marks it
 * learned, missing it marks it learning. Nothing has to be marked by hand
 * first.
 */
export function Quiz() {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const language = useLanguage();
  const { data: surahs } = useSurahs();
  const { data: rukus } = useRukus();
  const [params] = useSearchParams();

  // The URL is the source of the round's parameters, so a ruku tile can link
  // straight into a quiz rather than dropping the reader on a form.
  const startParam = params.get("start") === "1";
  const [scope, setScope] = useState<QuizScope>(() => {
    const value = params.get("scope");
    return value === "ruku" || value === "surah" || value === "global" ? value : "global";
  });
  const [surahNumber, setSurahNumber] = useState<number | null>(() => numberParam(params, "surah"));
  const [rukuNumber, setRukuNumber] = useState<number | null>(() => numberParam(params, "ruku"));
  const [limit, setLimit] = useState<number>(() => {
    const value = numberParam(params, "limit");
    return value !== null && (LIMITS as readonly number[]).includes(value) ? value : 10;
  });

  const [phase, setPhase] = useState<Phase>("config");
  const [run, setRun] = useState<{ scope: QuizScope; surah: number | null; ruku: number | null; limit: number; seed: number } | null>(null);
  /** A round built from the words missed in the previous one, bypassing the draw. */
  const [custom, setCustom] = useState<QuizWord[] | null>(null);

  const [index, setIndex] = useState(0);
  const [verdict, setVerdict] = useState<"known" | "unknown" | null>(null);
  const [knownCount, setKnownCount] = useState(0);
  const [missed, setMissed] = useState<QuizWord[]>([]);
  const advanceTimer = useRef<number | null>(null);

  const surahRukus = useMemo(
    () => (rukus ?? []).filter((r) => r.surah_number === surahNumber),
    [rukus, surahNumber],
  );

  const ready =
    scope === "global" ||
    (scope === "surah" && surahNumber !== null) ||
    (scope === "ruku" && rukuNumber !== null);

  /** How many words the scope holds, so "10 of 43" is honest before starting. */
  const poolSize = useQuery({
    queryKey: ["quiz-pool-size", user?.id, language, scope, surahNumber, rukuNumber],
    enabled: Boolean(user) && ready && phase === "config",
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("quiz_pool", {
        p_scope: scope,
        p_limit: 1,
        p_language: language,
        p_surah: scope === "surah" ? (surahNumber ?? undefined) : undefined,
        p_ruku: scope === "ruku" ? (rukuNumber ?? undefined) : undefined,
      });
      if (error) throw error;
      return (data ?? [])[0]?.pool_size ?? 0;
    },
  });

  const round = useQuery({
    queryKey: [
      "quiz-round",
      user?.id,
      language,
      run?.scope,
      run?.surah,
      run?.ruku,
      run?.limit,
      run?.seed,
    ],
    enabled: Boolean(user) && run !== null && custom === null,
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<QuizWord[]> => {
      const { data, error } = await supabase.rpc("quiz_pool", {
        p_scope: run!.scope,
        p_limit: run!.limit,
        p_language: language,
        p_surah: run!.scope === "surah" ? (run!.surah ?? undefined) : undefined,
        p_ruku: run!.scope === "ruku" ? (run!.ruku ?? undefined) : undefined,
      });
      if (error) throw error;
      return (data ?? []) as QuizWord[];
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
      queryClient.invalidateQueries({ queryKey: ["word-progress"] });
      queryClient.invalidateQueries({ queryKey: ["ruku-word-stats"] });
    },
  });

  const questions = custom ?? round.data ?? [];
  const question = questions[index];

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }, []);

  const next = useCallback(() => {
    clearAdvanceTimer();
    setVerdict(null);
    if (index + 1 >= questions.length) {
      setPhase("done");
      return;
    }
    setIndex(index + 1);
  }, [clearAdvanceTimer, index, questions.length]);

  const answer = useCallback(
    (correct: boolean) => {
      if (verdict !== null || !question) return;
      setVerdict(correct ? "known" : "unknown");
      if (correct) setKnownCount((n) => n + 1);
      else setMissed((words) => [...words, question]);
      record.mutate({ wordId: question.word_id, correct });

      // A word the reader knows needs no reading: confirm it and move on. A
      // miss stops here, because the ayah it opens is the point of the round.
      if (correct) {
        advanceTimer.current = window.setTimeout(() => next(), 550);
      }
    },
    [verdict, question, record, next],
  );

  useEffect(() => clearAdvanceTimer, [clearAdvanceTimer]);

  // Keyboard play: 1/Y for known, 2/N for not, Enter to move on.
  useEffect(() => {
    if (phase !== "running" || !question) return;
    const onKey = (event: KeyboardEvent) => {
      if (verdict === null) {
        if (event.key === "1" || event.key.toLowerCase() === "y") answer(true);
        else if (event.key === "2" || event.key.toLowerCase() === "n") answer(false);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, next, verdict, question, phase]);

  const begin = useCallback(() => {
    setCustom(null);
    setIndex(0);
    setVerdict(null);
    setKnownCount(0);
    setMissed([]);
    setPhase("running");
    // The seed is what makes "start round" draw again when nothing else about
    // the round changed — the same scope and length is a new set of words.
    setRun({ scope, surah: surahNumber, ruku: rukuNumber, limit, seed: Date.now() });
  }, [scope, surahNumber, rukuNumber, limit]);

  // `?start=1` from a ruku tile goes straight into the round it points at.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!startParam || autoStarted.current) return;
    if (scope === "ruku" && rukuNumber === null) return;
    if (scope === "surah" && surahNumber === null) return;
    autoStarted.current = true;
    begin();
  }, [startParam, scope, rukuNumber, surahNumber, begin]);

  // Reading one ruku's words is the step that follows memorizing it, so a
  // round that was opened from a ruku links back there when it is over.
  const scopeLabel =
    scope === "ruku"
      ? t("browse.rukuLabel", { number: rukuNumber ?? "" }).trim()
      : scope === "surah"
        ? (surahs?.find((s) => s.number === surahNumber)?.name_english ?? t("quiz.surah"))
        : t("quiz.allMemorized");

  const restart = () => {
    setCustom(null);
    setRun(null);
    setPhase("config");
    setIndex(0);
    setVerdict(null);
    setKnownCount(0);
    setMissed([]);
  };

  const practiseMissed = () => {
    if (missed.length === 0) {
      restart();
      return;
    }
    setCustom(missed);
    setIndex(0);
    setVerdict(null);
    setKnownCount(0);
    setMissed([]);
    setPhase("running");
  };

  // --- configuration -------------------------------------------------------

  if (phase === "config") {
    const surahOptions = [
      { value: "", label: t("quiz.chooseSurah") },
      ...(surahs ?? []).map((s) => ({
        value: String(s.number),
        label: t("quiz.surahOption", { number: s.number, name: s.name_english }),
      })),
    ];
    const rukuOptions = [
      { value: "", label: surahNumber === null ? t("quiz.chooseSurahFirst") : t("quiz.chooseRuku") },
      ...surahRukus.map((r) => ({
        value: String(r.ruku_number),
        label: t("quiz.rukuOption", {
          number: r.ruku_in_surah,
          range: `${r.ayah_start}–${r.ayah_end}`,
        }),
      })),
    ];

    return (
      <Page title={t("quiz.title")} description={t("quiz.description")}>
        <Card>
          <CardBody className="pt-6 space-y-6">
            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">
                {t("quiz.scopeQuestion")}
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {SCOPES.map((option) => {
                  const Icon = option.icon;
                  const selected = scope === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setScope(option.value)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-xl border p-3.5 text-left transition-colors",
                        selected
                          ? "border-accent/60 bg-accent-soft/60"
                          : "border-border bg-surface hover:border-accent/40 hover:bg-surface-2",
                      )}
                    >
                      <span
                        className={cn(
                          "flex items-center gap-2 text-[0.8125rem] font-medium",
                          selected ? "text-accent-soft-fg" : "text-fg",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {t(option.title)}
                      </span>
                      <span className="mt-1.5 block text-[0.75rem] leading-relaxed text-fg-subtle">
                        {t(option.description)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {scope === "surah" ? (
              <div>
                <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">{t("quiz.whichSurah")}</p>
                <SelectField
                  value={surahNumber === null ? "" : String(surahNumber)}
                  onValueChange={(value) => {
                    setSurahNumber(value === "" ? null : Number(value));
                    setRukuNumber(null);
                  }}
                  options={surahOptions}
                  placeholder={t("quiz.chooseSurah")}
                />
              </div>
            ) : null}

            {scope === "ruku" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">{t("quiz.surah")}</p>
                  <SelectField
                    value={surahNumber === null ? "" : String(surahNumber)}
                    onValueChange={(value) => {
                      setSurahNumber(value === "" ? null : Number(value));
                      setRukuNumber(null);
                    }}
                    options={surahOptions}
                    placeholder={t("quiz.chooseSurah")}
                  />
                </div>
                <div>
                  <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">{t("quiz.ruku")}</p>
                  <SelectField
                    value={rukuNumber === null ? "" : String(rukuNumber)}
                    onValueChange={(value) => setRukuNumber(value === "" ? null : Number(value))}
                    options={rukuOptions}
                    placeholder={t("quiz.chooseRuku")}
                  />
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">
                {t("quiz.wordsThisSession")}
              </p>
              <div className="flex gap-2">
                {LIMITS.map((value) => (
                  <button
                    key={value}
                    onClick={() => setLimit(value)}
                    aria-pressed={limit === value}
                    className={cn(
                      "h-10 flex-1 rounded-lg border text-sm font-medium tabular-nums transition-colors",
                      limit === value
                        ? "border-accent/60 bg-accent-soft/60 text-accent-soft-fg"
                        : "border-border bg-surface text-fg-muted hover:bg-surface-2",
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
              {ready ? (
                <p className="mt-2 text-[0.75rem] text-fg-subtle">
                  {poolSize.isLoading
                    ? t("quiz.counting")
                    : poolSize.data === 0
                      ? scope === "surah"
                        ? t("quiz.noneInSurah")
                        : scope === "ruku"
                          ? t("quiz.noneInRuku")
                          : t("quiz.noneMemorized")
                      : t("quiz.poolSize", { count: poolSize.data ?? 0 }) +
                        ((poolSize.data ?? 0) > limit ? t("quiz.perSession", { limit }) : "")}
                </p>
              ) : (
                <p className="mt-2 text-[0.75rem] text-fg-subtle">
                  {scope === "ruku" ? t("quiz.pickRuku") : t("quiz.pickSurah")}
                </p>
              )}
            </div>

            <Button
              variant="primary"
              className="w-full"
              disabled={!ready || poolSize.data === 0}
              onClick={() => begin()}
            >
              {t("quiz.start")}
            </Button>
          </CardBody>
        </Card>
      </Page>
    );
  }

  // --- round ---------------------------------------------------------------

  if (round.isError) {
    return (
      <Page title={t("quiz.title")}>
        <Card>
          <EmptyState
            icon={<X className="size-5" />}
            title={t("quiz.buildFailed")}
            description={String(round.error)}
            action={
              <Button variant="primary" onClick={restart}>
                {t("quiz.backToSetup")}
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }

  if (round.isPending && custom === null) {
    return (
      <Page title={t("quiz.title")}>
        <LoadingBlock label={t("quiz.drawing")} />
      </Page>
    );
  }

  if (questions.length === 0) {
    return (
      <Page title={t("quiz.title")}>
        <Card>
          <EmptyState
            icon={<GraduationCap className="size-5" />}
            title={t("quiz.emptyScope")}
            description={
              scope === "surah" ? t("quiz.emptySurahDescription") : t("quiz.emptyDescription")
            }
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={restart}>
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
      </Page>
    );
  }

  if (phase === "done") {
    const answered = knownCount + missed.length;
    const accuracy = answered > 0 ? (knownCount / answered) * 100 : 0;

    return (
      <Page title={t("quiz.roundComplete")}>
        <Card>
          <CardBody className="pt-6">
            <div className="text-center">
              <div className="text-5xl font-semibold tabular-nums text-fg">
                {knownCount}
                <span className="text-fg-subtle">/{answered}</span>
              </div>
              <p className="mt-2 text-sm text-fg-muted">
                {accuracy >= 80
                  ? t("quiz.verdictStrong")
                  : accuracy >= 50
                    ? t("quiz.verdictSolid")
                    : t("quiz.verdictWeak")}
              </p>
            </div>

            {missed.length > 0 ? (
              <div className="mt-6 border-t border-border pt-5">
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
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {missed.length > 0 ? (
                <Button variant="primary" onClick={practiseMissed}>
                  <Repeat2 className="size-4" aria-hidden />
                  {t("quiz.practiseMissed", { count: missed.length })}
                </Button>
              ) : null}
              <Button variant={missed.length > 0 ? "outline" : "primary"} onClick={restart}>
                <RotateCcw className="size-4" aria-hidden />
                {t("quiz.newRound")}
              </Button>
              {scope === "ruku" && rukuNumber !== null ? (
                <Button asChild variant="ghost">
                  <Link to={`/read/${rukuNumber}`}>{t("quiz.backToRuku")}</Link>
                </Button>
              ) : (
                <Button asChild variant="ghost">
                  <Link to="/vocabulary">{t("vocab.title")}</Link>
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </Page>
    );
  }

  // --- one question --------------------------------------------------------

  const revealed = verdict === "unknown";
  const translation = verseTranslation(
    {
      translation_en: question!.translation_en,
      translation_ru: question!.translation_ru,
      translation_uz: question!.translation_uz,
    },
    language,
  );

  return (
    <Page title={t("quiz.title")} description={scopeLabel}>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-4">
          <ProgressBar value={((index + (verdict ? 1 : 0)) / questions.length) * 100} />
          <span className="shrink-0 text-[0.8125rem] tabular-nums text-fg-subtle">
            {t("quiz.progress", { index: index + 1, total: questions.length })}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={restart}>
          <Settings2 className="size-4 mr-1.5" />
          {t("quiz.setup")}
        </Button>
      </div>

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

          {verdict === null ? (
            <>
              <p className="mt-7 text-center text-[0.8125rem] text-fg-subtle">
                {t("quiz.doYouKnow")}
              </p>
              <div className="mx-auto mt-3 grid max-w-md gap-2 sm:grid-cols-2">
                <button
                  onClick={() => answer(true)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-medium transition-colors",
                    "border-accent/50 bg-accent-soft/50 text-accent-soft-fg",
                    "hover:border-accent hover:bg-accent-soft",
                  )}
                >
                  <Check className="size-4" aria-hidden />
                  {t("quiz.iKnowIt")}
                </button>
                <button
                  onClick={() => answer(false)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-sm font-medium transition-colors",
                    "border-border bg-surface text-fg-muted",
                    "hover:border-border-strong hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <X className="size-4" aria-hidden />
                  {t("quiz.iDontKnow")}
                </button>
              </div>
              <p className="mt-3 text-center text-[0.6875rem] text-fg-subtle">
                {t("quiz.keyHint")}
              </p>
            </>
          ) : revealed ? (
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
                  <HighlightedVerse text={question!.verse_arabic} word={question!.arabic} />
                </p>
                <p className="mt-3 text-[0.9375rem] leading-relaxed text-fg-muted">{translation}</p>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="text-[0.75rem] text-fg-subtle">
                  {t("quiz.markedLearning")}
                </span>
                <Button variant="primary" onClick={next}>
                  {index + 1 >= questions.length ? t("quiz.finish") : t("quiz.next")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-7 flex items-center justify-center gap-2.5 text-sm text-accent-soft-fg animate-fade-in">
              <Check className="size-4" aria-hidden />
              {t("quiz.markedLearned")}
            </div>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}

/**
 * The ayah with the quizzed word picked out.
 *
 * The word's own text is what the verse is searched for — the word rows are
 * cut from the verse text during seeding, so it is a literal substring. When
 * it isn't (a word normalised during import), the ayah still renders, just
 * without the emphasis.
 */
function HighlightedVerse({ text, word }: { text: string; word: string }) {
  const parts = word && text.includes(word) ? text.split(word) : null;
  if (!parts) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <mark className="rounded bg-accent-soft px-0.5 text-accent-soft-fg">{word}</mark>
          ) : null}
        </span>
      ))}
    </>
  );
}

/** Reads a positive integer out of the query string, or null. */
function numberParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
