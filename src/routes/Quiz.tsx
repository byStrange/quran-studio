import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  BookMarked,
  BrainCircuit,
  Globe2,
  Layers,
  Library,
  TriangleAlert,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useContentLanguage } from "@/hooks/useProfile";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { getAiStatus, isTauri } from "@/lib/ai";
import type { QuizScope } from "@/lib/types";
import { cn } from "@/lib/utils";
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
  title: string;
  description: string;
  icon: typeof Library;
}> = [
  {
    value: "vocabulary",
    title: "Vocabulary",
    description: "One word at a time. Do you know what it means?",
    icon: Library,
  },
  {
    value: "knowledge",
    title: "Comprehension",
    description: "Questions about the passage, written for this round.",
    icon: BrainCircuit,
  },
];

const SCOPES: Array<{
  value: QuizScope;
  title: string;
  description: string;
  icon: typeof Layers;
}> = [
  {
    value: "ruku",
    title: "This ruku",
    description: "One ruku, whole — the round to run after memorizing it.",
    icon: Layers,
  },
  {
    value: "surah",
    title: "This surah",
    description: "The ayahs you've memorized in one surah.",
    icon: BookMarked,
  },
  {
    value: "global",
    title: "Everything memorized",
    description: "Every ayah you've memorized, across the whole Quran.",
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
 * Both rounds answer the same way — claim, reveal, confirm; see `SelfAssess`.
 *
 * The URL carries the whole configuration so that a ruku tile can link
 * straight into a round rather than dropping the reader on a form.
 */
export function Quiz() {
  const { user } = useAuth();
  const language = useContentLanguage();
  const { data: surahs } = useSurahs();
  const { data: rukus } = useRukus();
  const [params] = useSearchParams();

  const startParam = params.get("start") === "1";
  const [mode, setMode] = useState<QuizMode>(() =>
    params.get("mode") === "knowledge" ? "knowledge" : "vocabulary",
  );
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

  const [run, setRun] = useState<RoundConfig | null>(null);

  const surahRukus = useMemo(
    () => (rukus ?? []).filter((r) => r.surah_number === surahNumber),
    [rukus, surahNumber],
  );

  const ready =
    scope === "global" ||
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
    const label = scopeLabel(run, surahs?.find((s) => s.number === run.surah)?.name_english);
    return (
      <Page title={mode === "knowledge" ? "Comprehension" : "Quiz"} description={label}>
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
    { value: "", label: "Choose a surah…" },
    ...(surahs ?? []).map((s) => ({ value: String(s.number), label: `${s.number}. ${s.name_english}` })),
  ];
  const rukuOptions = [
    { value: "", label: surahNumber === null ? "Choose a surah first" : "Choose a ruku…" },
    ...surahRukus.map((r) => ({
      value: String(r.ruku_number),
      label: `Ruku ${r.ruku_in_surah} · ayahs ${r.ayah_start}–${r.ayah_end}`,
    })),
  ];

  const unit = mode === "knowledge" ? "ayah" : "word";
  const startDisabled = !ready || poolSize.data === 0 || (mode === "knowledge" && !aiReady);

  return (
    <Page
      title="Quiz"
      description={
        mode === "knowledge"
          ? "Answer from memory, then check yourself against the ayah."
          : "Say whether you know each word, then check yourself against the gloss."
      }
    >
      <div className="space-y-4">
        <Card>
          <CardBody className="pt-6 space-y-6">
            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">What kind of round?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODES.map((option) => (
                  <Choice
                    key={option.value}
                    selected={mode === option.value}
                    onSelect={() => setMode(option.value)}
                    icon={<option.icon className="size-4 shrink-0" aria-hidden />}
                    title={option.title}
                    description={option.description}
                  />
                ))}
              </div>
            </div>

            {mode === "knowledge" && !aiReady ? (
              <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3.5">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="min-w-0 text-[0.8125rem] leading-relaxed text-fg-muted">
                  <p className="font-medium text-fg">Comprehension rounds need AI set up</p>
                  <p className="mt-0.5">
                    {!isTauri()
                      ? "Questions are written in the desktop backend. Launch the app with `pnpm app:dev` rather than the browser preview."
                      : (aiStatus.data?.error ??
                        "Add an Ollama Cloud key in Settings and this round can be generated.")}
                  </p>
                  {isTauri() ? (
                    <Button asChild variant="outline" size="sm" className="mt-2.5">
                      <Link to="/settings">Open settings</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">What should it cover?</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {SCOPES.map((option) => (
                  <Choice
                    key={option.value}
                    selected={scope === option.value}
                    onSelect={() => setScope(option.value)}
                    icon={<option.icon className="size-4 shrink-0" aria-hidden />}
                    title={option.title}
                    description={option.description}
                  />
                ))}
              </div>
            </div>

            {scope === "surah" ? (
              <div>
                <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">Which surah?</p>
                <SelectField
                  value={surahNumber === null ? "" : String(surahNumber)}
                  onValueChange={(value) => {
                    setSurahNumber(value === "" ? null : Number(value));
                    setRukuNumber(null);
                  }}
                  options={surahOptions}
                  placeholder="Choose a surah…"
                />
              </div>
            ) : null}

            {scope === "ruku" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">Surah</p>
                  <SelectField
                    value={surahNumber === null ? "" : String(surahNumber)}
                    onValueChange={(value) => {
                      setSurahNumber(value === "" ? null : Number(value));
                      setRukuNumber(null);
                    }}
                    options={surahOptions}
                    placeholder="Choose a surah…"
                  />
                </div>
                <div>
                  <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">Ruku</p>
                  <SelectField
                    value={rukuNumber === null ? "" : String(rukuNumber)}
                    onValueChange={(value) => setRukuNumber(value === "" ? null : Number(value))}
                    options={rukuOptions}
                    placeholder="Choose a ruku…"
                  />
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-2.5 text-[0.8125rem] font-medium text-fg">
                {mode === "knowledge" ? "Questions this round" : "Words this session"}
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
                    ? `Counting the ${unit}s in this scope…`
                    : poolSize.data === 0
                      ? scope === "surah"
                        ? "You haven't memorized any ayahs in this surah yet."
                        : scope === "ruku"
                          ? `That ruku has no ${unit}s to quiz.`
                          : "Nothing memorized yet — mark ayahs as memorized while reading."
                      : `${poolSize.data} ${poolSize.data === 1 ? unit : `${unit}s`} in this scope${
                          (poolSize.data ?? 0) > limit ? ` · ${limit} per round` : ""
                        }`}
                </p>
              ) : (
                <p className="mt-2 text-[0.75rem] text-fg-subtle">
                  Pick {scope === "ruku" ? "a ruku" : "a surah"} to start.
                </p>
              )}
            </div>

            <Button variant="primary" className="w-full" disabled={startDisabled} onClick={begin}>
              Start round
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
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
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
