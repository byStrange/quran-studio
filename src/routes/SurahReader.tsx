import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coffee,
  Columns2,
  GraduationCap,
  LayoutList,
  ListTree,
  Loader2,
  Palette,
  Rows3,
  ScrollText,
} from "lucide-react";
import { useRukus, useSurahVerseIds, useSurahs, useSurahVerses } from "@/hooks/useQuranData";
import {
  useAllWordProgress,
  useMemorizedVerses,
  useSetWordsStatus,
  useTafsirReadVerses,
  useToggleMemorized,
  useToggleTafsirRead,
} from "@/hooks/useProgress";
import { learnedVerseIds, quizzableWordIds } from "@/lib/vocabulary";
import {
  useActiveReciter,
  useRecitationFile,
  useRecitationTimings,
  useReciters,
} from "@/hooks/useRecitation";
import { useRecitationPlayer } from "@/hooks/useRecitationPlayer";
import { useSurahDownload } from "@/hooks/useAudioDownloads";
import { useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useReadingTimer } from "@/hooks/useReadingTimer";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import type { RepeatMode } from "@/lib/types";
import { ayahRangeLabel, cn, formatClock } from "@/lib/utils";
import { useT, type TFunction } from "@/providers/I18nProvider";
import { AudioBar } from "@/components/reader/AudioBar";
import { VerseCard } from "@/components/reader/VerseCard";
import { SplitPane } from "@/components/reader/SplitPane";
import { TafsirPanel } from "@/components/reader/TafsirPanel";
import { TajweedLegend } from "@/components/reader/TajweedLegend";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingBlock, Spinner } from "@/components/ui/feedback";
import { MenuButton, Tooltip, type MenuAction } from "@/components/ui/primitives";

const TOTAL_SURAHS = 114;

/**
 * The whole surah, in one scroll.
 *
 * The ruku reader answers "what am I memorizing"; this answers "let me read
 * the surah". So it is deliberately plainer: one column of ayahs with the ruku
 * divisions marked, the recitation playing underneath, and the tafsir one
 * click away on whichever ayah is selected.
 *
 * Ayahs arrive a page at a time and the next page loads as the reader nears
 * the bottom — Al-Baqarah is 286 ayahs of text, translation and word-by-word
 * breakdown, and fetching all of it before drawing anything would be several
 * megabytes of waiting. The scroll position is what drives it, so reading
 * straight down never blocks.
 */
export function SurahReader() {
  const t = useT();
  const params = useParams<{ surahNumber: string }>();
  const navigate = useNavigate();
  const surahNumber = Number(params.surahNumber);
  const valid = Number.isInteger(surahNumber) && surahNumber >= 1 && surahNumber <= TOTAL_SURAHS;

  const prefs = useUiPrefs();
  const updateProfile = useUpdateProfile();
  const isDesktop = useIsDesktop();
  const { data: surahs } = useSurahs();
  const { data: rukus } = useRukus();

  const surah = surahs?.find((s) => s.number === surahNumber);

  const query = useSurahVerses(valid ? surahNumber : null);
  const verses = useMemo(() => (query.data?.pages ?? []).flat(), [query.data]);

  const verseIds = useMemo(() => verses.map((v) => v.id), [verses]);

  const { data: surahVerseIds } = useSurahVerseIds(valid ? surahNumber : null);

  /**
   * The three verse-level markers are scoped to the surah rather than to the
   * ayahs loaded so far: the scope is at most 286 ids, it is known up front,
   * and a key that does not change as pages arrive means one request per
   * surah instead of one per page.
   */
  const surahVerseIdList = useMemo(() => [...(surahVerseIds?.values() ?? [])], [surahVerseIds]);
  const { data: memorized } = useMemorizedVerses(surahVerseIdList);
  const { data: tafsirRead } = useTafsirReadVerses(surahVerseIdList);
  // Word statuses span the surah's whole vocabulary, so they are read from the
  // user's own list rather than named in the query.
  const { data: wordStatuses } = useAllWordProgress();
  const toggleMemorized = useToggleMemorized();
  const toggleTafsirRead = useToggleTafsirRead();
  const setWordsStatus = useSetWordsStatus();

  /**
   * The ayahs whose words are all learned, derived from the word list rather
   * than stored beside it — the same reading the ruku reader does.
   */
  const wordsLearned = useMemo(
    () => learnedVerseIds(verses, wordStatuses ?? new Map()),
    [verses, wordStatuses],
  );

  const [selectedAyah, setSelectedAyah] = useState<number | null>(null);
  const [expandedVerses, setExpandedVerses] = useState<Set<number>>(new Set());
  const [tafsirOpen, setTafsirOpen] = useState(false);
  /** Topmost ayah on screen, used to attribute reading time to a ruku. */
  const [visibleVerseId, setVisibleVerseId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [searchParams] = useSearchParams();
  /**
   * The ayah to open on, from `?ayah=`.
   *
   * This is how the ruku reader hands over when the continuous view is toggled
   * on: switching lands where the reader was rather than at the top of a
   * 286-ayah surah. It is held in state and cleared once reached, because the
   * ayahs arrive a page at a time — an ayah deep in the surah can only be
   * scrolled to after the pages up to it have been pulled in.
   */
  const anchorParam = Number(searchParams.get("ayah"));
  const anchorAyah = Number.isInteger(anchorParam) && anchorParam > 0 ? anchorParam : null;
  const [pendingAnchor, setPendingAnchor] = useState<number | null>(anchorAyah);

  // --- recitation ----------------------------------------------------------

  const { data: reciters } = useReciters();
  const reciter = useActiveReciter(prefs.reciterId);
  const { data: recitation } = useRecitationFile(reciter?.id ?? null, surahNumber);
  /**
   * The recitation covers the surah, not the ayahs that happen to be rendered.
   *
   * The player stops at the last ayah it has a timing for, so handing it the
   * loaded page would end the audio at ayah 40 of Al-Baqarah while the reader
   * is still scrolling — and the ayahs arrive a page at a time precisely so
   * that nobody has to wait for all 286 before pressing play. The surah's ids
   * are one small request that is already made for the progress markers, so
   * playback is scoped to them and the passage is the whole surah from the
   * first press onward.
   */
  const { data: timings } = useRecitationTimings(reciter?.id ?? null, surahVerseIdList);

  const download = useSurahDownload({
    reciterId: reciter?.id ?? null,
    surahNumber,
    url: recitation?.audio_url ?? null,
    fileSize: recitation?.file_size ?? null,
  });

  const unmemorizedVerseIds = useMemo(
    () => surahVerseIdList.filter((id) => !memorized?.has(id)),
    [surahVerseIdList, memorized],
  );

  const player = useRecitationPlayer({
    src: download.localSrc ?? recitation?.audio_url ?? null,
    verseIds: surahVerseIdList,
    timings,
    rate: prefs.playbackRate,
    repeatMode: prefs.repeatMode,
    repeatUnmemorizedVerseIds: unmemorizedVerseIds,
  });

  /**
   * Reading time is attributed to whichever ruku the reader is looking at,
   * which is what the streak and the "rukus read" count are keyed on. The
   * player's ayah wins while it is playing, so listening counts even when the
   * reader has scrolled away.
   */
  const currentVerseId = player.currentVerseId ?? visibleVerseId;
  const currentRuku =
    verses.find((v) => v.id === currentVerseId)?.ruku_number ?? verses[0]?.ruku_number ?? null;
  const { sessionSeconds, idle } = useReadingTimer(valid ? currentRuku : null);

  const loadedVerseIds = useMemo(() => new Set(verseIds), [verseIds]);
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  /**
   * Keeps the ayah being recited on screen — and rendered at all.
   *
   * The recitation runs the whole surah while the reader holds 40 ayahs at a
   * time, so playback reaching past the last loaded ayah has to pull the next
   * page in. Without that, the audio keeps going while the highlight, the word
   * following and the ruku the time is logged against all stop at the last
   * ayah that happens to be on screen.
   */
  useEffect(() => {
    const id = player.currentVerseId;
    if (id === null) return;
    if (!loadedVerseIds.has(id)) {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      return;
    }
    if (!prefs.followRecitation) return;
    document.getElementById(`verse-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [
    player.currentVerseId,
    prefs.followRecitation,
    loadedVerseIds,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  ]);

  // --- which ayah is on screen --------------------------------------------

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || verses.length === 0) return;

    const onScreen = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = Number((entry.target as HTMLElement).dataset.verseId);
          if (!Number.isFinite(id)) continue;
          if (entry.isIntersecting) onScreen.add(id);
          else onScreen.delete(id);
        }
        const first = verses.find((verse) => onScreen.has(verse.id));
        if (first) setVisibleVerseId(first.id);
      },
      // A band near the top of the viewport: what counts as "the ayah being
      // read" is the one at the top, not any of the several on screen.
      { root: container, rootMargin: "-6% 0px -78% 0px" },
    );

    for (const verse of verses) {
      const element = document.getElementById(`verse-${verse.id}`);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [verses]);

  // --- page loading --------------------------------------------------------

  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void fetchNextPage();
      },
      { root: scrollRef.current, rootMargin: "600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, verses.length]);

  // Opening another surah starts at its first ayah, with nothing carried over
  // from the last one — the scroll container outlives the route param.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setSelectedAyah(null);
    setExpandedVerses(new Set());
    setVisibleVerseId(null);
  }, [surahNumber]);

  useEffect(() => setPendingAnchor(anchorAyah), [surahNumber, anchorAyah]);

  // Pages load in order, so reaching an anchor deep in the surah means asking
  // for the next page until the ayah is there to scroll to.
  useEffect(() => {
    if (pendingAnchor === null) return;
    const verse = verses.find((v) => v.ayah_number === pendingAnchor);
    if (!verse) {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      return;
    }
    const element = document.getElementById(`verse-${verse.id}`);
    if (!element) return;
    element.scrollIntoView({ block: "start" });
    setSelectedAyah(verse.ayah_number);
    setPendingAnchor(null);
  }, [pendingAnchor, verses, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // --- per-ayah actions ----------------------------------------------------

  const toggleWords = useCallback((verseId: number) => {
    setExpandedVerses((current) => {
      const next = new Set(current);
      if (next.has(verseId)) next.delete(verseId);
      else next.add(verseId);
      return next;
    });
  }, []);

  const showTafsirFor = useCallback(
    (ayahNumber: number) => {
      setSelectedAyah(ayahNumber);
      if (!isDesktop) setTafsirOpen(true);
    },
    [isDesktop],
  );

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

  /** The surah's ayah numbers whose tafsir is already marked read. */
  const readAyahs = useMemo(() => {
    const ayahs = new Set<number>();
    if (!surahVerseIds || !tafsirRead) return ayahs;
    for (const [ayah, id] of surahVerseIds) {
      if (tafsirRead.has(id)) ayahs.add(ayah);
    }
    return ayahs;
  }, [surahVerseIds, tafsirRead]);

  const memorizedCount = useMemo(
    () => surahVerseIdList.filter((id) => memorized?.has(id)).length,
    [surahVerseIdList, memorized],
  );
  const ayahCount = surah?.ayah_count ?? 0;

  const rukuByNumber = useMemo(
    () => new Map((rukus ?? []).map((ruku) => [ruku.ruku_number, ruku])),
    [rukus],
  );

  const rukuInView = currentRuku !== null ? rukuByNumber.get(currentRuku) : undefined;

  const switchToMushaf = useCallback(() => {
    const selected = verses.find((verse) => verse.ayah_number === selectedAyah);
    const page = selected?.page_number ?? verses[0]?.page_number;
    if (!page) return;
    updateProfile.mutate({ ui_prefs: { readerMode: "mushaf" } });
    navigate(`/read/page/${page}`);
  }, [verses, selectedAyah, navigate, updateProfile]);

  /**
   * Turns the continuous view off and hands back to the ruku reader — the
   * mushaf toggle's handover, in reverse. The mode is a stored preference, so
   * leaving here deliberately is also what turns it off; otherwise the ruku
   * reader would redirect straight back and the toggle could never be undone.
   */
  const openRuku = useCallback(
    (targetRuku: number | null) => {
      updateProfile.mutate({ ui_prefs: { readerMode: "study" } });
      navigate(targetRuku ? `/read/${targetRuku}` : "/browse");
    },
    [navigate, updateProfile],
  );

  const mobileActions: MenuAction[] = [
    {
      label: t("reader.continuousView"),
      icon: <ScrollText className="size-4" aria-hidden />,
      active: true,
      onSelect: () => openRuku(currentRuku),
    },
    {
      label: t("reader.quizSurahWords"),
      icon: <GraduationCap className="size-4" aria-hidden />,
      onSelect: () => navigate(`/quiz?scope=surah&surah=${surahNumber}&start=1`),
    },
    {
      label: t("reader.mushafView"),
      icon: <BookMarked className="size-4" aria-hidden />,
      onSelect: switchToMushaf,
    },
    {
      label: prefs.tajweed ? t("reader.tajweedOff") : t("reader.tajweedOn"),
      icon: <Palette className="size-4" aria-hidden />,
      active: prefs.tajweed,
      onSelect: () => updateProfile.mutate({ ui_prefs: { tajweed: !prefs.tajweed } }),
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

  if (!valid) {
    return (
      <div className="p-8">
        <ErrorState
          title={t("surah.missingTitle")}
          message={t("surah.missingMessage", { total: TOTAL_SURAHS })}
          onRetry={() => navigate("/browse")}
        />
      </div>
    );
  }

  const tafsirFirst = prefs.tafsirSide === "left";

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border bg-surface/60 px-3 py-2.5 backdrop-blur md:px-6 md:py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-1 md:gap-3">
            {/* The way back to the list belongs in the header: reading a surah
                top to bottom means the bottom of the page is a long way away. */}
            <Tooltip content={t("reader.backToList")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.backToList")}
                onClick={() => navigate(`/browse?surah=${surahNumber}`)}
              >
                <ArrowLeft className="size-4" aria-hidden />
              </Button>
            </Tooltip>
            <span className="h-5 w-px shrink-0 bg-border" aria-hidden />

            <Button
              size="icon"
              variant="ghost"
              disabled={surahNumber <= 1}
              onClick={() => navigate(`/read/surah/${surahNumber - 1}`)}
              aria-label={t("reader.previousSurah")}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>

            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-fg">
                  {surah?.name_english ?? "…"}
                </h1>
                <span className="shrink-0 text-[0.8125rem] text-fg-subtle">
                  {t("surah.header", { number: surahNumber, count: ayahCount })}
                </span>
              </div>
              <div className="text-[0.6875rem] text-fg-subtle">
                {t("surah.memorizedOf", { memorized: memorizedCount, total: ayahCount })}
                {rukuInView ? t("surah.rukuInView", { number: rukuInView.ruku_in_surah }) : ""}
                {verses.length < ayahCount ? t("surah.loadedCount", { count: verses.length }) : ""}
              </div>
            </div>

            <Button
              size="icon"
              variant="ghost"
              disabled={surahNumber >= TOTAL_SURAHS}
              onClick={() => navigate(`/read/surah/${surahNumber + 1}`)}
              aria-label={t("reader.nextSurah")}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>

          <div className="hidden items-center gap-0.5 md:flex">
            <Tooltip content={t("reader.continuousViewOn")}>
              <Button
                size="icon"
                variant="outline"
                aria-label={t("reader.continuousView")}
                aria-pressed
                onClick={() => openRuku(currentRuku)}
              >
                <ScrollText className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("reader.quizSurahMemorized")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.quizSurahWords")}
                onClick={() => navigate(`/quiz?scope=surah&surah=${surahNumber}&start=1`)}
              >
                <GraduationCap className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("reader.mushafViewHint")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.switchToMushaf")}
                disabled={!verses.length}
                onClick={switchToMushaf}
              >
                <BookMarked className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={prefs.tajweed ? t("reader.tajweedOff") : t("reader.tajweedOn")}>
              <Button
                size="icon"
                variant={prefs.tajweed ? "outline" : "ghost"}
                aria-label={t("reader.toggleTajweed")}
                aria-pressed={prefs.tajweed}
                onClick={() => updateProfile.mutate({ ui_prefs: { tajweed: !prefs.tajweed } })}
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

            <Tooltip content={t("reader.swapPanel")}>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t("reader.swapPanelLabel")}
                onClick={() =>
                  updateProfile.mutate({ ui_prefs: { tafsirSide: tafsirFirst ? "right" : "left" } })
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
                if (selectedAyah === null && verses[0]) setSelectedAyah(verses[0].ayah_number);
                setTafsirOpen(true);
              }}
            >
              <BookOpen className="size-4" aria-hidden />
            </Button>
            <MenuButton actions={mobileActions}>
              <Button size="icon" variant="ghost" aria-label={t("reader.moreOptions")}>
                <Rows3 className="size-4" aria-hidden />
              </Button>
            </MenuButton>
          </div>
        </div>
      </header>

      {query.isError ? (
        <div className="p-8">
          <ErrorState
            title={t("surah.loadFailed")}
            message={t("reader.loadFailedMessage")}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : query.isPending ? (
        <LoadingBlock label={t("surah.loading")} />
      ) : (
        <SplitPane
          tafsirFirst={tafsirFirst}
          tafsirOpen={tafsirOpen}
          onTafsirOpenChange={setTafsirOpen}
          reader={
            <div
              ref={scrollRef}
              data-verse-scroll
              className="h-full overflow-y-auto px-4 py-4 md:px-6 md:py-6"
            >
              <div className="mx-auto max-w-3xl space-y-4">
                {prefs.tajweed ? <TajweedLegend /> : null}

                {verses.map((verse, index) => {
                  const previous = index > 0 ? verses[index - 1] : undefined;
                  const startsRuku = !previous || previous.ruku_number !== verse.ruku_number;
                  const ruku = startsRuku ? rukuByNumber.get(verse.ruku_number) : undefined;

                  return (
                    <div key={verse.id} className="space-y-4">
                      {startsRuku ? (
                        <RukuDivider
                          rukuNumber={verse.ruku_number}
                          rukuInSurah={ruku?.ruku_in_surah ?? null}
                          ayahStart={ruku?.ayah_start ?? verse.ayah_number}
                          ayahEnd={ruku?.ayah_end ?? verse.ayah_number}
                          onQuiz={() =>
                            navigate(`/quiz?scope=ruku&ruku=${verse.ruku_number}&start=1`)
                          }
                          onOpenRuku={() => openRuku(verse.ruku_number)}
                          t={t}
                        />
                      ) : null}

                      <VerseCard
                        verse={verse}
                        memorized={memorized?.has(verse.id) ?? false}
                        onToggleMemorized={() =>
                          toggleMemorized.mutate({
                            verseId: verse.id,
                            memorized: !(memorized?.has(verse.id) ?? false),
                          })
                        }
                        tafsirRead={tafsirRead?.has(verse.id) ?? false}
                        onToggleTafsirRead={() =>
                          toggleTafsirRead.mutate({
                            verseIds: [verse.id],
                            read: !(tafsirRead?.has(verse.id) ?? false),
                          })
                        }
                        wordsLearned={wordsLearned.has(verse.id)}
                        onToggleWordsLearned={() =>
                          setWordsStatus.mutate({
                            wordIds: quizzableWordIds(verse.words),
                            status: wordsLearned.has(verse.id) ? "learning" : "learned",
                          })
                        }
                        selected={selectedAyah === verse.ayah_number}
                        onSelect={() => showTafsirFor(verse.ayah_number)}
                        wordsExpanded={expandedVerses.has(verse.id)}
                        onToggleWords={() => toggleWords(verse.id)}
                        wordStatuses={wordStatuses ?? new Map()}
                        tajweed={prefs.tajweed}
                        reciting={player.currentVerseId === verse.id}
                        recitingWordPosition={
                          prefs.highlightWords ? player.currentWordPosition : null
                        }
                        onPlayFromHere={() => player.playVerse(verse.id)}
                        canPlay={player.available}
                      />
                    </div>
                  );
                })}

                <div ref={loadMoreRef} className="flex flex-col items-center gap-3 py-6">
                  {hasNextPage ? (
                    <Button
                      variant="outline"
                      disabled={isFetchingNextPage}
                      onClick={() => void fetchNextPage()}
                    >
                      {isFetchingNextPage ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Rows3 className="size-4" aria-hidden />
                      )}
                      {isFetchingNextPage ? t("surah.loadingAyahs") : t("surah.loadMore")}
                    </Button>
                  ) : (
                    <div className="flex items-center gap-3 text-[0.8125rem] text-fg-subtle">
                      <span>
                        {t("surah.endOf", {
                          surah: surah?.name_english ?? t("surah.endOfFallback"),
                        })}
                      </span>
                      {isFetchingNextPage ? <Spinner /> : null}
                    </div>
                  )}

                  <div className="flex w-full items-center justify-between pt-2 pb-8">
                    <Button
                      variant="outline"
                      disabled={surahNumber <= 1}
                      onClick={() => navigate(`/read/surah/${surahNumber - 1}`)}
                    >
                      <ChevronLeft className="size-4" aria-hidden />
                      {t("reader.previousSurah")}
                    </Button>
                    <Button asChild variant="ghost">
                      <Link to={`/browse?surah=${surahNumber}`}>{t("common.allRukus")}</Link>
                    </Button>
                    <Button
                      variant="primary"
                      disabled={surahNumber >= TOTAL_SURAHS}
                      onClick={() => navigate(`/read/surah/${surahNumber + 1}`)}
                    >
                      {t("reader.nextSurah")}
                      <ChevronRight className="size-4" aria-hidden />
                    </Button>
                  </div>
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

      {!query.isPending && !query.isError ? (
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
    </div>
  );
}

/**
 * Where one ruku ends and the next begins, in a view that otherwise runs the
 * ayahs together. The quiz action is here because this is exactly where the
 * reader finishes a ruku and the words are worth drilling.
 */
function RukuDivider({
  rukuNumber,
  rukuInSurah,
  ayahStart,
  ayahEnd,
  onQuiz,
  onOpenRuku,
  t,
}: {
  rukuNumber: number;
  rukuInSurah: number | null;
  ayahStart: number;
  ayahEnd: number;
  onQuiz: () => void;
  onOpenRuku: () => void;
  t: TFunction;
}) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <button
        onClick={onOpenRuku}
        title={t("surah.studyThisRuku")}
        className={cn(
          "shrink-0 rounded-lg px-2 py-1 text-[0.6875rem] font-medium uppercase tracking-wider",
          "text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg",
        )}
      >
        {t("browse.rukuLabel", { number: rukuInSurah ?? rukuNumber })} ·{" "}
        {ayahRangeLabel(ayahStart, ayahEnd)}
      </button>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <button
        onClick={onQuiz}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[0.6875rem]",
          "text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg",
        )}
      >
        <GraduationCap className="size-3" aria-hidden />
        {t("surah.quizWords")}
      </button>
    </div>
  );
}
