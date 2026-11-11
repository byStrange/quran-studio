import { useLayoutEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GraduationCap, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { describeAiError, fetchCachedRukuSummary, getRukuSummary, isTauri } from "@/lib/ai";
import type { VerseWithWords } from "@/lib/types";
import { useLanguage, useT } from "@/providers/I18nProvider";
import { ayahRangeLabel, toParagraphs } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";

/**
 * Summaries are shared across users, so this reads the cache first and only
 * asks the model when nothing is stored yet. Generation is user-initiated
 * rather than automatic, so opening a ruku is never gated on a network call.
 */
export function RukuSummaryCard({
  rukuNumber,
  surahName,
  verses,
}: {
  rukuNumber: number;
  surahName: string;
  verses: VerseWithWords[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const toast = useToast();
  const language = useLanguage();

  const cached = useQuery({
    queryKey: ["ruku-summary", rukuNumber, language],
    staleTime: Infinity,
    queryFn: () => fetchCachedRukuSummary(rukuNumber, language),
  });

  const generate = useMutation({
    mutationFn: (force: boolean) =>
      getRukuSummary(
        {
          rukuNumber,
          surahName,
          verseRange: verses.length
            ? ayahRangeLabel(verses[0]!.ayah_number, verses[verses.length - 1]!.ayah_number)
            : "",
          verses: verses.map((v) => ({
            ayah_number: v.ayah_number,
            translation_en: v.translation_en,
            translation_ru: v.translation_ru,
            translation_uz: v.translation_uz,
          })),
        },
        language,
        { force },
      ),
    onSuccess: (data) => queryClient.setQueryData(["ruku-summary", rukuNumber, language], data),
    onError: (error) => toast(describeAiError(error, t), "error"),
  });

  const summary = cached.data;
  const busy = generate.isPending;

  /**
   * Keeps the ayahs where they were when the stored summary arrives.
   *
   * The card sits above the first ayah and opens on a four-line skeleton; a
   * stored summary is several times taller, so without this every ayah drops
   * by the difference (130px in a full column, over 250px beside the tafsir
   * panel) a moment after the ruku opens — under a reader who has already
   * started on the first ayah. WebKit, which the desktop app renders with on
   * Linux and macOS, has no scroll anchoring to absorb it, and Chromium's
   * would not either, since the growing card is itself the anchor. So the
   * column is scrolled by the change instead: the summary unfolds upwards and
   * the Quran stays put. Only the load is compensated; generating is
   * something the reader asked for while looking at the card.
   */
  const sectionRef = useRef<HTMLElement>(null);
  const loadingHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (cached.isLoading) {
      loadingHeight.current = section.offsetHeight;
      return;
    }
    const before = loadingHeight.current;
    loadingHeight.current = null;
    if (before === null) return;
    const delta = section.offsetHeight - before;
    const scroller = section.closest<HTMLElement>("[data-verse-scroll]");
    if (!scroller || delta === 0) return;
    // Scrolled wholly past the card, an engine with scroll anchoring has
    // already held the ayah in view; adjusting again would overshoot.
    if (scroller.scrollTop >= before && CSS.supports("overflow-anchor", "auto")) return;
    scroller.scrollTop += delta;
  }, [cached.isLoading]);

  return (
    // Flush like everything else in the reading column; the tint alone marks
    // it out as the one block here that is not the Quran.
    <section
      ref={sectionRef}
      className="reader-gutter border-b border-border bg-accent-soft/20 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-accent-soft-fg">
          <Sparkles className="size-3.5" aria-hidden />
          {t("summary.title")}
        </div>
        {summary && !busy ? (
          <button
            onClick={() => generate.mutate(true)}
            className="inline-flex items-center gap-1 text-[0.6875rem] text-fg-subtle transition-colors hover:text-fg"
            title={t("summary.regenerateTitle")}
          >
            <RefreshCw className="size-3" aria-hidden />
            {t("common.regenerate")}
          </button>
        ) : null}
      </div>

      <div className="mt-3">
        {cached.isLoading || busy ? (
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-[95%]" />
            <Skeleton className="h-3.5 w-[88%]" />
            <Skeleton className="h-3.5 w-[60%]" />
          </div>
        ) : summary ? (
          <>
            <div className="prose-reading text-[0.9375rem] text-fg-muted" data-selectable>
              {toParagraphs(summary.summary).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {summary.model_used ? (
              <p className="mt-3 text-[0.6875rem] text-fg-subtle">
                {t("summary.generatedBy", { model: summary.model_used })}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-[0.875rem] leading-relaxed text-fg-muted">
              {isTauri() ? t("summary.none") : t("summary.needsDesktop")}
            </p>
            {isTauri() ? (
              <Button size="sm" variant="primary" onClick={() => generate.mutate(false)}>
                <WandSparkles className="size-3.5" aria-hidden />
                {t("summary.generate")}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {/* Finishing the ruku is where the words are worth learning, so the quiz
          is offered here rather than only from the browser. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-accent/20 pt-3">
        <Button asChild size="sm" variant="outline">
          <Link to={`/quiz?scope=ruku&ruku=${rukuNumber}&start=1`}>
            <GraduationCap className="size-3.5" aria-hidden />
            {t("reader.quizRukuWords")}
          </Link>
        </Button>
        <span className="text-[0.6875rem] text-fg-subtle">{t("summary.quizHint")}</span>
      </div>
    </section>
  );
}
