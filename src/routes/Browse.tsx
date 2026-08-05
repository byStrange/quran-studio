import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Search } from "lucide-react";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { Page } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/field";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { ayahRangeLabel, cn } from "@/lib/utils";

export function Browse() {
  const navigate = useNavigate();
  const { data: surahs, isLoading: surahsLoading } = useSurahs();
  const { data: rukus, isLoading: rukusLoading } = useRukus();
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
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-[0.8125rem] font-semibold tabular-nums text-fg-muted">
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
                      <button
                        key={ruku.ruku_number}
                        onClick={() => navigate(`/read/${ruku.ruku_number}`)}
                        className={cn(
                          "rounded-lg border border-border bg-surface px-3 py-2.5 text-left",
                          "transition-colors hover:border-accent/40 hover:bg-accent-soft/40",
                        )}
                      >
                        <div className="text-[0.8125rem] font-medium text-fg">
                          Ruku {ruku.ruku_in_surah}
                        </div>
                        <div className="mt-0.5 text-[0.75rem] tabular-nums text-fg-subtle">
                          Ayahs {ayahRangeLabel(ruku.ayah_start, ruku.ayah_end)}
                        </div>
                      </button>
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
