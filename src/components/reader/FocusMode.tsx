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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Languages,
  Minus,
  Palette,
  Plus,
  ScanText,
  X,
} from "lucide-react";
import { cn, formatClock } from "@/lib/utils";
import type { VerseWithWords, WordStatus } from "@/lib/types";
import { IS_TAURI, setFullscreen } from "@/lib/window";
import { Spinner } from "@/components/ui/feedback";
import { WordChip } from "./WordChip";
import { TajweedText } from "./TajweedText";

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
        // Narrow on a phone: every pixel these take is taken from the ayah.
        "group absolute inset-y-0 z-10 flex w-10 flex-col items-center justify-center gap-1.5 sm:w-24",
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
  wordStatuses,
  sessionSeconds,
  loading,
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
  wordStatuses: Map<number, WordStatus>;
  sessionSeconds: number;
  loading: boolean;
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

  const [sizeIndex, setSizeIndex] = useState(() => {
    const stored = Number(localStorage.getItem(SIZE_KEY));
    return Number.isInteger(stored) && stored >= 0 && stored < TEXT_SIZES.length ? stored : 2;
  });
  const [showTranslation, setShowTranslation] = useState(
    () => localStorage.getItem(TRANSLATION_KEY) !== "off",
  );
  const [showWords, setShowWords] = useState(false);

  const verse = verses[Math.min(index, verses.length - 1)];
  const size = TEXT_SIZES[sizeIndex]!;
  const atFirst = index <= 0;
  const atLast = index >= verses.length - 1;

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
    onToggleMemorized,
    onToggleTajweed,
    resize,
    toggleTranslation,
    verse,
  ]);

  const isMemorized = verse ? memorized.has(verse.id) : false;
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
          "relative z-20 flex shrink-0 items-center gap-3 px-3 py-2.5 transition-opacity duration-500",
          "sm:gap-4 sm:px-6 sm:py-4",
          chromeHidden && "opacity-0",
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{surahName}</div>
          <div className="text-[0.75rem] text-fg-subtle">
            Ruku {rukuNumber}
            {rukuInSurah ? ` · ruku ${rukuInSurah} in this surah` : ""}
          </div>
        </div>

        <div className="flex-1" />

        <div className="hidden items-center gap-1.5 text-[0.75rem] tabular-nums text-fg-subtle sm:flex">
          <Clock className="size-3.5" aria-hidden />
          {formatClock(sessionSeconds)}
        </div>

        <button
          type="button"
          onClick={onExit}
          aria-label="Exit focus mode"
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-[0.8125rem] text-fg-muted transition-colors hover:border-border-strong hover:text-fg sm:h-9"
        >
          <X className="size-4" aria-hidden />
          <span className="hidden sm:inline">Exit</span>
          {/* A key hint is noise on a device with no keyboard. */}
          <kbd className="hidden rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[0.6875rem] sm:inline">
            Esc
          </kbd>
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
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

        <div className="h-full overflow-y-auto px-11 sm:px-24">
          {loading || !verse ? (
            <div className="grid h-full place-items-center">
              <Spinner className="size-6" />
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center py-8">
              {/* Keyed so moving between ayahs is a soft cross-fade. */}
              <div
                key={verse.id}
                className="mx-auto flex w-full max-w-5xl flex-col items-center text-center animate-fade-in"
              >
                <div className="mb-9 flex items-center gap-3 text-[0.6875rem] font-medium uppercase tracking-[0.18em] text-fg-subtle">
                  <span>Ayah {verse.ayah_number}</span>
                  <span className="h-3 w-px bg-border" aria-hidden />
                  <span className="tabular-nums">
                    {index + 1} of {verses.length}
                  </span>
                  {isMemorized ? (
                    <>
                      <span className="h-3 w-px bg-border" aria-hidden />
                      <span className="text-accent">Memorized</span>
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
                    <span className="my-9 h-px w-16 bg-border" aria-hidden />
                    <p
                      className="max-w-3xl leading-relaxed text-fg-muted"
                      data-selectable
                      style={{ fontSize: size.translation }}
                    >
                      {verse.translation_en}
                    </p>
                  </>
                ) : null}

                {showWords ? (
                  <div className="mt-10 w-full border-t border-border pt-8">
                    <div className="flex flex-wrap justify-center gap-2" dir="rtl">
                      {verse.words.map((word) => (
                        <WordChip
                          key={word.id}
                          word={word}
                          verse={verse}
                          status={wordStatuses.get(word.id)}
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

      <footer
        className={cn(
          "relative z-20 shrink-0 px-6 pb-5 pt-3 transition-opacity duration-500",
          chromeHidden && "opacity-0",
        )}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <ControlButton
            onClick={() => verse && onToggleMemorized(verse)}
            active={isMemorized}
            label={isMemorized ? "Unmark as memorized" : "Mark as memorized"}
          >
            <Check className="size-4" aria-hidden />
            {isMemorized ? "Memorized" : "Mark memorized"}
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

          <div className="ml-1 flex items-center gap-1 rounded-lg border border-border px-1">
            <button
              type="button"
              onClick={() => resize(-1)}
              disabled={sizeIndex === 0}
              aria-label="Smaller text"
              className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-30"
            >
              <Minus className="size-3.5" aria-hidden />
            </button>
            <span className="px-0.5 text-[0.6875rem] tabular-nums text-fg-subtle">
              {sizeIndex + 1}
            </span>
            <button
              type="button"
              onClick={() => resize(1)}
              disabled={sizeIndex === TEXT_SIZES.length - 1}
              aria-label="Larger text"
              className="grid size-7 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-30"
            >
              <Plus className="size-3.5" aria-hidden />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[0.75rem] text-fg-subtle">
          <Hint keys={["←", "→"]} label="ayah" />
          <Hint keys={["M"]} label="memorized" />
          <Hint keys={["W"]} label="words" />
          <Hint keys={["T"]} label="translation" />
          <Hint keys={["C"]} label="tajweed" />
          <Hint keys={["+", "−"]} label="text size" />
        </div>
      </footer>
    </div>
  );
}
