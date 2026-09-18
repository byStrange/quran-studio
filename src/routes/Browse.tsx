import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronRight,
  GraduationCap,
  ScrollText,
  Search,
  Sparkles,
  WholeWord,
} from "lucide-react";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { useRukuProgress, useRukuWordStats, type RukuProgress, type RukuWordStats } from "@/hooks/useProgress";
import { Page } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/primitives";
import { ayahRangeLabel, cn } from "@/lib/utils";
import { useT, type TFunction } from "@/providers/I18nProvider";

export function Browse() {
  const t = useT();
  const navigate = useNavigate();
  const { data: surahs, isLoading: surahsLoading } = useSurahs();
  const { data: rukus, isLoading: rukusLoading } = useRukus();
  const { data: progress } = useRukuProgress();
  const { data: wordStats } = useRukuWordStats();
  const [query, setQuery] = useState("");

  // The open surah lives in the URL rather than in component state, so leaving
  // for a ruku and coming back lands on the same surah with its rukus still
  // showing — the list is how a reader picks the next ruku, and collapsing it
  // on every return makes that a two-step every time.
  const [searchParams, setSearchParams] = useSearchParams();
  const openSurah = useMemo(() => {
    const raw = Number(searchParams.get("surah"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [searchParams]);

  const setOpenSurah = (surahNumber: number | null) => {
    const next = new URLSearchParams(searchParams);
    if (surahNumber === null) next.delete("surah");
    else next.set("surah", String(surahNumber));
    setSearchParams(next, { replace: false });
  };

  // Returning from a ruku with the surah restored can put it outside the
  // viewport; `nearest` scrolls only when it actually is, so expanding one by
  // hand does not jump the page.
  useEffect(() => {
    if (openSurah === null || rukusLoading) return;
    document.getElementById(`surah-${openSurah}`)?.scrollIntoView({ block: "nearest" });
  }, [openSurah, rukusLoading]);

  const rukusBySurah = useMemo(() => {
    const map = new Map<number, typeof rukus>();
    for (const ruku of rukus ?? []) {
      const list = map.get(ruku.surah_number);
      if (list) list.push(ruku);
      else map.set(ruku.surah_number, [ruku]);
    }
    return map;
  }, [rukus]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return surahs ?? [];
    return (surahs ?? []).filter(
      (s) =>
        s.name_english.toLowerCase().includes(needle) ||
        s.name_translation.toLowerCase().includes(needle) ||
        String(s.number) === needle,
    );
  }, [surahs, query]);

  if (surahsLoading || rukusLoading) {
    return (
      <Page title={t("browse.title")} description={t("browse.description")}>
        <LoadingBlock />
      </Page>
    );
  }

  return (
    <Page title={t("browse.title")} description={t("browse.description")} wide>
      <div className="relative mb-6 max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("browse.searchPlaceholder")}
          className="pl-9"
          aria-label={t("browse.searchLabel")}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={t("browse.noMatchTitle")}
          description={t("browse.noMatchDescription")}
        />
      ) : (
        <div className="space-y-1.5">
          {filtered.map((surah) => {
            const surahRukus = rukusBySurah.get(surah.number) ?? [];
            const expanded = openSurah === surah.number;
            const rukusDone = surahRukus.filter((ruku) => {
              const p = progress?.get(ruku.ruku_number);
              return p !== undefined && p.verse_count > 0 && p.memorized_count === p.verse_count;
            }).length;
            const surahDone = rukusDone > 0 && rukusDone === surahRukus.length;

            return (
              <div
                key={surah.number}
                id={`surah-${surah.number}`}
                className="scroll-mt-20 overflow-hidden rounded-xl border border-border bg-surface"
              >
                <div className="flex w-full items-center gap-1 pr-2">
                  <button
                    onClick={() => setOpenSurah(expanded ? null : surah.number)}
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded-lg text-[0.8125rem] font-semibold tabular-nums",
                        surahDone ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted",
                      )}
                    >
                      {surah.number}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-fg">
                          {surah.name_english}
                        </span>
                        <span className="truncate text-[0.8125rem] text-fg-subtle">
                          {surah.name_translation}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[0.75rem] text-fg-subtle">
                        {t("common.ayahCount", { count: surah.ayah_count })} ·{" "}
                        {t("common.rukuCount", { count: surahRukus.length })} ·{" "}
                        {surah.revelation_type === "meccan"
                          ? t("browse.revelationMeccan")
                          : t("browse.revelationMedinan")}
                        {rukusDone > 0 ? (
                          <span className="text-accent">
                            {" · "}
                            {surahDone
                              ? t("browse.surahMemorized")
                              : t("browse.rukusMemorized", {
                                  done: rukusDone,
                                  total: surahRukus.length,
                                })}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <span className="arabic-sm shrink-0 text-fg-muted">{surah.name_arabic}</span>
                  </button>

                  <Tooltip content={t("browse.readWholeSurah")}>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("browse.readAllOf", { surah: surah.name_english })}
                      onClick={() => navigate(`/read/surah/${surah.number}`)}
                    >
                      <ScrollText className="size-4" aria-hidden />
                    </Button>
                  </Tooltip>

                  <button
                    onClick={() => setOpenSurah(expanded ? null : surah.number)}
                    aria-label={expanded ? t("browse.hideRukus") : t("browse.showRukus")}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2"
                  >
                    <ChevronRight
                      className={cn("size-4 transition-transform", expanded && "rotate-90")}
                      aria-hidden
                    />
                  </button>
                </div>

                {expanded ? (
                  <div className="border-t border-border bg-surface-2/40 p-3">
                    <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
                      <span className="text-[0.75rem] text-fg-subtle">
                        {t("common.rukuCount", { count: surahRukus.length })}
                      </span>
                      <button
                        onClick={() => navigate(`/quiz?scope=surah&surah=${surah.number}&start=1`)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.75rem] font-medium text-fg-muted transition-colors hover:bg-surface hover:text-fg"
                      >
                        <GraduationCap className="size-3.5" aria-hidden />
                        {t("browse.quizThisSurah")}
                      </button>
                    </div>

                    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
                      {surahRukus.map((ruku) => (
                        <RukuTile
                          key={ruku.ruku_number}
                          label={t("browse.rukuLabel", { number: ruku.ruku_in_surah })}
                          ayahs={ayahRangeLabel(ruku.ayah_start, ruku.ayah_end)}
                          t={t}
                          progress={progress?.get(ruku.ruku_number)}
                          words={wordStats?.get(ruku.ruku_number)}
                          onOpen={() => navigate(`/read/${ruku.ruku_number}`)}
                          onQuiz={() =>
                            navigate(`/quiz?scope=ruku&ruku=${ruku.ruku_number}&start=1`)
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}

/**
 * One ruku in the grid, carrying how far through it the reader is and a way
 * into its word quiz.
 *
 * A finished ruku changes colour rather than filling a bar: the bar answers
 * "how much is left", which stops being the question once the answer is none.
 * The tafsir marker is a separate corner icon because the two can — and often
 * do — finish at different times, and seeing which rukus are memorized but not
 * yet understood is the whole reason the second marker exists.
 *
 * The quiz sits in its own row rather than on the tile's face, because the two
 * are different intentions: the face goes and reads the ruku, the button
 * drills the words it contains.
 */
function RukuTile({
  label,
  ayahs,
  progress,
  words,
  onOpen,
  onQuiz,
  t,
}: {
  label: string;
  ayahs: string;
  t: TFunction;
  progress: RukuProgress | undefined;
  words: RukuWordStats | undefined;
  onOpen: () => void;
  onQuiz: () => void;
}) {
  const total = progress?.verse_count ?? 0;
  const memorized = progress?.memorized_count ?? 0;
  const tafsirRead = progress?.tafsir_read_count ?? 0;
  const wordsLearned = progress?.words_learned_count ?? 0;
  const complete = total > 0 && memorized === total;
  const tafsirComplete = total > 0 && tafsirRead === total;
  const wordsComplete = total > 0 && wordsLearned === total;
  const started = memorized > 0 && !complete;

  const toLearn = words ? words.word_count - words.learned_count : null;

  const tile = (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border transition-colors",
        complete
          ? "border-accent/50 bg-accent-soft/60"
          : "border-border bg-surface hover:border-accent/40",
      )}
    >
      <button onClick={onOpen} className="block w-full px-3 py-2.5 text-left">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "text-[0.8125rem] font-medium",
              complete ? "text-accent-soft-fg" : "text-fg",
            )}
          >
            {label}
          </span>
          {complete ? <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden /> : null}
          {tafsirComplete ? (
            <GraduationCap className="size-3.5 shrink-0 text-gold" aria-hidden />
          ) : null}
          {wordsComplete ? (
            <WholeWord className="size-3.5 shrink-0 text-green-500" aria-hidden />
          ) : null}
        </div>

        <div
          className={cn(
            "mt-0.5 text-[0.75rem] tabular-nums",
            complete ? "text-accent-soft-fg/80" : "text-fg-subtle",
          )}
        >
          {started
            ? t("browse.memorizedOf", { memorized, total })
            : t("browse.ayahsRange", { range: ayahs })}
        </div>
      </button>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-1">
        <span className="truncate text-[0.6875rem] tabular-nums text-fg-subtle">
          {toLearn === null
            ? "—"
            : toLearn === 0
              ? t("browse.allWordsLearned", { count: words!.word_count })
              : t("browse.wordsToLearn", { count: words!.word_count, remaining: toLearn })}
        </span>
        <button
          onClick={onQuiz}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <GraduationCap className="size-3" aria-hidden />
          {t("browse.quiz")}
        </button>
      </div>

      {/* A hairline along the bottom edge rather than a widget: it has to read
          at a glance across a grid of twenty, without competing with the text. */}
      {started ? (
        <span className="absolute inset-x-0 bottom-0 h-[2px] bg-border/60" aria-hidden>
          <span
            className="block h-full bg-accent"
            style={{ width: `${(memorized / total) * 100}%` }}
          />
        </span>
      ) : null}
    </div>
  );

  if (!progress || memorized === 0) return tile;

  return (
    <Tooltip
      content={
        complete
          ? tafsirComplete && wordsComplete
            ? t("browse.tileComplete")
            : t("browse.tileMemorized", { tafsir: tafsirRead, words: wordsLearned, total })
          : t("browse.tilePartial", {
              memorized,
              total,
              tafsir: tafsirRead,
              words: wordsLearned,
            })
      }
    >
      {tile}
    </Tooltip>
  );
}
