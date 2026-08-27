/**
 * Distraction-free reading: one ayah at a time, filling the whole window.
 *
 * This is an overlay rather than a route. The reader underneath stays mounted,
 * so its queries, its scroll position and — importantly — its reading timer all
 * survive the transition, and leaving focus mode puts the user back exactly
 * where they were. Entering also asks the OS window for fullscreen; leaving
 * gives it back.
 *
 * Chrome (header, footer, arrows) fades out after a few quiet seconds so that
 * nothing but the ayah is on screen while reading, and returns on any input.
 *
 * The two layouts differ by more than spacing, so this branches on the
 * breakpoint rather than hiding desktop chrome with CSS. A desktop window can
 * afford the full control row, the keyboard hints and the arrow gutters; a
 * phone can't — there the ayah gets the whole width, turning it is a swipe or
 * a chevron in a five-slot bottom bar, and every other control moves into an
 * options sheet behind one button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  GraduationCap,
  Languages,
  Minus,
  Palette,
  Pause,
  Play,
  Plus,
  ScanText,
  SlidersHorizontal,
  Type,
  Volume2,
  WholeWord,
  X,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { cn, formatClock } from "@/lib/utils";
import type { VerseWithWords, WordStatus } from "@/lib/types";
import type { RecitationPlayer } from "@/hooks/useRecitationPlayer";
import { IS_TAURI, setFullscreen } from "@/lib/window";
import { Spinner } from "@/components/ui/feedback";
import { Toggle } from "@/components/ui/primitives";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { WordChip } from "./WordChip";
import { TajweedText } from "./TajweedText";
import { verseTranslation } from "@/lib/language";
import { useContentLanguage } from "@/hooks/useProfile";

/** Tuned pairs rather than one scale factor — translation shouldn't grow as
    fast as the Arabic, or it starts competing with it. */
const TEXT_SIZES = [
  { arabic: "2.25rem", translation: "1rem" },
  { arabic: "2.875rem", translation: "1.0625rem" },
  { arabic: "3.5rem", translation: "1.125rem" },
  { arabic: "4.25rem", translation: "1.25rem" },
  { arabic: "5.25rem", translation: "1.375rem" },
];

const SIZE_KEY = "qs.focusTextSize";
const TRANSLATION_KEY = "qs.focusTranslation";
/** How long the screen stays quiet before the controls fade away. */
const CHROME_IDLE_MS = 2600;
const WAKE_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
/** How far a finger has to travel sideways before it counts as an ayah turn. */
const SWIPE_MIN_PX = 56;

/** Hides the controls while the user is reading rather than interacting. */
function useIdleChrome(): boolean {
  const [hidden, setHidden] = useState(false);
  const timer = useRef(0);

  useEffect(() => {
    const wake = () => {
      setHidden(false);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setHidden(true), CHROME_IDLE_MS);
    };

    wake();
    for (const event of WAKE_EVENTS) {
      window.addEventListener(event, wake, { passive: true });
    }
    return () => {
      window.clearTimeout(timer.current);
      for (const event of WAKE_EVENTS) window.removeEventListener(event, wake);
    };
  }, []);

  return hidden;
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[0.6875rem] text-fg-subtle"
        >
          {key}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

function ControlButton({
  onClick,
  active,
  label,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[0.8125rem] transition-colors",
        active
          ? "border-accent/40 bg-accent-soft text-accent-soft-fg"
          : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function NavButton({
  side,
  onClick,
  disabled,
  hint,
}: {
  side: "prev" | "next";
  onClick: () => void;
  disabled: boolean;
  hint?: string;
}) {
  const Icon = side === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "prev" ? "Previous ayah" : "Next ayah"}
      className={cn(
        "group absolute inset-y-0 z-10 flex w-24 flex-col items-center justify-center gap-1.5",
        "text-fg-subtle transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-25",
        side === "prev" ? "left-0" : "right-0",
      )}
    >
      <span className="grid size-11 place-items-center rounded-full border border-transparent transition-colors group-hover:border-border group-hover:bg-surface">
        <Icon className="size-6" aria-hidden />
      </span>
      {hint ? (
        <span className="px-1 text-center text-[0.6875rem] leading-tight">{hint}</span>
      ) : null}
    </button>
  );
}

/** Shared by the desktop control row and the phone's options sheet. */
function SizeStepper({
  index,
  onResize,
  large,
}: {
  index: number;
  onResize: (delta: number) => void;
  large?: boolean;
}) {
  const button = large ? "size-10" : "size-7";
  const icon = large ? "size-4" : "size-3.5";
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border px-1">
      <button
        type="button"
        onClick={() => onResize(-1)}
        disabled={index === 0}
        aria-label="Smaller text"
        className={cn(
          button,
          "grid place-items-center rounded-md text-fg-muted transition-colors",
          "hover:bg-surface-2 hover:text-fg disabled:opacity-30",
        )}
      >
        <Minus className={icon} aria-hidden />
      </button>
      <span className="px-0.5 text-[0.6875rem] tabular-nums text-fg-subtle">{index + 1}</span>
      <button
        type="button"
        onClick={() => onResize(1)}
        disabled={index === TEXT_SIZES.length - 1}
        aria-label="Larger text"
        className={cn(
          button,
          "grid place-items-center rounded-md text-fg-muted transition-colors",
          "hover:bg-surface-2 hover:text-fg disabled:opacity-30",
        )}
      >
        <Plus className={icon} aria-hidden />
      </button>
    </div>
  );
}

/**
 * One slot of the phone's bottom bar: a 48px target with no label, because
 * five labelled buttons is exactly the row that made this mode feel cluttered.
 */
function BarButton({
  onClick,
  disabled,
  active,
  label,
  caption,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
  /** Only used at a ruku boundary, where "next" needs to say where it goes. */
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "flex h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl px-3",
        "transition-colors disabled:pointer-events-none disabled:opacity-25",
        active ? "bg-accent-soft text-accent-soft-fg" : "text-fg-muted active:bg-surface-2",
      )}
    >
      {children}
      {caption ? <span className="text-[0.625rem] leading-none">{caption}</span> : null}
    </button>
  );
}

function SheetRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Languages;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="flex items-center gap-3 text-[0.9375rem] text-fg">
        <Icon className="size-4 text-fg-subtle" aria-hidden />
        {label}
      </span>
      {children}
    </div>
  );
}

export function FocusMode({
  verses,
  index,
  onIndexChange,
  onExit,
  surahName,
  rukuNumber,
  rukuInSurah,
  memorized,
  onToggleMemorized,
  tafsirRead,
  onToggleTafsirRead,
  wordsLearned,
  onToggleWordsLearned,
  wordStatuses,
  sessionSeconds,
  loading,
  player,
  highlightWords,
  onPrevRuku,
  onNextRuku,
  tajweed,
  onToggleTajweed,
}: {
  verses: VerseWithWords[];
  index: number;
  onIndexChange: (index: number) => void;
  onExit: () => void;
  surahName: string;
  rukuNumber: number;
  rukuInSurah: number | null;
  memorized: Set<number>;
  onToggleMemorized: (verse: VerseWithWords) => void;
  tafsirRead: Set<number>;
  onToggleTafsirRead: (verse: VerseWithWords) => void;
  wordsLearned: Set<number>;
  onToggleWordsLearned: (verse: VerseWithWords) => void;
  wordStatuses: Map<number, WordStatus>;
  sessionSeconds: number;
  loading: boolean;
  /** The reader's player, shared so playback survives entering and leaving. */
  player: RecitationPlayer;
  highlightWords: boolean;
  /** Absent at the first ruku / the last one. */
  onPrevRuku?: () => void;
  onNextRuku?: () => void;
  /** Colour the Arabic by tajweed rule. Unlike text size and the translation
      toggle this is a study preference, so it lives in the profile and is
      shared with the reader underneath rather than kept per-window. */
  tajweed: boolean;
  onToggleTajweed: () => void;
}) {
  const chromeHidden = useIdleChrome();
  const isDesktop = useIsDesktop();
  const language = useContentLanguage();
  /** Phone only: everything that isn't play / mark / turn lives behind this. */
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [sizeIndex, setSizeIndex] = useState(() => {
    const stored = Number(localStorage.getItem(SIZE_KEY));
    return Number.isInteger(stored) && stored >= 0 && stored < TEXT_SIZES.length ? stored : 2;
  });
  const [showTranslation, setShowTranslation] = useState(
    () => localStorage.getItem(TRANSLATION_KEY) !== "off",
  );
  const [showWords, setShowWords] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const verse = verses[Math.min(index, verses.length - 1)];
  const size = TEXT_SIZES[sizeIndex]!;
  const atFirst = index <= 0;
  const atLast = index >= verses.length - 1;

  const reciting = Boolean(verse) && player.currentVerseId === verse!.id;

  /**
   * Pause if this ayah is the one playing, otherwise start it from the top.
   *
   * One button rather than a transport: in focus mode the ayah on screen is
   * the whole subject, so "play" can only sensibly mean this one.
   */
  const togglePlayback = useCallback(() => {
    if (!verse || !player.available) return;
    if (reciting && player.playing) player.pause();
    else player.playVerse(verse.id);
  }, [verse, reciting, player]);

  // A window that grows into the desktop layout leaves the sheet with no
  // button to reopen it, and its open state would swallow the shortcut keys.
  useEffect(() => {
    if (isDesktop) setOptionsOpen(false);
  }, [isDesktop]);

  // Fullscreen belongs to the mode, not to a click: whichever way focus mode
  // ends — button, Escape, or the reader unmounting — the window is restored.
  useEffect(() => {
    void setFullscreen(true);
    return () => void setFullscreen(false);
  }, []);

  // In the browser preview Escape leaves fullscreen without reaching our
  // handler, which would strand the overlay inside a normal window.
  useEffect(() => {
    if (IS_TAURI) return;
    const onChange = () => {
      if (!document.fullscreenElement) onExit();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [onExit]);

  const goPrev = useCallback(() => {
    if (!atFirst) onIndexChange(index - 1);
    else onPrevRuku?.();
  }, [atFirst, index, onIndexChange, onPrevRuku]);

  const goNext = useCallback(() => {
    if (!atLast) onIndexChange(index + 1);
    else onNextRuku?.();
  }, [atLast, index, onIndexChange, onNextRuku]);

  /** With the side arrows gone from the phone layout, the swipe is the turn. */
  const onTouchStart = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }, []);

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = touchStart.current;
      const touch = event.changedTouches[0];
      touchStart.current = null;
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      // Clearly sideways, or it was a scroll of the translation.
      if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) goNext();
      else goPrev();
    },
    [goNext, goPrev],
  );

  const resize = useCallback((delta: number) => {
    setSizeIndex((current) => {
      const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, current + delta));
      localStorage.setItem(SIZE_KEY, String(next));
      return next;
    });
  }, []);

  const toggleTranslation = useCallback(() => {
    setShowTranslation((current) => {
      localStorage.setItem(TRANSLATION_KEY, current ? "off" : "on");
      return !current;
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // The options sheet is a dialog of its own; Escape there should close it
      // rather than drop the user out of focus mode entirely.
      if (optionsOpen) return;

      // A word popover is open and focused: leave it its own keys.
      const active = document.activeElement;
      const inControl =
        active instanceof HTMLElement && active.closest("button, input, textarea, [role=dialog]");
      if (inControl && (event.key === " " || event.key === "Enter")) return;

      switch (event.key) {
        case "Escape":
          onExit();
          break;
        case "ArrowRight":
        case "PageDown":
        case " ":
          event.preventDefault();
          goNext();
          break;
        case "ArrowLeft":
        case "PageUp":
          event.preventDefault();
          goPrev();
          break;
        case "m":
          if (verse) onToggleMemorized(verse);
          break;
        case "r":
          if (verse) onToggleTafsirRead(verse);
          break;
        case "p":
          event.preventDefault();
          togglePlayback();
          break;
        case "w":
          setShowWords((current) => !current);
          break;
        case "t":
          toggleTranslation();
          break;
        case "c":
          onToggleTajweed();
          break;
        case "+":
        case "=":
          resize(1);
          break;
        case "-":
          resize(-1);
          break;
        default:
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    goNext,
    goPrev,
    onExit,
    optionsOpen,
    onToggleMemorized,
    onToggleTafsirRead,
    onToggleTajweed,
    resize,
    togglePlayback,
    toggleTranslation,
    verse,
  ]);

  const isMemorized = verse ? memorized.has(verse.id) : false;
  const isTafsirRead = verse ? tafsirRead.has(verse.id) : false;
  const isWordsLearned = verse ? wordsLearned.has(verse.id) : false;
  const progress = verses.length > 0 ? ((index + 1) / verses.length) * 100 : 0;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[70] flex flex-col bg-bg animate-fade-in",
        chromeHidden && "cursor-none",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Focus reader"
    >
      {/* Position within the ruku, as a hairline that never needs the eye. */}
      <div className="absolute inset-x-0 top-0 z-20 h-[2px] bg-border/70">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <header
        className={cn(
          "relative z-20 flex shrink-0 items-center gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1.5",
          "transition-opacity duration-500 md:gap-4 md:px-6 md:py-4",
          chromeHidden && "pointer-events-none opacity-0",
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{surahName}</div>
          <div className="text-[0.75rem] text-fg-subtle">
            Ruku {rukuNumber}
            {/* The second half is context, not navigation — the phone keeps
                the line to one short label. */}
            {rukuInSurah ? (
              <span className="hidden md:inline">{` · ruku ${rukuInSurah} in this surah`}</span>
            ) : null}
          </div>
        </div>

        <div className="flex-1" />

        <div className="hidden items-center gap-1.5 text-[0.75rem] tabular-nums text-fg-subtle md:flex">
          <Clock className="size-3.5" aria-hidden />
          {formatClock(sessionSeconds)}
        </div>

        <button
          type="button"
          onClick={onExit}
          aria-label="Exit focus mode"
          className={cn(
            "inline-flex items-center gap-2 rounded-lg text-fg-muted transition-colors",
            "size-11 justify-center active:bg-surface-2",
            "md:size-auto md:h-9 md:border md:border-border md:px-3 md:text-[0.8125rem]",
            "md:hover:border-border-strong md:hover:text-fg",
          )}
        >
          <X className="size-5 md:size-4" aria-hidden />
          <span className="hidden md:inline">Exit</span>
          {/* A key hint is noise on a device with no keyboard. */}
          <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[0.6875rem] md:inline">
            Esc
          </kbd>
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {/* Arrow gutters would cost a phone ~80px of line width; there the
            same moves are a swipe or the bottom bar. */}
        {isDesktop ? (
          <>
            <NavButton
              side="prev"
              onClick={goPrev}
              disabled={atFirst && !onPrevRuku}
              hint={!chromeHidden && atFirst && onPrevRuku ? `Ruku ${rukuNumber - 1}` : undefined}
            />
            <NavButton
              side="next"
              onClick={goNext}
              disabled={atLast && !onNextRuku}
              hint={!chromeHidden && atLast && onNextRuku ? `Ruku ${rukuNumber + 1}` : undefined}
            />
          </>
        ) : null}

        <div
          className="h-full overflow-y-auto px-5 md:px-24"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {loading || !verse ? (
            <div className="grid h-full place-items-center">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center py-6 md:py-8">
              {/* Keyed so moving between ayahs is a soft cross-fade. */}
              <div
                key={verse.id}
                className="mx-auto flex w-full max-w-5xl flex-col items-center text-center animate-fade-in"
              >
                <div className="mb-7 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-fg-subtle md:mb-9">
                  <span>Ayah {verse.ayah_number}</span>
                  <span className="h-3 w-px bg-border" aria-hidden />
                  <span className="tabular-nums">
                    {index + 1} of {verses.length}
                  </span>
                  {isMemorized && isDesktop ? (
                    <>
                      <span className="h-3 w-px bg-border" aria-hidden />
                      <span className="text-accent">Memorized</span>
                    </>
                  ) : null}
                  {isTafsirRead && isDesktop ? (
                    <>
                      <span className="h-3 w-px bg-border" aria-hidden />
                      <span className="text-gold">Tafsir read</span>
                    </>
                  ) : null}
                  {reciting ? (
                    <>
                      <span className="h-3 w-px bg-border" aria-hidden />
                      <span className="flex items-center gap-1 text-accent">
                        <Volume2 className="size-3" aria-hidden />
                        Reciting
                      </span>
                    </>
                  ) : null}
                </div>

                <p
                  className="font-arabic text-fg"
                  dir="rtl"
                  data-selectable
                  style={{ fontSize: size.arabic, lineHeight: 1.95 }}
                >
                  <TajweedText
                    text={verse.arabic_text}
                    spans={verse.tajweed}
                    enabled={tajweed}
                  />
                </p>

                {showTranslation ? (
                  <>
                    <span className="my-7 h-px w-16 bg-border md:my-9" aria-hidden />
                    <p
                      className="max-w-3xl leading-relaxed text-fg-muted"
                      data-selectable
                      style={{ fontSize: size.translation }}
                    >
                      {verseTranslation(verse, language)}
                    </p>
                  </>
                ) : null}

                {showWords ? (
                  <div className="mt-8 w-full border-t border-border pt-6 md:mt-10 md:pt-8">
                    <div className="flex flex-wrap justify-center gap-2" dir="rtl">
                      {verse.words.map((word) => (
                        <WordChip
                          key={word.id}
                          word={word}
                          verse={verse}
                          status={wordStatuses.get(word.id)}
                          reciting={
                            reciting && highlightWords && player.currentWordPosition === word.position
                          }
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>

      {isDesktop ? (
        <footer
          className={cn(
            "relative z-20 shrink-0 px-6 pb-5 pt-3 transition-opacity duration-500",
            chromeHidden && "pointer-events-none opacity-0",
          )}
        >
          <div className="flex flex-wrap items-center justify-center gap-2">
            {player.available ? (
              <ControlButton
                onClick={togglePlayback}
                active={reciting && player.playing}
                label={reciting && player.playing ? "Pause recitation" : "Play this ayah"}
              >
                {reciting && player.playing ? (
                  <Pause className="size-4" aria-hidden />
                ) : (
                  <Play className="size-4" aria-hidden />
                )}
                {reciting && player.playing ? "Pause" : "Play"}
              </ControlButton>
            ) : null}

            <ControlButton
              onClick={() => verse && onToggleMemorized(verse)}
              active={isMemorized}
              label={isMemorized ? "Unmark as memorized" : "Mark as memorized"}
            >
              <Check className="size-4" aria-hidden />
              {isMemorized ? "Memorized" : "Mark memorized"}
            </ControlButton>

            <ControlButton
              onClick={() => verse && onToggleTafsirRead(verse)}
              active={isTafsirRead}
              label={isTafsirRead ? "Unmark tafsir as read" : "Mark tafsir as read"}
            >
              <GraduationCap className="size-4" aria-hidden />
              {isTafsirRead ? "Tafsir read" : "Mark tafsir"}
            </ControlButton>

            <ControlButton
              onClick={() => verse && onToggleWordsLearned(verse)}
              active={isWordsLearned}
              label={isWordsLearned ? "Unmark words as learned" : "Mark words as learned"}
            >
              <WholeWord className="size-4" aria-hidden />
              {isWordsLearned ? "Words learned" : "Mark words"}
            </ControlButton>

            <ControlButton onClick={() => setShowWords((current) => !current)} active={showWords}>
              <ScanText className="size-4" aria-hidden />
              Words
            </ControlButton>

            <ControlButton onClick={toggleTranslation} active={showTranslation}>
              <Languages className="size-4" aria-hidden />
              Translation
            </ControlButton>

            <ControlButton onClick={onToggleTajweed} active={tajweed}>
              <Palette className="size-4" aria-hidden />
              Tajweed
            </ControlButton>

            <div className="ml-1">
              <SizeStepper index={sizeIndex} onResize={resize} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.75rem] text-fg-subtle">
            <Hint keys={["←", "→"]} label="ayah" />
            {player.available ? <Hint keys={["P"]} label="play" /> : null}
            <Hint keys={["M"]} label="memorized" />
            <Hint keys={["R"]} label="tafsir read" />
            <Hint keys={["W"]} label="words" />
            <Hint keys={["T"]} label="translation" />
            <Hint keys={["C"]} label="tajweed" />
            <Hint keys={["+", "−"]} label="text size" />
          </div>
        </footer>
      ) : (
        /* The phone keeps only the moves made while reading — turn, play,
           mark — and files the rest of the settings behind one button. */
        <footer
          className={cn(
            "relative z-20 shrink-0 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
            "transition-opacity duration-500",
            chromeHidden && "pointer-events-none opacity-0",
          )}
        >
          <div className="flex items-center justify-between">
            <BarButton
              onClick={goPrev}
              disabled={atFirst && !onPrevRuku}
              label="Previous ayah"
              caption={atFirst && onPrevRuku ? `Ruku ${rukuNumber - 1}` : undefined}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </BarButton>

            <div className="flex items-center gap-1">
              {player.available ? (
                <BarButton
                  onClick={togglePlayback}
                  active={reciting && player.playing}
                  label={reciting && player.playing ? "Pause recitation" : "Play this ayah"}
                >
                  {reciting && player.playing ? (
                    <Pause className="size-5" aria-hidden />
                  ) : (
                    <Play className="size-5" aria-hidden />
                  )}
                </BarButton>
              ) : null}

              <BarButton
                onClick={() => verse && onToggleMemorized(verse)}
                active={isMemorized}
                label={isMemorized ? "Unmark as memorized" : "Mark as memorized"}
              >
                <Check className="size-5" aria-hidden />
              </BarButton>

              <BarButton
                onClick={() => setOptionsOpen(true)}
                active={optionsOpen}
                label="Reading options"
              >
                <SlidersHorizontal className="size-5" aria-hidden />
              </BarButton>
            </div>

            <BarButton
              onClick={goNext}
              disabled={atLast && !onNextRuku}
              label="Next ayah"
              caption={atLast && onNextRuku ? `Ruku ${rukuNumber + 1}` : undefined}
            >
              <ChevronRight className="size-6" aria-hidden />
            </BarButton>
          </div>
        </footer>
      )}

      {/* Portalled above the overlay's own z-index, so the sheet sits on top. */}
      <Dialog.Root open={optionsOpen} onOpenChange={setOptionsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/50 animate-fade-in" />
          <Dialog.Content
            className={cn(
              "fixed inset-x-0 bottom-0 z-[80] rounded-t-2xl border-t border-border bg-surface",
              "px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40",
              "animate-rise",
            )}
          >
            <div className="mx-auto mb-1 h-1 w-9 rounded-full bg-border-strong" aria-hidden />
            <Dialog.Title className="sr-only">Reading options</Dialog.Title>

            <div className="divide-y divide-border">
              <SheetRow icon={Type} label="Text size">
                <SizeStepper index={sizeIndex} onResize={resize} large />
              </SheetRow>

              <SheetRow icon={Languages} label="Translation">
                <Toggle
                  checked={showTranslation}
                  onCheckedChange={toggleTranslation}
                  label="Show translation"
                />
              </SheetRow>

              <SheetRow icon={ScanText} label="Word by word">
                <Toggle
                  checked={showWords}
                  onCheckedChange={() => setShowWords((current) => !current)}
                  label="Show word by word"
                />
              </SheetRow>

              <SheetRow icon={Palette} label="Tajweed colours">
                <Toggle checked={tajweed} onCheckedChange={onToggleTajweed} label="Tajweed colours" />
              </SheetRow>

              <SheetRow icon={GraduationCap} label="Tafsir read">
                <Toggle
                  checked={isTafsirRead}
                  onCheckedChange={() => verse && onToggleTafsirRead(verse)}
                  label="Mark tafsir as read"
                />
              </SheetRow>

              <SheetRow icon={WholeWord} label="Words learned">
                <Toggle
                  checked={isWordsLearned}
                  onCheckedChange={() => verse && onToggleWordsLearned(verse)}
                  label="Mark words as learned"
                />
              </SheetRow>

              {/* The header drops the clock on a phone; this is where it went. */}
              <SheetRow icon={Clock} label="This session">
                <span className="text-[0.9375rem] tabular-nums text-fg-muted">
                  {formatClock(sessionSeconds)}
                </span>
              </SheetRow>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
