import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useMemorizationOverview } from "@/hooks/useProgress";
import { useRukus, useSurahs } from "@/hooks/useQuranData";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader, StatTile } from "@/components/ui/card";
import { ProgressBar } from "@/components/ui/primitives";
import { LoadingBlock } from "@/components/ui/feedback";
import { cn, formatPercent } from "@/lib/utils";

interface SurahProgress {
  surah_number: number;
  memorized_count: number;
  ayah_count: number;
}

type Filter = "all" | "started" | "completed";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "started", label: "In progress" },
  { value: "completed", label: "Completed" },
];

export function Memorization() {
  const { user } = useAuth();
  const { data: surahs } = useSurahs();
  const { data: rukus } = useRukus();
  const { data: overview } = useMemorizationOverview();
  const [filter, setFilter] = useState<Filter>("all");

  const progress = useQuery({
    queryKey: ["memorized-by-surah", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<SurahProgress[]> => {
      const { data, error } = await supabase.rpc("memorized_by_surah");
      if (error) throw error;
      return (data ?? []) as unknown as SurahProgress[];
    },
  });

  const firstRukuOfSurah = useMemo(() => {
    const map = new Map<number, number>();
    for (const ruku of rukus ?? []) {
      if (!map.has(ruku.surah_number)) map.set(ruku.surah_number, ruku.ruku_number);
    }
    return map;
  }, [rukus]);

  const rows = useMemo(() => {
    const byNumber = new Map((progress.data ?? []).map((p) => [p.surah_number, p]));
    return (surahs ?? [])
      .map((surah) => {
        const p = byNumber.get(surah.number);
        const memorized = p?.memorized_count ?? 0;
        return {
          surah,
          memorized,
          percent: surah.ayah_count > 0 ? (memorized / surah.ayah_count) * 100 : 0,
        };
      })
      .filter((row) => {
        if (filter === "started") return row.memorized > 0 && row.percent < 100;
        if (filter === "completed") return row.percent >= 100;
        return true;
      });
  }, [surahs, progress.data, filter]);

  const percentTotal =
    overview && overview.total_verses > 0
      ? (overview.verses_memorized / overview.total_verses) * 100
      : 0;

  return (
    <Page
      title="Memorization"
      description="Ayahs you've marked as memorized, surah by surah."
      wide
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Ayahs memorized"
          value={overview?.verses_memorized ?? 0}
          hint={`of ${overview?.total_verses ?? 6236}`}
          icon={<BookMarked className="size-4" />}
          accent={(overview?.verses_memorized ?? 0) > 0}
        />
        <StatTile
          label="Of the Quran"
          value={formatPercent(percentTotal, 2)}
          hint="Overall progress"
        />
        <StatTile
          label="Surahs completed"
          value={overview?.surahs_completed ?? 0}
          hint="Every ayah marked"
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatTile
          label="Surahs started"
          value={rows.filter((r) => r.memorized > 0).length}
          hint="At least one ayah"
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="By surah"
          action={
            <div className="flex gap-1 rounded-lg bg-surface-2 p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilter(f.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[0.75rem] font-medium transition-colors",
                    filter === f.value
                      ? "bg-surface text-fg shadow-sm"
                      : "text-fg-subtle hover:text-fg",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          }
        />
        <CardBody>
          {progress.isLoading ? (
            <LoadingBlock />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg-subtle">
              Nothing here yet. Mark ayahs as memorized while reading.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map(({ surah, memorized, percent }) => (
                <Link
                  key={surah.number}
                  to={`/read/${firstRukuOfSurah.get(surah.number) ?? 1}`}
                  className="flex items-center gap-4 py-2.5 transition-colors hover:bg-surface-2/50"
                >
                  <span className="w-8 shrink-0 text-right text-[0.8125rem] tabular-nums text-fg-subtle">
                    {surah.number}
                  </span>
                  <span className="w-40 shrink-0 truncate text-sm text-fg">
                    {surah.name_english}
                  </span>
                  <ProgressBar
                    value={percent}
                    className="flex-1"
                    tone={percent >= 100 ? "accent" : "gold"}
                  />
                  <span className="w-20 shrink-0 text-right text-[0.75rem] tabular-nums text-fg-subtle">
                    {memorized}/{surah.ayah_count}
                  </span>
                  {percent >= 100 ? (
                    <CheckCircle2 className="size-4 shrink-0 text-accent" aria-hidden />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </Page>
  );
}
