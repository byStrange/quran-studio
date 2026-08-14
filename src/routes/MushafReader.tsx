/**
 * Page-by-page reader: the printed Madani mushaf, one page at a time.
 *
 * This is a sibling of the ruku reader rather than a mode inside it, because
 * the two navigate by different units — a ruku is a unit of study, a page is a
 * unit of the physical book, and neither divides the other. The header toggle
 * hands over at the reader's current position, so switching does not lose the
 * reader's place.
 *
 * Reading time is still logged against a ruku. The page is the view; the ruku
 * remains the thing progress is measured in, so the dashboard, streak and
 * memorization counters need no notion of pages at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  BookOpen,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Coffee,
} from "lucide-react";
import { useSurahs } from "@/hooks/useQuranData";
import { useMushafPage, useMushafPageVerses, useRukusOnPage } from "@/hooks/useMushafPage";
import { prefetchPageFont, useMushafScale } from "@/hooks/useMushafScale";
import { useMemorizedVerses } from "@/hooks/useProgress";
import { useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useReadingTimer } from "@/hooks/useReadingTimer";
import { isValidPage, pageFontFamily, TOTAL_PAGES } from "@/lib/mushaf";
import { cn, formatClock } from "@/lib/utils";
import { MushafPage } from "@/components/reader/MushafPage";
import { SplitPane } from "@/components/reader/SplitPane";
import { TafsirPanel } from "@/components/reader/TafsirPanel";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Tooltip } from "@/components/ui/primitives";

export function MushafReader() {
  const params = useParams<{ pageNumber: string }>();
  const navigate = useNavigate();
  const pageNumber = Number(params.pageNumber);
  const valid = isValidPage(pageNumber);

  const prefs = useUiPrefs();
  const updateProfile = useUpdateProfile();

  const {
    data: page,
    isLoading,
    isError,
    refetch,
  } = useMushafPage(valid ? pageNumber : null);
  const { data: nextPage } = useMushafPage(valid && pageNumber < TOTAL_PAGES ? pageNumber + 1 : null);
  const { data: surahs } = useSurahs();
  const { data: rukus } = useRukusOnPage(valid ? pageNumber : null);

  const verseIds = useMemo(() => page?.verseIds ?? [], [page]);
  const { data: verses } = useMushafPageVerses(verseIds);
  const { data: memorized } = useMemorizedVerses(verseIds);

  // Reading time belongs to the ruku the page opens in, so page view feeds the
  // same streak and history as the ruku reader.
  const { sessionSeconds, idle } = useReadingTimer(rukus?.[0]?.ruku_number ?? null);

  const [selectedVerseId, setSelectedVerseId] = useState<number | null>(null);
  // Only consulted below md, where the tafsir is a sheet rather than a column.
  const [tafsirOpen, setTafsirOpen] = useState(false);

  // The measure the page is fitted to, tracked live so the mushaf reflows with
  // the window and the tafsir divider.
  const measureRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = measureRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry?.contentRect.width ?? null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [page]);

  const { fontSize, error: scaleError } = useMushafScale(page, availableWidth);

  // Turning the page is the common action, so the next page's font is fetched
  // while the current one is being read.
  useEffect(() => {
    if (!nextPage) return;
    const sample = nextPage.lines.find((line) => line.glyphs.length > 0)?.glyphs[0]?.glyph;
    prefetchPageFont(nextPage.page, sample);
  }, [nextPage]);

  // Default the tafsir panel to the page's first ayah, and reset on turning.
  useEffect(() => {
    setSelectedVerseId(verseIds[0] ?? null);
    document.querySelector("[data-mushaf-scroll]")?.scrollTo({ top: 0 });
  }, [verseIds]);

  const goTo = useCallback(
    (target: number) => {
      if (isValidPage(target)) navigate(`/read/page/${target}`);
    },
    [navigate],
  );

  // Arrow keys turn pages, the way they would in any page-based reader.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("input, textarea")) return;
      // RTL: left turns forward, matching the direction the book is read in.
      if (event.key === "ArrowLeft") goTo(pageNumber + 1);
      else if (event.key === "ArrowRight") goTo(pageNumber - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, pageNumber]);

  const selectedVerse = verses?.find((verse) => verse.id === selectedVerseId) ?? null;
  const surah = surahs?.find((s) => s.number === selectedVerse?.surah_number);
  const memorizedIds = useMemo(() => memorized ?? new Set<number>(), [memorized]);

  /** Hands over to the ruku reader at the ayah currently selected. */
  const switchToStudy = useCallback(() => {
    const ruku = selectedVerse?.ruku_number ?? rukus?.[0]?.ruku_number;
    updateProfile.mutate({ ui_prefs: { readerMode: "study" } });
    navigate(ruku ? `/read/${ruku}` : "/browse");
  }, [selectedVerse, rukus, navigate, updateProfile]);

  if (!valid) {
    return (
      <div className="p-8">
        <ErrorState
          title="That page doesn't exist"
          message={`The mushaf runs from page 1 to ${TOTAL_PAGES}.`}
          onRetry={() => navigate("/browse")}
        />
      </div>
    );
  }

  const tafsirFirst = prefs.tafsirSide === "left";
  const currentJuz = verses?.[0]?.juz_number ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border bg-surface/60 px-3 py-2.5 backdrop-blur md:px-6 md:py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              disabled={pageNumber <= 1}
              onClick={() => goTo(pageNumber - 1)}
              aria-label="Previous page"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>

            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-fg">
                  {surah?.name_english ?? "…"}
                </h1>
                {currentJuz !== null ? (
                  <span className="shrink-0 text-[0.8125rem] text-fg-subtle">Juz {currentJuz}</span>
                ) : null}
              </div>
              <div className="text-[0.6875rem] text-fg-subtle">
                Page {pageNumber} of {TOTAL_PAGES}
                {rukus?.length ? ` · ruku ${rukus[0]!.ruku_number}` : ""}
              </div>
            </div>

            <Button
              size="icon"
              variant="ghost"
              disabled={pageNumber >= TOTAL_PAGES}
              onClick={() => goTo(pageNumber + 1)}
              aria-label="Next page"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
          </div>

          {/* The page itself is the point on a phone, so the header keeps only
              what changes what you are looking at. */}
          <div className="hidden items-center gap-3 md:flex">
            <Tooltip
              content={
                idle
                  ? "Paused — the timer resumes when you interact again."
                  : "Time counted toward today's reading."
              }
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[0.75rem] tabular-nums",
                  idle
                    ? "border-border bg-surface-2 text-fg-subtle"
                    : "border-accent/30 bg-accent-soft/40 text-accent-soft-fg",
                )}
              >
                {idle ? (
                  <Coffee className="size-3.5" aria-hidden />
                ) : (
                  <Clock className="size-3.5" aria-hidden />
                )}
                {formatClock(sessionSeconds)}
              </div>
            </Tooltip>

            <Tooltip content="Switch to the study reader — translation and word by word">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Switch to study reader"
                onClick={switchToStudy}
              >
                <BookOpenText className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content="Swap the tafsir panel to the other side">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Swap panel side"
                onClick={() =>
                  updateProfile.mutate({
                    ui_prefs: { tafsirSide: tafsirFirst ? "right" : "left" },
                  })
                }
              >
                <Columns2 className="size-4" aria-hidden />
              </Button>
            </Tooltip>
          </div>

          <div className="flex items-center gap-0.5 md:hidden">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Open tafsir"
              onClick={() => setTafsirOpen(true)}
            >
              <BookOpen className="size-4" aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Switch to study reader"
              onClick={switchToStudy}
            >
              <BookOpenText className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </header>

      {isError || scaleError ? (
        <div className="p-8">
          <ErrorState
            title="Couldn't load this page"
            message={
              scaleError
                ? "The mushaf page fonts are missing. Run `pnpm fonts:qcf` to vendor them."
                : "The mushaf layout lives in your Supabase project. Check your connection and try again."
            }
            onRetry={() => void refetch()}
          />
        </div>
      ) : isLoading || !page ? (
        <LoadingBlock label="Loading page…" />
      ) : (
        <SplitPane
          tafsirFirst={tafsirFirst}
          tafsirOpen={tafsirOpen}
          onTafsirOpenChange={setTafsirOpen}
          reader={
            <div data-mushaf-scroll className="h-full overflow-y-auto px-2 py-3 md:px-6 md:py-6">
              <div className="mx-auto max-w-3xl">
                {/* Horizontal padding is subtracted from the width the mushaf
                    scale is computed against, so a phone gives it back. */}
                <div className="rounded-card border border-border bg-surface px-3 py-5 shadow-sm md:px-8 md:py-7">
                  <div ref={measureRef}>
                    <MushafPage
                      page={page}
                      fontFamily={pageFontFamily(page.page)}
                      fontSize={fontSize}
                      selectedVerseId={selectedVerseId}
                      onSelectVerse={setSelectedVerseId}
                      memorized={memorizedIds}
                    />
                  </div>

                  <div className="mt-6 border-t border-border pt-3 text-center text-[0.75rem] tabular-nums text-fg-subtle">
                    {pageNumber}
                  </div>
                </div>

                {selectedVerse ? (
                  <p
                    className="mt-4 text-[0.9375rem] leading-relaxed text-fg-muted"
                    data-selectable
                  >
                    <span className="mr-2 text-fg-subtle tabular-nums">
                      {selectedVerse.surah_number}:{selectedVerse.ayah_number}
                    </span>
                    {selectedVerse.translation_en}
                  </p>
                ) : null}

                <div className="flex items-center justify-between pt-6 pb-8">
                  <Button
                    variant="outline"
                    disabled={pageNumber <= 1}
                    onClick={() => goTo(pageNumber - 1)}
                  >
                    <ChevronRight className="size-4" aria-hidden />
                    Previous page
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/browse">All rukus</Link>
                  </Button>
                  <Button
                    variant="primary"
                    disabled={pageNumber >= TOTAL_PAGES}
                    onClick={() => goTo(pageNumber + 1)}
                  >
                    Next page
                    <ChevronLeft className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
          }
          tafsir={
            <TafsirPanel
              surahNumber={selectedVerse?.surah_number ?? null}
              ayahNumber={selectedVerse?.ayah_number ?? null}
              surahName={surah?.name_english ?? ""}
            />
          }
        />
      )}
    </div>
  );
}
