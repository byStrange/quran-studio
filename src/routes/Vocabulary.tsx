import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GraduationCap, Library } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useSurahs } from "@/hooks/useQuranData";
import { useSetWordStatus } from "@/hooks/useProgress";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, StatTile } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/primitives";
import { EmptyState, LoadingBlock } from "@/components/ui/feedback";
import { cn, verseKey } from "@/lib/utils";
import type { WordStatus } from "@/lib/types";

interface VocabRow {
  status: WordStatus;
  review_count: number;
  correct_count: number;
  word: {
    id: number;
    arabic: string;
    transliteration: string | null;
    gloss_en: string | null;
    verse: { surah_number: number; ayah_number: number; ruku_number: number };
  };
}

const STATUS_FILTERS = [
  { value: "all", label: "All words" },
  { value: "learning", label: "Learning" },
  { value: "learned", label: "Learned" },
] as const;

export function Vocabulary() {
  const { user } = useAuth();
  const { data: surahs } = useSurahs();
  const setStatus = useSetWordStatus();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [surahFilter, setSurahFilter] = useState<string>("all");

  const overview = useQuery({
    queryKey: ["vocabulary-overview", user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("vocabulary_overview");
      if (error) throw error;
      return data as unknown as {
        encountered: number;
        learned: number;
        learning: number;
        rukus_read: number;
      };
    },
  });

  const words = useQuery({
    queryKey: ["vocabulary", user?.id, statusFilter, surahFilter],
    enabled: Boolean(user),
    queryFn: async (): Promise<VocabRow[]> => {
      let query = supabase
        .from("user_word_progress")
        .select(
          "status, review_count, correct_count, " +
            "word:quran_words!inner(id, arabic, transliteration, gloss_en, " +
            "verse:quran_verses!inner(surah_number, ayah_number, ruku_number))",
        )
        .order("updated_at", { ascending: false })
        .limit(500);

      if (statusFilter !== "all") query = query.eq("status", statusFilter as WordStatus);
      if (surahFilter !== "all") {
        query = query.eq("word.verse.surah_number", Number(surahFilter));
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as VocabRow[];
    },
  });

  const surahOptions = useMemo(
    () => [
      { value: "all", label: "All surahs" },
      ...(surahs ?? []).map((s) => ({
        value: String(s.number),
        label: `${s.number}. ${s.name_english}`,
      })),
    ],
    [surahs],
  );

  return (
    <Page
      title="Vocabulary"
      description="Every word you've marked while reading, and how well you know it."
      wide
      action={
        <Button asChild variant="primary">
          <Link to="/quiz">
            <GraduationCap className="size-4" aria-hidden />
            Start quiz
          </Link>
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Encountered" value={overview.data?.encountered ?? 0} hint="Words in rukus you've read" />
        <StatTile label="Learned" value={overview.data?.learned ?? 0} accent icon={<Library className="size-4" />} />
        <StatTile label="Learning" value={overview.data?.learning ?? 0} hint="Still in progress" />
        <StatTile label="Rukus read" value={overview.data?.rukus_read ?? 0} hint="Lessons visited" />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <SelectField
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={STATUS_FILTERS}
          className="w-full sm:w-44"
        />
        <SelectField
          value={surahFilter}
          onValueChange={setSurahFilter}
          options={surahOptions}
          className="w-full sm:w-60"
        />
      </div>

      <Card className="mt-4">
        {words.isLoading ? (
          <LoadingBlock />
        ) : (words.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Library className="size-5" />}
            title="No words yet"
            description="Open a ruku, expand the word-by-word view, and mark words as learning or learned. They'll collect here."
            action={
              <Button asChild variant="primary">
                <Link to="/browse">Browse rukus</Link>
              </Button>
            }
          />
        ) : (
          <CardBody className="pt-5">
            <div className="divide-y divide-border">
              {(words.data ?? []).map((row) => (
                <div key={row.word.id} className="flex items-center gap-3 py-3 first:pt-0 md:gap-4">
                  <div className="w-20 shrink-0 text-right md:w-28">
                    <div className="arabic-sm text-fg">{row.word.arabic}</div>
                    {row.word.transliteration ? (
                      // Arabic descenders reach well below the baseline, so the
                      // transliteration needs its own breathing room.
                      <div className="mt-1 text-[0.6875rem] italic leading-none text-fg-subtle">
                        {row.word.transliteration}
                      </div>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Wraps on a phone, where there is no width to truncate
                        into and the gloss is the point of the row. */}
                    <div className="text-sm text-fg md:truncate">{row.word.gloss_en}</div>
                    <Link
                      to={`/read/${row.word.verse.ruku_number}`}
                      className="text-[0.75rem] text-fg-subtle transition-colors hover:text-accent"
                    >
                      {verseKey(row.word.verse.surah_number, row.word.verse.ayah_number)}
                    </Link>
                  </div>

                  {row.review_count > 0 ? (
                    <div className="hidden w-24 shrink-0 text-[0.75rem] tabular-nums text-fg-subtle sm:block">
                      {row.correct_count}/{row.review_count} correct
                    </div>
                  ) : (
                    <div className="hidden w-24 shrink-0 text-[0.75rem] text-fg-subtle sm:block">
                      Not quizzed
                    </div>
                  )}

                  <button
                    onClick={() =>
                      setStatus.mutate({
                        wordId: row.word.id,
                        status: row.status === "learned" ? "learning" : "learned",
                      })
                    }
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium transition-colors",
                      row.status === "learned"
                        ? "border-accent/40 bg-accent-soft text-accent-soft-fg"
                        : "border-gold/40 bg-gold-soft/60 text-fg-muted hover:border-gold",
                    )}
                  >
                    {row.status === "learned" ? "Learned" : "Learning"}
                  </button>
                </div>
              ))}
            </div>
          </CardBody>
        )}
      </Card>
    </Page>
  );
}
