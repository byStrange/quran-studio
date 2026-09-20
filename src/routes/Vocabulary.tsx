import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock, GraduationCap, Library } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useSurahs } from "@/hooks/useQuranData";
import { useSetWordsStatus, useVocabularyOverview } from "@/hooks/useProgress";
import { useIntervalUnits, useLanguage, useT } from "@/providers/I18nProvider";
import { wordGloss } from "@/lib/language";
import { formatInterval, isDue, minutesUntil } from "@/lib/vocabulary";
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
  /** When the card next wants asking. Null only for rows written before the schedule. */
  due_at: string | null;
  word: {
    id: number;
    arabic: string;
    transliteration: string | null;
    gloss_en: string | null;
    gloss_ru: string | null;
    verse: { surah_number: number; ayah_number: number; ruku_number: number };
  };
}

export function Vocabulary() {
  const t = useT();
  const { user } = useAuth();
  const language = useLanguage();
  const { data: surahs } = useSurahs();
  const setStatus = useSetWordsStatus();
  const units = useIntervalUnits();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [surahFilter, setSurahFilter] = useState<string>("all");

  const overview = useVocabularyOverview();

  const words = useQuery({
    queryKey: ["vocabulary", user?.id, statusFilter, surahFilter],
    enabled: Boolean(user),
    queryFn: async (): Promise<VocabRow[]> => {
      let query = supabase
        .from("user_word_progress")
        .select(
          "status, review_count, correct_count, due_at, " +
            "word:quran_words!inner(id, arabic, transliteration, gloss_en, gloss_ru, " +
            "verse:quran_verses!inner(surah_number, ayah_number, ruku_number))",
        )
        .limit(500);

      // Due words are ordered by how overdue they are, everything else by when
      // it was last touched: the first list is a queue to work through, the
      // second is a record to look things up in.
      if (statusFilter === "due") {
        query = query.lte("due_at", new Date().toISOString()).order("due_at", { ascending: true });
      } else {
        query = query.order("updated_at", { ascending: false });
        if (statusFilter !== "all") query = query.eq("status", statusFilter as WordStatus);
      }
      if (surahFilter !== "all") {
        query = query.eq("word.verse.surah_number", Number(surahFilter));
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as VocabRow[];
    },
  });

  const statusFilters = [
    { value: "all", label: t("vocab.allWords") },
    { value: "due", label: t("vocab.dueNow") },
    { value: "learning", label: t("vocab.learning") },
    { value: "learned", label: t("vocab.learned") },
  ];

  const surahOptions = useMemo(
    () => [
      { value: "all", label: t("vocab.allSurahs") },
      ...(surahs ?? []).map((s) => ({
        value: String(s.number),
        label: `${s.number}. ${s.name_english}`,
      })),
    ],
    [surahs, t],
  );

  return (
    <Page
      title={t("vocab.title")}
      description={t("vocab.description")}
      wide
      action={
        <Button asChild variant="primary">
          <Link to="/quiz">
            <GraduationCap className="size-4" aria-hidden />
            {t("vocab.startQuiz")}
          </Link>
        </Button>
      }
    >
      {/* "Due" leads, and it is the only tile that is a thing to do rather
          than a score: how many words are learned settles slowly and says
          nothing about this evening. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile
          label={t("vocab.dueNow")}
          value={overview.data?.due ?? 0}
          accent
          icon={<AlarmClock className="size-4" />}
          hint={t("vocab.dueNowHint")}
        />
        <StatTile
          label={t("vocab.learned")}
          value={overview.data?.learned ?? 0}
          icon={<Library className="size-4" />}
          hint={t("vocab.learnedHint")}
        />
        <StatTile
          label={t("vocab.learning")}
          value={overview.data?.learning ?? 0}
          hint={t("vocab.learningHint")}
        />
        <StatTile
          label={t("vocab.encountered")}
          value={overview.data?.encountered ?? 0}
          hint={t("vocab.encounteredHint")}
        />
        <StatTile
          label={t("vocab.rukusRead")}
          value={overview.data?.rukus_read ?? 0}
          hint={t("vocab.rukusReadHint")}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <SelectField
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={statusFilters}
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
            title={t("vocab.emptyTitle")}
            description={t("vocab.emptyDescription")}
            action={
              <Button asChild variant="primary">
                <Link to="/browse">{t("vocab.browseRukus")}</Link>
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
                    <div className="text-sm text-fg md:truncate">{wordGloss(row.word, language)}</div>
                    <Link
                      to={`/read/${row.word.verse.ruku_number}`}
                      className="text-[0.75rem] text-fg-subtle transition-colors hover:text-accent"
                    >
                      {verseKey(row.word.verse.surah_number, row.word.verse.ayah_number)}
                    </Link>
                  </div>

                  {/* The schedule sits where the tally used to, because it is
                      the thing that has an answer: "3/5 correct" is a history,
                      "due now" and "out at 2mo" are where the word stands. The
                      tally stays underneath it, smaller. */}
                  <div className="hidden w-28 shrink-0 text-right sm:block">
                    <div
                      className={cn(
                        "text-[0.75rem] tabular-nums",
                        isDue(row.due_at) ? "font-medium text-gold-soft-fg" : "text-fg-subtle",
                      )}
                    >
                      {row.review_count === 0
                        ? t("vocab.notQuizzed")
                        : isDue(row.due_at)
                          ? t("vocab.dueNow")
                          : t("vocab.dueIn", {
                              interval: formatInterval(minutesUntil(row.due_at) ?? 0, units),
                            })}
                    </div>
                    {row.review_count > 0 ? (
                      <div className="mt-0.5 text-[0.6875rem] tabular-nums text-fg-subtle">
                        {t("vocab.correctOf", {
                          correct: row.correct_count,
                          total: row.review_count,
                        })}
                      </div>
                    ) : null}
                  </div>

                  <button
                    onClick={() =>
                      setStatus.mutate({
                        wordIds: [row.word.id],
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
                    {row.status === "learned" ? t("vocab.learned") : t("vocab.learning")}
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
