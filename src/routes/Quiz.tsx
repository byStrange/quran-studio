import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClock,
  BookMarked,
  BrainCircuit,
  Globe2,
  Layers,
  Library,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useLanguage, useT } from "@/providers/I18nProvider";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { useVocabularyOverview } from "@/hooks/useProgress";
import { getAiStatus, isTauri } from "@/lib/ai";
import type { QuizScope } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { TranslationKey } from "@/locales/en";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/primitives";
import { KnowledgeRound } from "@/components/quiz/KnowledgeRound";
import { VocabularyRound } from "@/components/quiz/VocabularyRound";
import { Scoreboard } from "@/components/quiz/Scoreboard";
import { scopeLabel, type RoundConfig } from "@/components/quiz/round";

type QuizMode = "vocabulary" | "knowledge";

const LIMITS = [10, 20, 30] as const;

const MODES: Array<{
  value: QuizMode;
  title: TranslationKey;
  description: TranslationKey;
  icon: typeof Library;
}> = [
  {
    value: "vocabulary",
    title: "quiz.modeVocabulary",
    description: "quiz.modeVocabularyDescription",
    icon: Library,
  },
  {
    value: "knowledge",
    title: "quiz.modeKnowledge",
    description: "quiz.modeKnowledgeDescription",
    icon: BrainCircuit,
  },
];

/**
 * The scopes, in the order they are worth offering.
 *
 * "Due" leads because it is the one a reader should press most evenings: it
 * asks whatever the schedule says is ready, wherever in the Quran it sits, and
 * it is the only scope that needs nothing marked at all. The other three are
 * for deciding to work on a particular passage.
 *
 * Only `global` consults what has been memorized, and `vocabularyOnly` is what
 * keeps `due` out of the comprehension round — nothing schedules an ayah.
 */
const SCOPES: Array<{
  value: QuizScope;
  title: TranslationKey;
  description: TranslationKey;
  icon: typeof Layers;
  vocabularyOnly?: boolean;
}> = [
  {
    value: "due",
    title: "quiz.scopeDue",
    description: "quiz.scopeDueDescription",
    icon: AlarmClock,
    vocabularyOnly: true,
  },
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

/**
 * Quiz setup, and whichever round it starts.
 *
 * Two quiz types share one screen because they share the thing that actually
 * decides a round: its scope. A reader who has just finished a ruku wants to
 * be tested on that ruku, and whether the questions are about its words or
 * about what it says is the smaller of the two choices. So scope, length and
 * the scoreboard live here, and each round type owns only its own questions.
 *
 * The two rounds no longer answer the same way. A vocabulary card is turned
 * over and graded on a four-point scale that buys it an interval; a
 * comprehension question is claimed, revealed and confirmed. That divergence
 * is deliberate — a word has a schedule and an ayah does not — so each round
 * owns its own answering step and this screen owns only the setup.
 *
 * The URL carries the whole configuration so that a ruku tile can link
 * straight into a round rather than dropping the reader on a form.
 */
export function Quiz() {
  const t = useT();
  const { user } = useAuth();
  const language = useLanguage();
  const { data: surahs } = useSurahs();
  const { data: rukus } = useRukus();
  const [params] = useSearchParams();

  const startParam = params.get("start") === "1";
  const [mode, setMode] = useState<QuizMode>(() =>
    params.get("mode") === "knowledge" ? "knowledge" : "vocabulary",
  );
  const [scope, setScope] = useState<QuizScope>(() => {
    const value = params.get("scope");
    if (value === "ruku" || value === "surah" || value === "global" || value === "due") return value;
    // Whatever is due is the round a reader opening this screen cold almost
    // always wants; "everything memorized" was only ever the default because
    // it was the widest one, and it is empty until something is marked.
    return params.get("mode") === "knowledge" ? "global" : "due";
  });
  const [surahNumber, setSurahNumber] = useState<number | null>(() => numberParam(params, "surah"));
  const [rukuNumber, setRukuNumber] = useState<number | null>(() => numberParam(params, "ruku"));
  const [limit, setLimit] = useState<number>(() => {
    const value = numberParam(params, "limit");
    return value !== null && (LIMITS as readonly number[]).includes(value) ? value : 10;
  });

  const [run, setRun] = useState<RoundConfig | null>(null);

  const surahRukus = useMemo(
    () => (rukus ?? []).filter((r) => r.surah_number === surahNumber),
    [rukus, surahNumber],
  );

  const knowledge = mode === "knowledge";
  const scopes = useMemo(() => SCOPES.filter((s) => !knowledge || !s.vocabularyOnly), [knowledge]);

  // Switching to comprehension out of a due round leaves the picker on a scope
  // that round has no meaning for, so it lands on the widest one instead.
  useEffect(() => {
    if (knowledge && scope === "due") setScope("global");
  }, [knowledge, scope]);

  /** What is waiting across the whole deck, for the "due" tile's own count. */
  const vocabulary = useVocabularyOverview();

  const ready =
    scope === "global" ||
    scope === "due" ||
    (scope === "surah" && surahNumber !== null) ||
    (scope === "ruku" && rukuNumber !== null);

  /**
   * How much the scope holds — words for a vocabulary round, ayahs for a
   * knowledge one — so "10 of 43" is honest before a round is started, and
   * before a generation is spent on one.
   */
  const poolSize = useQuery({
    queryKey: ["quiz-pool-size", user?.id, language, mode, scope, surahNumber, rukuNumber],
    enabled: Boolean(user) && ready && run === null,
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const args = {
        p_scope: scope,
        p_limit: 1,
        p_language: language,
        p_surah: scope === "surah" ? (surahNumber ?? undefined) : undefined,
        p_ruku: scope === "ruku" ? (rukuNumber ?? undefined) : undefined,
      };
      const { data, error } =
        mode === "knowledge"
          ? await supabase.rpc("quiz_verse_pool", args)
          : await supabase.rpc("quiz_pool", args);
      if (error) throw error;
      return (data ?? [])[0]?.pool_size ?? 0;
    },
  });

  // Generated questions need the desktop backend and a key. Checked before the
  // round rather than inside it, so the reader is told while they can still
  // pick the other quiz type instead of after a failed generation.
  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    enabled: mode === "knowledge",
    staleTime: 60_000,
    queryFn: getAiStatus,
  });
  const aiReady = !isTauri() ? false : (aiStatus.data?.configured ?? true) && !aiStatus.data?.error;

  const begin = useCallback(() => {
    // The seed is what makes "start round" draw again when nothing else about
    // the round changed — the same scope and length is a new set of questions.
    setRun({ scope, surah: surahNumber, ruku: rukuNumber, limit, seed: Date.now() });
  }, [scope, surahNumber, rukuNumber, limit]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!startParam || autoStarted.current) return;
    if (scope === "ruku" && rukuNumber === null) return;
    if (scope === "surah" && surahNumber === null) return;
    autoStarted.current = true;
    begin();
  }, [startParam, scope, rukuNumber, surahNumber, begin]);

  // --- a round in progress -------------------------------------------------

  if (run !== null) {
    const label = scopeLabel(t, run, surahs?.find((s) => s.number === run.surah)?.name_english);
    return (
      <Page
        title={mode === "knowledge" ? t("quiz.modeKnowledge") : t("quiz.title")}
        description={label}
      >
        {mode === "knowledge" ? (
          <KnowledgeRound config={run} onSetup={() => setRun(null)} />
        ) : (
          <VocabularyRound config={run} onSetup={() => setRun(null)} />
        )}
      </Page>
    );
  }

  // --- setup ---------------------------------------------------------------

  const surahOptions = [
    { value: "", label: t("quiz.chooseSurah") },
    ...(surahs ?? []).map((s) => ({
      value: String(s.number),
      label: t("quiz.surahOption", { number: s.number, name: s.name_english }),
    })),
  ];
  const rukuOptions = [
    {
      value: "",
      label: surahNumber === null ? t("quiz.chooseSurahFirst") : t("quiz.chooseRuku"),
    },
    ...surahRukus.map((r) => ({
      value: String(r.ruku_number),
      label: t("quiz.rukuOption", {
        number: r.ruku_in_surah,
        range: `${r.ayah_start}–${r.ayah_end}`,
      }),
    })),
  ];

  const startDisabled = !ready || poolSize.data === 0 || (knowledge && !aiReady);

  return (
    <Page
      title={t("quiz.title")}
      description={knowledge ? t("quiz.descriptionKnowledge") : t("quiz.descriptionVocabulary")}
    >
      <div className="space-y-4">
        <Card>
          <CardBody className="pt-6 space-y-6">
            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">{t("quiz.modeQuestion")}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODES.map((option) => (
                  <Choice
                    key={option.value}
                    selected={mode === option.value}
                    onSelect={() => setMode(option.value)}
                    icon={<option.icon className="size-4 shrink-0" aria-hidden />}
                    title={t(option.title)}
                    description={t(option.description)}
                  />
                ))}
              </div>
            </div>

            {knowledge && !aiReady ? (
              <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0 text-[0.8125rem] leading-relaxed text-fg-muted">
                  <p className="font-medium text-fg">{t("quiz.aiNeeded")}</p>
                  <p className="mt-0.5">
                    {!isTauri()
                      ? t("ai.notInTauri")
                      : (aiStatus.data?.error ?? t("quiz.aiNeedsKey"))}
                  </p>
                  {isTauri() ? (
                    <Button asChild variant="outline" size="sm" className="mt-2.5">
                      <Link to="/settings">{t("quiz.openSettings")}</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">
                {t("quiz.scopeQuestion")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {scopes.map((option) => (
                  <Choice
                    key={option.value}
                    selected={scope === option.value}
                    onSelect={() => setScope(option.value)}
                    icon={<option.icon className="size-4 shrink-0" aria-hidden />}
                    title={t(option.title)}
                    description={t(option.description)}
                    // The only count worth carrying on a tile: it is the one
                    // that says whether pressing it will find anything.
                    badge={
                      option.value === "due" && (vocabulary.data?.due ?? 0) > 0
                        ? String(vocabulary.data!.due)
                        : undefined
                    }
                  />
                ))}
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
                {knowledge ? t("quiz.questionsThisRound") : t("quiz.wordsThisSession")}
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
                    ? knowledge
                      ? t("quiz.countingAyahs")
                      : t("quiz.countingWords")
                    : poolSize.data === 0
                      ? scope === "due"
                        ? t("quiz.noneDue")
                        : scope === "surah"
                          ? knowledge
                            ? t("quiz.noneInSurahAyahs")
                            : t("quiz.noneInSurah")
                          : scope === "ruku"
                            ? knowledge
                              ? t("quiz.noneInRukuAyahs")
                              : t("quiz.noneInRuku")
                            : t("quiz.noneMemorized")
                      : (knowledge
                          ? t("quiz.poolSizeAyahs", { count: poolSize.data ?? 0 })
                          : t("quiz.poolSize", { count: poolSize.data ?? 0 })) +
                        ((poolSize.data ?? 0) > limit ? t("quiz.perRound", { limit }) : "")}
                </p>
              ) : (
                <p className="mt-2 text-[0.75rem] text-fg-subtle">
                  {scope === "ruku" ? t("quiz.pickRuku") : t("quiz.pickSurah")}
                </p>
              )}
            </div>

            <Button variant="primary" className="w-full" disabled={startDisabled} onClick={begin}>
              {t("quiz.start")}
            </Button>
          </CardBody>
        </Card>

        <Scoreboard />
      </div>
    </Page>
  );
}

function Choice({
  selected,
  onSelect,
  icon,
  title,
  description,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  /** A count the tile carries, when it has one worth reading at a glance. */
  badge?: string;
}) {
  return (
    <button
      onClick={onSelect}
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
        {icon}
        {title}
        {badge ? (
          <span className="ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-accent-fg">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="mt-1.5 block text-[0.75rem] leading-relaxed text-fg-subtle">
        {description}
      </span>
    </button>
  );
}

/** Reads a positive integer out of the query string, or null. */
function numberParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}
