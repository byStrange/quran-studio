import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Coffee,
  Expand,
  LayoutList,
  ListTree,
  Palette,
} from "lucide-react";
import { useRuku, useRukuVerses, useSurahs } from "@/hooks/useQuranData";
import { useMemorizedVerses, useToggleMemorized, useWordProgress } from "@/hooks/useProgress";
import { useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useReadingTimer } from "@/hooks/useReadingTimer";
import { ayahRangeLabel, cn, formatClock } from "@/lib/utils";
import { VerseCard } from "@/components/reader/VerseCard";
import { FocusMode } from "@/components/reader/FocusMode";
import { TafsirPanel } from "@/components/reader/TafsirPanel";
import { TajweedLegend } from "@/components/reader/TajweedLegend";
import { RukuSummaryCard } from "@/components/reader/RukuSummaryCard";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { ProgressBar, Tooltip } from "@/components/ui/primitives";

const TOTAL_RUKUS = 558;
const SPLIT_STORAGE_KEY = "qs.readerSplit";

export function Reader() {
  const params = useParams<{ rukuNumber: string }>();
  const navigate = useNavigate();
  const rukuNumber = Number(params.rukuNumber);
  const valid = Number.isFinite(rukuNumber) && rukuNumber >= 1 && rukuNumber <= TOTAL_RUKUS;

  const { data: ruku, isLoading: rukuLoading } = useRuku(valid ? rukuNumber : null);
  const {
    data: verses,
    isLoading: versesLoading,
    isError,
    refetch,
  } = useRukuVerses(valid ? rukuNumber : null);
  const { data: surahs } = useSurahs();
  const prefs = useUiPrefs();
  const updateProfile = useUpdateProfile();

  const verseIds = useMemo(() => (verses ?? []).map((v) => v.id), [verses]);
  const wordIds = useMemo(() => (verses ?? []).flatMap((v) => v.words.map((w) => w.id)), [verses]);
  const { data: memorized } = useMemorizedVerses(verseIds);
  const { data: wordStatuses } = useWordProgress(wordIds);
  const toggleMemorized = useToggleMemorized();

  const [selectedAyah, setSelectedAyah] = useState<number | null>(null);
  const [expandedVerses, setExpandedVerses] = useState<Set<number>>(new Set());
  const [focusMode, setFocusMode] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const { sessionSeconds, idle } = useReadingTimer(valid ? rukuNumber : null);

  const surah = surahs?.find((s) => s.number === ruku?.surah_number);

  // Reset per-ruku view state when navigating between lessons.
  useEffect(() => {
    setSelectedAyah(null);
    setExpandedVerses(prefs.wordsExpanded ? new Set(verseIds) : new Set());
    document.querySelector("[data-verse-scroll]")?.scrollTo({ top: 0 });
  }, [rukuNumber, prefs.wordsExpanded, verseIds]);

  // Focus mode can walk off either end of a ruku into the next one. Which end
  // of the new ruku it lands on depends on the direction it left in — and the
  // verses may still be loading when the route param changes, so placement
  // waits for them and happens exactly once per ruku.
  const focusEntryEdge = useRef<"start" | "end">("start");
  const placedRuku = useRef<number | null>(null);
  useEffect(() => {
    if (!verses?.length || placedRuku.current === rukuNumber) return;
    placedRuku.current = rukuNumber;
    setFocusIndex(focusEntryEdge.current === "end" ? verses.length - 1 : 0);
    focusEntryEdge.current = "start";
  }, [rukuNumber, verses]);

  // Keep the tafsir panel pointed at whatever focus mode is showing, so the
  // reader is already on the right ayah when the user comes back out.
  useEffect(() => {
    if (!focusMode) return;
    const verse = verses?.[focusIndex];
    if (verse) setSelectedAyah(verse.ayah_number);
  }, [focusMode, focusIndex, verses]);

  const openFocus = useCallback((index: number) => {
    setFocusIndex(index);
    setFocusMode(true);
  }, []);

  const exitFocus = useCallback(() => {
    setFocusMode(false);
    const verse = verses?.[focusIndex];
    if (!verse) return;
    // Land on the ayah that was being read rather than the old scroll offset.
    requestAnimationFrame(() => {
      document.getElementById(`verse-${verse.id}`)?.scrollIntoView({ block: "center" });
    });
  }, [verses, focusIndex]);

  // `F` from the reader opens focus mode on the selected ayah, or the first.
  useEffect(() => {
    if (focusMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "f" || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest("input, textarea")) return;
      if (!verses?.length) return;
      const index = verses.findIndex((v) => v.ayah_number === selectedAyah);
      openFocus(index >= 0 ? index : 0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, verses, selectedAyah, openFocus]);

  const toggleWords = useCallback((verseId: number) => {
    setExpandedVerses((current) => {
      const next = new Set(current);
      if (next.has(verseId)) next.delete(verseId);
      else next.add(verseId);
      return next;
    });
  }, []);

  const toggleTajweed = useCallback(() => {
    updateProfile.mutate({ ui_prefs: { tajweed: !prefs.tajweed } });
  }, [prefs.tajweed, updateProfile]);

  const memorizedCount = useMemo(
    () => verseIds.filter((id) => memorized?.has(id)).length,
    [verseIds, memorized],
  );

  if (!valid) {
    return (
      <div className="p-8">
        <ErrorState
          title="That ruku doesn't exist"
          message={`Rukus run from 1 to ${TOTAL_RUKUS}.`}
          onRetry={() => navigate("/browse")}
        />
      </div>
    );
  }

  const tafsirFirst = prefs.tafsirSide === "left";

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border bg-surface/60 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              disabled={rukuNumber <= 1}
              onClick={() => navigate(`/read/${rukuNumber - 1}`)}
              aria-label="Previous ruku"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>

            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-fg">
                  {surah?.name_english ?? "…"}
                </h1>
                {ruku ? (
                  <span className="shrink-0 text-[0.8125rem] text-fg-subtle">
                    {ayahRangeLabel(ruku.ayah_start, ruku.ayah_end)}
                  </span>
                ) : null}
              </div>
              <div className="text-[0.6875rem] text-fg-subtle">
                Ruku {rukuNumber} of {TOTAL_RUKUS}
                {ruku ? ` · ruku ${ruku.ruku_in_surah} in this surah` : ""}
              </div>
            </div>

            <Button
              size="icon"
              variant="ghost"
              disabled={rukuNumber >= TOTAL_RUKUS}
              onClick={() => navigate(`/read/${rukuNumber + 1}`)}
              aria-label="Next ruku"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="flex items-center gap-3">
            {verseIds.length > 0 ? (
              <div className="hidden items-center gap-2.5 md:flex">
                <span className="text-[0.75rem] tabular-nums text-fg-subtle">
                  {memorizedCount}/{verseIds.length} memorized
                </span>
                <ProgressBar
                  value={(memorizedCount / verseIds.length) * 100}
                  className="w-20"
                />
              </div>
            ) : null}

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

            <Tooltip content="Focus mode — one ayah, fullscreen (F)">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Enter focus mode"
                disabled={!verses?.length}
                onClick={() => {
                  const index = (verses ?? []).findIndex((v) => v.ayah_number === selectedAyah);
                  openFocus(index >= 0 ? index : 0);
                }}
              >
                <Expand className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip
              content={
                prefs.tajweed ? "Turn off tajweed colouring" : "Colour the text by tajweed rule"
              }
            >
              <Button
                size="icon"
                variant={prefs.tajweed ? "outline" : "ghost"}
                aria-label="Toggle tajweed colouring"
                aria-pressed={prefs.tajweed}
                onClick={toggleTajweed}
              >
                <Palette className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content="Expand every word breakdown">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Toggle all word breakdowns"
                onClick={() =>
                  setExpandedVerses((current) =>
                    current.size === verseIds.length ? new Set() : new Set(verseIds),
                  )
                }
              >
                {expandedVerses.size === verseIds.length && verseIds.length > 0 ? (
                  <LayoutList className="size-4" aria-hidden />
                ) : (
                  <ListTree className="size-4" aria-hidden />
                )}
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
        </div>
      </header>

      {isError ? (
        <div className="p-8">
          <ErrorState
            title="Couldn't load this ruku"
            message="The Quran text lives in your Supabase project. Check your connection and try again."
            onRetry={() => void refetch()}
          />
        </div>
      ) : rukuLoading || versesLoading ? (
        <LoadingBlock label="Loading ruku…" />
      ) : (
        <SplitPane
          tafsirFirst={tafsirFirst}
          reader={
            <div data-verse-scroll className="h-full overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-3xl space-y-4">
                {prefs.tajweed ? <TajweedLegend /> : null}

                <RukuSummaryCard
                  rukuNumber={rukuNumber}
                  surahName={surah?.name_english ?? ""}
                  verses={verses ?? []}
                />

                {(verses ?? []).map((verse, index) => (
                  <VerseCard
                    key={verse.id}
                    verse={verse}
                    memorized={memorized?.has(verse.id) ?? false}
                    onToggleMemorized={() =>
                      toggleMemorized.mutate({
                        verseId: verse.id,
                        memorized: !(memorized?.has(verse.id) ?? false),
                      })
                    }
                    selected={selectedAyah === verse.ayah_number}
                    onSelect={() => setSelectedAyah(verse.ayah_number)}
                    wordsExpanded={expandedVerses.has(verse.id)}
                    onToggleWords={() => toggleWords(verse.id)}
                    wordStatuses={wordStatuses ?? new Map()}
                    onOpenFocus={() => openFocus(index)}
                    tajweed={prefs.tajweed}
                  />
                ))}

                <div className="flex items-center justify-between pt-2 pb-8">
                  <Button
                    variant="outline"
                    disabled={rukuNumber <= 1}
                    onClick={() => navigate(`/read/${rukuNumber - 1}`)}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    Previous ruku
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to="/browse">All rukus</Link>
                  </Button>
                  <Button
                    variant="primary"
                    disabled={rukuNumber >= TOTAL_RUKUS}
                    onClick={() => navigate(`/read/${rukuNumber + 1}`)}
                  >
                    Next ruku
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
          }
          tafsir={
            <TafsirPanel
              surahNumber={ruku?.surah_number ?? null}
              ayahNumber={selectedAyah}
              surahName={surah?.name_english ?? ""}
            />
          }
        />
      )}

      {focusMode ? (
        <FocusMode
          verses={verses ?? []}
          index={focusIndex}
          onIndexChange={setFocusIndex}
          onExit={exitFocus}
          surahName={surah?.name_english ?? ""}
          rukuNumber={rukuNumber}
          rukuInSurah={ruku?.ruku_in_surah ?? null}
          memorized={memorized ?? new Set()}
          onToggleMemorized={(verse) =>
            toggleMemorized.mutate({
              verseId: verse.id,
              memorized: !(memorized?.has(verse.id) ?? false),
            })
          }
          wordStatuses={wordStatuses ?? new Map()}
          sessionSeconds={sessionSeconds}
          loading={versesLoading}
          tajweed={prefs.tajweed}
          onToggleTajweed={toggleTajweed}
          onPrevRuku={
            rukuNumber > 1
              ? () => {
                  focusEntryEdge.current = "end";
                  navigate(`/read/${rukuNumber - 1}`);
                }
              : undefined
          }
          onNextRuku={
            rukuNumber < TOTAL_RUKUS
              ? () => {
                  focusEntryEdge.current = "start";
                  navigate(`/read/${rukuNumber + 1}`);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Two panes with a draggable divider. The split is stored locally rather than
 * in the profile — it's a per-window layout choice, not a study preference.
 */
function SplitPane({
  reader,
  tafsir,
  tafsirFirst,
}: {
  reader: React.ReactNode;
  tafsir: React.ReactNode;
  tafsirFirst: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tafsirWidth, setTafsirWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 20 && stored <= 60 ? stored : 38;
  });
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fromLeft = ((event.clientX - rect.left) / rect.width) * 100;
      const next = tafsirFirst ? fromLeft : 100 - fromLeft;
      setTafsirWidth(Math.min(60, Math.max(20, next)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      setTafsirWidth((width) => {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(width));
        return width;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [tafsirFirst]);

  const divider = (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={() => {
        dragging.current = true;
        document.body.style.cursor = "col-resize";
      }}
      className="group relative w-px shrink-0 cursor-col-resize bg-border"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-accent/20" />
    </div>
  );

  const tafsirPane = (
    <div
      className="min-w-0 shrink-0 border-border bg-surface/40"
      style={{ width: `${tafsirWidth}%` }}
    >
      {tafsir}
    </div>
  );

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      {tafsirFirst ? (
        <>
          {tafsirPane}
          {divider}
          <div className="min-w-0 flex-1">{reader}</div>
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1">{reader}</div>
          {divider}
          {tafsirPane}
        </>
      )}
    </div>
  );
}
