import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns2,
  Coffee,
  Expand,
  GraduationCap,
  LayoutList,
  ListTree,
  MoreHorizontal,
  Palette,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useRuku, useRukuVerses, useSurahs, useSurahVerseIds } from "@/hooks/useQuranData";
import {
  useMemorizedVerses,
  useTafsirReadVerses,
  useWordsLearnedVerses,
  useToggleMemorized,
  useToggleTafsirRead,
  useToggleWordsLearned,
  useWordProgress,
} from "@/hooks/useProgress";
import {
  useActiveReciter,
  useReciters,
  useRecitationFile,
  useRecitationTimings,
} from "@/hooks/useRecitation";
import { useRecitationPlayer } from "@/hooks/useRecitationPlayer";
import { useSurahDownload } from "@/hooks/useAudioDownloads";
import { useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useReadingTimer } from "@/hooks/useReadingTimer";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import type { RepeatMode } from "@/lib/types";
import { ayahRangeLabel, cn, formatClock } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import { AudioBar } from "@/components/reader/AudioBar";
import { VerseCard } from "@/components/reader/VerseCard";
import { SplitPane } from "@/components/reader/SplitPane";
import { FocusMode } from "@/components/reader/FocusMode";
import { TafsirPanel } from "@/components/reader/TafsirPanel";
import { TajweedLegend } from "@/components/reader/TajweedLegend";
import { RukuSummaryCard } from "@/components/reader/RukuSummaryCard";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { MenuButton, ProgressBar, Tooltip, type MenuAction } from "@/components/ui/primitives";

const TOTAL_RUKUS = 558;

export function Reader() {
  const t = useT();
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
  /**
   * The ayahs still being memorized. Repeat mode "unmemorized" loops these and
   * skips the rest, which is what a half-finished ruku needs drilled.
   */
  const unmemorizedVerseIds = useMemo(
    () => verseIds.filter((id) => !memorized?.has(id)),
    [verseIds, memorized],
  );
  const { data: wordsLearned } = useWordsLearnedVerses(verseIds);
  const { data: wordStatuses } = useWordProgress(wordIds);
  const toggleMemorized = useToggleMemorized();
  const toggleWordsLearned = useToggleWordsLearned();

  const surahNumber = ruku?.surah_number ?? null;

  const { data: surahVerseIds } = useSurahVerseIds(surahNumber);
  /**
   * The tafsir marker covers the whole surah, not just the ruku: a commentary
   * often runs past the ruku's last ayah, so the panel needs ids the ruku does
   * not hold. Scoping it here rather than to every marked ayah in the Quran
   * keeps the request at most 286 ids and clear of the REST layer's row cap.
   */
  const surahVerseIdList = useMemo(() => [...(surahVerseIds?.values() ?? [])], [surahVerseIds]);
  const { data: tafsirRead } = useTafsirReadVerses(surahVerseIdList);
  const toggleTafsirRead = useToggleTafsirRead();

  const [searchParams] = useSearchParams();
  const [selectedAyah, setSelectedAyah] = useState<number | null>(null);
  const [expandedVerses, setExpandedVerses] = useState<Set<number>>(new Set());
  const [focusMode, setFocusMode] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  // Only consulted below md, where the tafsir is a sheet rather than a column.
  const [tafsirOpen, setTafsirOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const { sessionSeconds, idle } = useReadingTimer(valid ? rukuNumber : null);

  const surah = surahs?.find((s) => s.number === ruku?.surah_number);

  // --- recitation ----------------------------------------------------------

  const { data: reciters } = useReciters();
  const reciter = useActiveReciter(prefs.reciterId);
  const { data: recitation } = useRecitationFile(reciter?.id ?? null, surahNumber);
  const { data: timings } = useRecitationTimings(reciter?.id ?? null, verseIds);

  const download = useSurahDownload({
    reciterId: reciter?.id ?? null,
    surahNumber,
    url: recitation?.audio_url ?? null,
    fileSize: recitation?.file_size ?? null,
  });

  const player = useRecitationPlayer({
    // A downloaded copy wins over the CDN whenever there is one, so a surah
    // saved for offline keeps playing when the connection doesn't.
    src: download.localSrc ?? recitation?.audio_url ?? null,
    verseIds,
    timings,
    rate: prefs.playbackRate,
    repeatMode: prefs.repeatMode,
    repeatUnmemorizedVerseIds: unmemorizedVerseIds,
  });

  const recitingVerseId = player.currentVerseId;

  /**
   * Keeps the ayah being recited on screen.
   *
   * Smooth scrolling rather than a jump: the ayah changes every few seconds
   * and a hard cut each time is disorienting to read against. In focus mode
   * there is nothing to scroll — the ayah on screen is chosen by index — so
   * following means moving the index instead.
   */
  useEffect(() => {
    if (recitingVerseId === null) return;
    if (!prefs.followRecitation) return;
    const index = (verses ?? []).findIndex((verse) => verse.id === recitingVerseId);
    if (index < 0) return;
    if (focusMode) {
      setFocusIndex(index);
      return;
    }
    document
      .getElementById(`verse-${recitingVerseId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [recitingVerseId, prefs.followRecitation, focusMode, verses]);

  // Reset per-ruku view state when navigating between lessons.
  useEffect(() => {
    setSelectedAyah(null);
    setExpandedVerses(prefs.wordsExpanded ? new Set(verseIds) : new Set());
    document.querySelector("[data-verse-scroll]")?.scrollTo({ top: 0 });
  }, [rukuNumber, prefs.wordsExpanded, verseIds]);

  /**
   * `?ayah=255` opens the reader pointed at that ayah.
   *
   * This is how the tafsir nudge hands over: it knows the ayah whose commentary
   * it offered, and the reader should already be looking at it when it opens
   * rather than at the top of the ruku.
   *
   * Runs after the reset above, so a ruku change and an ayah deep link in the
   * same navigation resolve to the deep link.
   */
  const requestedAyah = useMemo(() => {
    const raw = Number(searchParams.get("ayah"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [searchParams]);

  useEffect(() => {
    if (requestedAyah !== null) setSelectedAyah(requestedAyah);
  }, [requestedAyah, rukuNumber]);

  // Only the first landing scrolls; after that the reader's own scrolling owns
  // the viewport, and yanking it back would fight the ayah being read.
  const ayahJumpDone = useRef<number | null>(null);
  useEffect(() => {
    if (requestedAyah === null || !verses?.length || ayahJumpDone.current === requestedAyah) {
      return;
    }
    const verse = verses.find((v) => v.ayah_number === requestedAyah);
    if (!verse) return;
    ayahJumpDone.current = requestedAyah;
    requestAnimationFrame(() =>
      document.getElementById(`verse-${verse.id}`)?.scrollIntoView({ block: "center" }),
    );
  }, [requestedAyah, verses]);

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

  const setMemorized = useCallback(
    (verseId: number) =>
      toggleMemorized.mutate({ verseId, memorized: !(memorized?.has(verseId) ?? false) }),
    [memorized, toggleMemorized],
  );

  /** The surah's ayah numbers whose tafsir is already marked read. */
  const readAyahs = useMemo(() => {
    const ayahs = new Set<number>();
    if (!surahVerseIds || !tafsirRead) return ayahs;
    for (const [ayah, id] of surahVerseIds) {
      if (tafsirRead.has(id)) ayahs.add(ayah);
    }
    return ayahs;
  }, [surahVerseIds, tafsirRead]);

  /** Marks a whole tafsir entry, which is usually a range rather than one ayah. */
  const setTafsirReadRange = useCallback(
    (ayahStart: number, ayahEnd: number, read: boolean) => {
      if (!surahVerseIds) return;
      const ids: number[] = [];
      for (let ayah = ayahStart; ayah <= ayahEnd; ayah++) {
        const id = surahVerseIds.get(ayah);
        if (id !== undefined) ids.push(id);
      }
      toggleTafsirRead.mutate({ verseIds: ids, read });
    },
    [surahVerseIds, toggleTafsirRead],
  );

  /**
   * Points the tafsir at an ayah. Below md the panel is a sheet rather than a
   * column, so asking for a tafsir has to open it as well — selecting alone
   * changes nothing the reader can see.
   */
  const showTafsirFor = useCallback(
    (ayahNumber: number) => {
      setSelectedAyah(ayahNumber);
      if (!isDesktop) setTafsirOpen(true);
    },
    [isDesktop],
  );

  /**
   * Both handovers below pick a position first and set the mode second, and
   * the redirect that follows reacts to that same mode change. This marks the
   * handover so the redirect leaves the chosen position alone.
   */
  const handingOver = useRef(false);

  /**
   * Hands over to the mushaf reader at the page the reader is looking at —
   * the selected ayah's page when there is one, otherwise where the ruku opens.
   */
  const switchToMushaf = useCallback(() => {
    const selected = verses?.find((verse) => verse.ayah_number === selectedAyah);
    const page = selected?.page_number ?? ruku?.page_start ?? verses?.[0]?.page_number;
    if (!page) return;
    handingOver.current = true;
    updateProfile.mutate({ ui_prefs: { readerMode: "mushaf" } });
    navigate(`/read/page/${page}`);
  }, [verses, selectedAyah, ruku, navigate, updateProfile]);

  /**
   * Hands over to the continuous reader at the ayah on screen, and turns the
   * mode on so every ruku opened afterwards lands there too — the toggle is a
   * way of reading, not a one-off jump.
   */
  const switchToSurah = useCallback(() => {
    if (surahNumber === null) return;
    const ayah = selectedAyah ?? ruku?.ayah_start ?? verses?.[0]?.ayah_number;
    handingOver.current = true;
    updateProfile.mutate({ ui_prefs: { readerMode: "surah" } });
    navigate(`/read/surah/${surahNumber}${ayah ? `?ayah=${ayah}` : ""}`);
  }, [surahNumber, selectedAyah, ruku, verses, navigate, updateProfile]);

  // A reader who has chosen the mushaf or the continuous surah gets it wherever
  // a ruku is opened from — the browser, the dashboard, a bookmark. Only this
  // direction redirects: neither of the other two readers sends anyone back
  // here on its own, so none of them can ping-pong.
  useEffect(() => {
    if (handingOver.current) return;
    if (prefs.readerMode === "mushaf") {
      const page = ruku?.page_start ?? verses?.[0]?.page_number;
      if (page) navigate(`/read/page/${page}`, { replace: true });
      return;
    }
    if (prefs.readerMode === "surah" && ruku) {
      // An ayah asked for by whoever linked here (the tafsir nudge, a quiz
      // result) is where the reader wanted to land; the ruku's first ayah is
      // the fallback, not an override.
      const ayah = requestedAyah ?? ruku.ayah_start;
      navigate(`/read/surah/${ruku.surah_number}?ayah=${ayah}`, { replace: true });
    }
  }, [prefs.readerMode, ruku, verses, requestedAyah, navigate]);

  const memorizedCount = useMemo(
    () => verseIds.filter((id) => memorized?.has(id)).length,
    [verseIds, memorized],
  );

  const tafsirReadCount = useMemo(
    () => verseIds.filter((id) => tafsirRead?.has(id)).length,
    [verseIds, tafsirRead],
  );

  const wordsLearnedCount = useMemo(
    () => verseIds.filter((id) => wordsLearned?.has(id)).length,
    [verseIds, wordsLearned],
  );

  // The whole point of the ruku as a unit: it is the amount someone sits down
  // to memorize, so finishing one is the thing worth marking.
  const rukuMemorized = verseIds.length > 0 && memorizedCount === verseIds.length;
  const rukuTafsirRead = verseIds.length > 0 && tafsirReadCount === verseIds.length;
  const rukuWordsLearned = verseIds.length > 0 && wordsLearnedCount === verseIds.length;

  if (!valid) {
    return (
      <div className="p-8">
        <ErrorState
          title={t("reader.rukuMissingTitle")}
          message={t("reader.rukuMissingMessage", { total: TOTAL_RUKUS })}
          onRetry={() => navigate("/browse")}
        />
      </div>
    );
  }

  const tafsirFirst = prefs.tafsirSide === "left";

  // Everything the desktop header shows as its own button, minus the two that
  // stop making sense on a phone: the panel side (the tafsir is a sheet, not a
  // column) and the session clock (informational, and the scarcest thing here
  // is width).
  const mobileActions: MenuAction[] = [
    {
      label: t("reader.quizRukuWords"),
      icon: <GraduationCap className="size-4" aria-hidden />,
      disabled: !verses?.length,
      onSelect: () => navigate(`/quiz?scope=ruku&ruku=${rukuNumber}&start=1`),
    },
    {
      label: t("reader.continuousView"),
      icon: <ScrollText className="size-4" aria-hidden />,
      disabled: surahNumber === null,
      onSelect: switchToSurah,
    },
    {
      label: t("reader.mushafView"),
      icon: <BookMarked className="size-4" aria-hidden />,
      disabled: !verses?.length,
      onSelect: switchToMushaf,
    },
    {
      label: t("reader.focusMode"),
      icon: <Expand className="size-4" aria-hidden />,
      disabled: !verses?.length,
      onSelect: () => {
        const index = (verses ?? []).findIndex((v) => v.ayah_number === selectedAyah);
        openFocus(index >= 0 ? index : 0);
      },
    },
    {
      label: prefs.tajweed ? t("reader.tajweedOff") : t("reader.tajweedOn"),
      icon: <Palette className="size-4" aria-hidden />,
      active: prefs.tajweed,
      onSelect: toggleTajweed,
    },
    {
      label:
        expandedVerses.size === verseIds.length && verseIds.length > 0
          ? t("reader.collapseWords")
          : t("reader.expandWords"),
      icon: <ListTree className="size-4" aria-hidden />,
      onSelect: () =>
        setExpandedVerses((current) =>
          current.size === verseIds.length ? new Set() : new Set(verseIds),
        ),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border bg-surface/60 px-3 py-2.5 backdrop-blur md:px-6 md:py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1 md:gap-3">
            {/* Every way in here is a list — the browser, the dashboard, a
                quiz result — so the way out is the first thing in the header
                rather than something to be found at the bottom of the ruku. */}
            <Tooltip content={t("reader.backToList")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.backToList")}
                onClick={() =>
                  navigate(surahNumber === null ? "/browse" : `/browse?surah=${surahNumber}`)
                }
              >
                <ArrowLeft className="size-4" aria-hidden />
              </Button>
            </Tooltip>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

            <Button
              size="icon"
              variant="ghost"
              disabled={rukuNumber <= 1}
              onClick={() => navigate(`/read/${rukuNumber - 1}`)}
              aria-label={t("reader.previousRuku")}
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
                {t("reader.rukuOf", { number: rukuNumber, total: TOTAL_RUKUS })}
                {ruku ? t("reader.rukuInSurah", { number: ruku.ruku_in_surah }) : ""}
              </div>
            </div>

            <Button
              size="icon"
              variant="ghost"
              disabled={rukuNumber >= TOTAL_RUKUS}
              onClick={() => navigate(`/read/${rukuNumber + 1}`)}
              aria-label={t("reader.nextRuku")}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>

          {/* The full control set needs a window. Below md it collapses to a
              tafsir toggle and an overflow menu. */}
          <div className="hidden items-center gap-3 md:flex">
            {verseIds.length > 0 ? (
              // Read-only, and deliberately so. The ruku is memorized when its
              // ayahs are — every one of them marked, one at a time, as they
              // actually were. A button that could stamp the whole ruku says
              // nothing about which ayahs the reader really knows, which is
              // exactly the thing worth knowing.
              rukuMemorized ? (
                <Tooltip
                  content={
                    rukuTafsirRead && rukuWordsLearned
                      ? t("reader.rukuMemorizedTooltip")
                      : t("reader.rukuMemorizedPartial", {
                          tafsir: tafsirReadCount,
                          words: wordsLearnedCount,
                          total: verseIds.length,
                        })
                  }
                >
                  <div className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-[0.75rem] font-medium text-accent-soft-fg">
                    <Sparkles className="size-3.5" aria-hidden />
                    {t("reader.rukuMemorized")}
                    {!rukuTafsirRead || !rukuWordsLearned ? (
                      <span className="font-normal tabular-nums opacity-70">
                        {t("reader.rukuMarkerCounts", {
                          tafsir: tafsirReadCount,
                          words: wordsLearnedCount,
                        })}
                      </span>
                    ) : null}
                  </div>
                </Tooltip>
              ) : (
                <div className="flex items-center gap-2.5">
                  <Tooltip content={t("reader.markOneByOne")}>
                    <span className="text-[0.75rem] tabular-nums text-fg-subtle">
                      {t("reader.memorizedCount", {
                        memorized: memorizedCount,
                        total: verseIds.length,
                      })}
                    </span>
                  </Tooltip>
                  <ProgressBar value={(memorizedCount / verseIds.length) * 100} className="w-20" />
                </div>
              )
            ) : null}

            <Tooltip
              content={
                idle ? t("reader.timerPaused") : t("reader.timerRunning")
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

            <Tooltip content={t("reader.quizRukuWords")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.quizRukuWords")}
                disabled={!verses?.length}
                onClick={() => navigate(`/quiz?scope=ruku&ruku=${rukuNumber}&start=1`)}
              >
                <GraduationCap className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("reader.continuousViewHint")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.continuousView")}
                aria-pressed={false}
                disabled={surahNumber === null}
                onClick={switchToSurah}
              >
                <ScrollText className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("reader.mushafViewHint")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.switchToMushaf")}
                disabled={!verses?.length}
                onClick={switchToMushaf}
              >
                <BookMarked className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("reader.focusModeHint")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.enterFocus")}
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
                prefs.tajweed ? t("reader.tajweedOff") : t("reader.tajweedOnLong")
              }
            >
              <Button
                size="icon"
                variant={prefs.tajweed ? "outline" : "ghost"}
                aria-label={t("reader.toggleTajweed")}
                aria-pressed={prefs.tajweed}
                onClick={toggleTajweed}
              >
                <Palette className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("reader.expandEveryWord")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.toggleAllWords")}
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

            <Tooltip content={t("reader.swapPanel")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.swapPanelLabel")}
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
              aria-label={t("reader.openTafsir")}
              onClick={() => {
                // The sheet covers the ayahs, so none can be chosen from
                // inside it: opening on an empty panel is a dead end.
                const first = verses?.[0];
                if (selectedAyah === null && first) setSelectedAyah(first.ayah_number);
                setTafsirOpen(true);
              }}
            >
              <BookOpen className="size-4" aria-hidden />
            </Button>
            <MenuButton actions={mobileActions}>
              <Button size="icon" variant="ghost" aria-label={t("reader.moreOptions")}>
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </MenuButton>
          </div>
        </div>
      </header>

      {isError ? (
        <div className="p-8">
          <ErrorState
            title={t("reader.rukuLoadFailed")}
            message={t("reader.loadFailedMessage")}
            onRetry={() => void refetch()}
          />
        </div>
      ) : rukuLoading || versesLoading ? (
        <LoadingBlock label={t("reader.loadingRuku")} />
      ) : (
        <SplitPane
          tafsirFirst={tafsirFirst}
          tafsirOpen={tafsirOpen}
          onTafsirOpenChange={setTafsirOpen}
          reader={
            <div data-verse-scroll className="h-full overflow-y-auto px-4 py-4 md:px-6 md:py-6">
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
                    onToggleMemorized={() => setMemorized(verse.id)}
                    tafsirRead={tafsirRead?.has(verse.id) ?? false}
                    onToggleTafsirRead={() =>
                      toggleTafsirRead.mutate({
                        verseIds: [verse.id],
                        read: !(tafsirRead?.has(verse.id) ?? false),
                      })
                    }
                    wordsLearned={wordsLearned?.has(verse.id) ?? false}
                    onToggleWordsLearned={() =>
                      toggleWordsLearned.mutate({
                        verseIds: [verse.id],
                        learned: !(wordsLearned?.has(verse.id) ?? false),
                      })
                    }
                    selected={selectedAyah === verse.ayah_number}
                    onSelect={() => showTafsirFor(verse.ayah_number)}
                    wordsExpanded={expandedVerses.has(verse.id)}
                    onToggleWords={() => toggleWords(verse.id)}
                    wordStatuses={wordStatuses ?? new Map()}
                    onOpenFocus={() => openFocus(index)}
                    tajweed={prefs.tajweed}
                    reciting={recitingVerseId === verse.id}
                    recitingWordPosition={
                      prefs.highlightWords ? player.currentWordPosition : null
                    }
                    onPlayFromHere={() => player.playVerse(verse.id)}
                    canPlay={player.available}
                  />
                ))}

                <div className="flex items-center justify-between pt-2 pb-8">
                  <Button
                    variant="outline"
                    disabled={rukuNumber <= 1}
                    onClick={() => navigate(`/read/${rukuNumber - 1}`)}
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    {t("reader.previousRuku")}
                  </Button>
                  <Button asChild variant="ghost">
                    <Link to={surahNumber === null ? "/browse" : `/browse?surah=${surahNumber}`}>
                      {t("common.allRukus")}
                    </Link>
                  </Button>
                  <Button
                    variant="primary"
                    disabled={rukuNumber >= TOTAL_RUKUS}
                    onClick={() => navigate(`/read/${rukuNumber + 1}`)}
                  >
                    {t("reader.nextRuku")}
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>
          }
          tafsir={
            <TafsirPanel
              surahNumber={surahNumber}
              ayahNumber={selectedAyah}
              surahName={surah?.name_english ?? ""}
              readAyahs={readAyahs}
              onToggleRead={setTafsirReadRange}
            />
          }
        />
      )}

      {!rukuLoading && !versesLoading && !isError ? (
        <AudioBar
          player={player}
          reciters={reciters}
          reciterId={reciter?.id ?? null}
          onReciterChange={(id) => updateProfile.mutate({ ui_prefs: { reciterId: id } })}
          rate={prefs.playbackRate}
          onRateChange={(rate) => updateProfile.mutate({ ui_prefs: { playbackRate: rate } })}
          repeatMode={prefs.repeatMode}
          onRepeatModeChange={(mode: RepeatMode) =>
            updateProfile.mutate({ ui_prefs: { repeatMode: mode } })
          }
          download={download}
          unmemorizedCount={unmemorizedVerseIds.length}
          compact={!isDesktop}
        />
      ) : null}

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
          onToggleMemorized={(verse) => setMemorized(verse.id)}
          tafsirRead={tafsirRead ?? new Set()}
          onToggleTafsirRead={(verse) =>
            toggleTafsirRead.mutate({
              verseIds: [verse.id],
              read: !(tafsirRead?.has(verse.id) ?? false),
            })
          }
          wordsLearned={wordsLearned ?? new Set()}
          onToggleWordsLearned={(verse) =>
            toggleWordsLearned.mutate({
              verseIds: [verse.id],
              learned: !(wordsLearned?.has(verse.id) ?? false),
            })
          }
          wordStatuses={wordStatuses ?? new Map()}
          sessionSeconds={sessionSeconds}
          loading={versesLoading}
          player={player}
          highlightWords={prefs.highlightWords}
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
