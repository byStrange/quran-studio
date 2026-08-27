import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, GraduationCap, Search, Sparkles, WholeWord } from "lucide-react";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { useRukuProgress, type RukuProgress } from "@/hooks/useProgress";
import { Page } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/field";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/primitives";
import { ayahRangeLabel, cn } from "@/lib/utils";

export function Browse() {
  const navigate = useNavigate();
  const { data: surahs, isLoading: surahsLoading } = useSurahs();
  const { data: rukus, isLoading: rukusLoading } = useRukus();
  const { data: progress } = useRukuProgress();
  const [query, setQuery] = useState("");
  const [openSurah, setOpenSurah] = useState<number | null>(null);

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
      <Page title="Read" description="Browse by surah, then pick a ruku to study.">
        <LoadingBlock />
      </Page>
    );
  }

  return (
    <Page title="Read" description="Browse by surah, then pick a ruku to study." wide>
      <div className="relative mb-6 max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search surahs…"
          className="pl-9"
          aria-label="Search surahs"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="No surahs match that search"
          description="Try a different name or surah number."
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
                className="overflow-hidden rounded-xl border border-border bg-surface"
              >
                <button
                  onClick={() => setOpenSurah(expanded ? null : surah.number)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-surface-2"
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
                      {surah.ayah_count} ayahs · {surahRukus.length}{" "}
                      {surahRukus.length === 1 ? "ruku" : "rukus"} ·{" "}
                      <span className="capitalize">{surah.revelation_type}</span>
                      {rukusDone > 0 ? (
                        <span className="text-accent">
                          {" · "}
                          {surahDone
                            ? "memorized"
                            : `${rukusDone}/${surahRukus.length} rukus memorized`}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <span className="arabic-sm shrink-0 text-fg-muted">{surah.name_arabic}</span>

                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 text-fg-subtle transition-transform",
                      expanded && "rotate-90",
                    )}
                    aria-hidden
                  />
                </button>

                {expanded ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 border-t border-border bg-surface-2/40 p-3">
                    {surahRukus.map((ruku) => (
                      <RukuTile
                        key={ruku.ruku_number}
                        label={`Ruku ${ruku.ruku_in_surah}`}
                        ayahs={ayahRangeLabel(ruku.ayah_start, ruku.ayah_end)}
                        progress={progress?.get(ruku.ruku_number)}
                        onOpen={() => navigate(`/read/${ruku.ruku_number}`)}
                      />
                    ))}
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
 * One ruku in the grid, carrying how far through it the reader is.
 *
 * A finished ruku changes colour rather than filling a bar: the bar answers
 * "how much is left", which stops being the question once the answer is none.
 * The tafsir marker is a separate corner icon because the two can — and often
 * do — finish at different times, and seeing which rukus are memorized but not
 * yet understood is the whole reason the second marker exists.
 */
function RukuTile({
  label,
  ayahs,
  progress,
  onOpen,
}: {
  label: string;
  ayahs: string;
  progress: RukuProgress | undefined;
  onOpen: () => void;
}) {
  const total = progress?.verse_count ?? 0;
  const memorized = progress?.memorized_count ?? 0;
  const tafsirRead = progress?.tafsir_read_count ?? 0;
  const wordsLearned = progress?.words_learned_count ?? 0;
  const complete = total > 0 && memorized === total;
  const tafsirComplete = total > 0 && tafsirRead === total;
  const wordsComplete = total > 0 && wordsLearned === total;
  const started = memorized > 0 && !complete;

  const tile = (
    <button
      onClick={onOpen}
      className={cn(
        "relative overflow-hidden rounded-lg border px-3 py-2.5 text-left transition-colors",
        complete
          ? "border-accent/50 bg-accent-soft/60 hover:bg-accent-soft"
          : "border-border bg-surface hover:border-accent/40 hover:bg-accent-soft/40",
      )}
    >
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
        {started ? `${memorized}/${total} memorized` : `Ayahs ${ayahs}`}
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
    </button>
  );

  if (!progress || memorized === 0) return tile;

  return (
    <Tooltip
      content={
        complete
          ? tafsirComplete && wordsComplete
            ? "Memorized, tafsir read, and all words learned."
            : `Memorized. Tafsir read on ${tafsirRead}/${total}. Words learned on ${wordsLearned}/${total}.`
          : `${memorized}/${total} ayahs memorized. Tafsir read on ${tafsirRead}. Words learned on ${wordsLearned}.`
      }
    >
      {tile}
    </Tooltip>
  );
}
