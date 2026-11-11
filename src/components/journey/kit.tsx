/**
 * What every Journey scene is built from.
 *
 * A scene is one screen of a lesson: it is handed the stop, draws itself, and
 * calls `onDone` once with how many wrong answers were given. It owns nothing
 * beyond that — the lesson decides what comes next, keeps the score and draws
 * the bar across the top — which is what keeps a scene small enough to be
 * written, and replaced, on its own.
 */
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowRight, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TajweedText } from "@/components/reader/TajweedText";
import { useT } from "@/providers/I18nProvider";
import type { JourneyAudio } from "@/hooks/useJourneyAudio";
import type {
  JourneyIndex,
  JourneyVerse,
  JourneyWord,
  Scene,
  SceneKind,
  Stop,
} from "@/lib/journey/plan";

export interface SceneProps<K extends SceneKind = SceneKind> {
  scene: Extract<Scene, { kind: K }>;
  stop: Stop;
  /** Looks up any verse or word of the surah by the ids a scene carries. */
  index: JourneyIndex;
  audio: JourneyAudio;
  /** Whether the reader has tajweed colouring switched on. */
  tajweed: boolean;
  /**
   * Call once, when the scene is complete, with the number of wrong answers.
   * A scene with nothing to get wrong reports 0.
   */
  onDone: (mistakes: number) => void;
}

/**
 * The frame of a scene: what to do, the thing itself, and the way onward.
 *
 * The body scrolls and the footer does not, so the button that moves the
 * lesson along is always where the thumb left it, however long the ayah.
 */
export function SceneLayout({
  title,
  hint,
  children,
  footer,
  className,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 pb-6 pt-5 md:px-8">
          <header className="journey-rise text-center">
            <h1 className="text-[1.375rem] font-semibold tracking-tight text-fg">{title}</h1>
            {hint ? (
              <p className="mx-auto mt-1.5 max-w-md text-[0.9375rem] leading-snug text-fg-muted">
                {hint}
              </p>
            ) : null}
          </header>
          <div className={cn("flex flex-1 flex-col justify-center py-6", className)}>
            {children}
          </div>
        </div>
      </div>
      {footer ? (
        <footer className="shrink-0 border-t border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-8">
            {footer}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

/** The one way out of a scene. Disabled until the scene has been done. */
export function ContinueButton({
  onClick,
  disabled,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  // Becoming available is the moment it is wanted: on a keyboard, Enter
  // should carry on without a trip through every tile first.
  useEffect(() => {
    if (!disabled) ref.current?.focus({ preventScroll: true });
  }, [disabled]);
  return (
    <Button
      ref={ref}
      variant="primary"
      size="lg"
      className={cn("ml-auto min-w-40", !disabled && "journey-pop")}
      disabled={disabled}
      onClick={onClick}
    >
      {label ?? t("journey.lesson.continue")}
      <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
    </Button>
  );
}

export type TileState = "selected" | "correct" | "wrong" | "done";

/**
 * Something tapped to answer. See `.journey-tile` in index.css for the looks;
 * `state` is undefined while the tile is simply waiting to be tapped.
 */
export function Tile({
  state,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { state?: TileState }) {
  return (
    <button
      type="button"
      data-state={state}
      className={cn(
        "journey-tile flex min-h-14 items-center justify-center px-4 py-2.5 text-center",
        "text-[0.9375rem] font-medium leading-snug disabled:cursor-default",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** One word of Quran text, coloured by tajweed when that is switched on. */
export function WordArabic({ word, tajweed }: { word: JourneyWord; tajweed: boolean }) {
  return <TajweedText text={word.text} spans={word.tajweed} enabled={tajweed} />;
}

/** A whole ayah of Quran text. Sized by the caller (`journey-arabic[-sm]`). */
export function VerseArabic({
  verse,
  tajweed,
  className,
}: {
  verse: JourneyVerse;
  tajweed: boolean;
  className?: string;
}) {
  return (
    <span dir="rtl" lang="ar" className={className}>
      <TajweedText text={verse.arabic} spans={verse.tajweed} enabled={tajweed} />
    </span>
  );
}

/** The ayah's number, in the roundel a mushaf closes an ayah with. */
export function AyahNumber({ ayah, className }: { ayah: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-grid size-7 shrink-0 place-items-center rounded-full border border-border-strong",
        "text-[0.6875rem] font-semibold tabular-nums text-fg-subtle",
        className,
      )}
    >
      {ayah}
    </span>
  );
}

/** A round button that plays something. Pulses while it is the thing to press. */
export function SpeakerButton({
  onClick,
  label,
  active,
  size = "md",
  disabled,
}: {
  onClick: () => void;
  label: string;
  /** Sound is coming out of it right now. */
  active?: boolean;
  size?: "md" | "lg";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-accent text-accent-fg",
        "transition-transform active:scale-95 disabled:opacity-40",
        size === "lg" ? "size-20" : "size-11",
        active && "journey-pulse",
      )}
    >
      <Volume2 className={size === "lg" ? "size-9" : "size-5"} aria-hidden />
    </button>
  );
}

/**
 * Whether a word can be heard on its own.
 *
 * False without a recording, and for the occasional word the reciter's timing
 * data has no span for. Scenes use it to decide between "hear it" and a silent
 * way of asking the same question — never to hide a word.
 */
export function canHear(audio: JourneyAudio, verse: JourneyVerse, word: JourneyWord): boolean {
  return audio.available && audio.hasWord(verse.id, word.position);
}
