import { BookOpen, Check, ChevronDown, Expand, GraduationCap, Play, Volume2, WholeWord } from "lucide-react";
import type { ReactNode } from "react";
import { cn, verseKey } from "@/lib/utils";
import { verseTranslation } from "@/lib/language";
import { useLanguage, useT } from "@/providers/I18nProvider";
import type { VerseWithWords, WordStatus } from "@/lib/types";
import { WordChip } from "./WordChip";
import { TajweedText } from "./TajweedText";
import { InterlinearText } from "./InterlinearText";
import { Tooltip } from "@/components/ui/primitives";
import { usePendingMarks } from "@/hooks/useProgress";

/**
 * A marker that records something about this ayah — memorized, tafsir read,
 * words learned.
 *
 * The three stay visible whether lit or not. They are the ayah's progress, not
 * a control surface, and hiding the unlit ones only left whichever was lit
 * floating in the gap the others had vacated — the set reads as a set.
 */
function Marker({
  on,
  onToggle,
  busy,
  tooltip,
  label,
  tone,
  caption,
  children,
}: {
  on: boolean;
  onToggle: () => void;
  /**
   * Its write is on the way. The marker already shows the new state; it only
   * refuses another press until the server has answered.
   */
  busy?: boolean;
  tooltip: string;
  label: string;
  tone: "accent" | "gold" | "green";
  /**
   * Printed beside the icon, for the touch row. A finger has no tooltip to
   * reveal, and three bare icons do not say which is which.
   */
  caption?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        onClick={onToggle}
        disabled={busy}
        aria-busy={busy}
        aria-pressed={on}
        aria-label={label}
        className={cn(
          "transition-colors disabled:cursor-wait disabled:opacity-60",
          caption
            ? "inline-flex h-11 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-xl border px-2 text-[0.8125rem] font-medium"
            : "grid size-7 place-items-center rounded-lg",
          on
            ? tone === "accent"
              ? "border-transparent bg-accent-soft text-accent-soft-fg"
              : tone === "gold"
                ? "border-transparent bg-gold-soft text-gold-soft-fg"
                : "border-transparent bg-green-500/12 text-green-600 dark:text-green-400"
            : cn(
                "text-fg-subtle/70 hover:bg-surface-2 hover:text-fg",
                // Unlit, a captioned marker still has to look like something
                // to press; the icon-only ones lean on the tooltip instead.
                caption && "border-border text-fg-muted",
              ),
        )}
      >
        {children}
        {caption ? <span className="truncate">{caption}</span> : null}
      </button>
    </Tooltip>
  );
}

/** An action on this ayah. Always chrome, so it always fades with the row. */
function Action({
  onClick,
  tooltip,
  active,
  children,
}: {
  onClick: () => void;
  tooltip: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        onClick={onClick}
        aria-label={tooltip}
        className={cn(
          "verse-quiet inline-flex h-7 items-center gap-1 rounded-lg px-1.5 transition-colors",
          "touch:h-11 touch:min-w-11 touch:justify-center touch:rounded-xl",
          active
            ? "text-accent-soft-fg"
            : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function VerseCard({
  verse,
  memorized,
  onToggleMemorized,
  tafsirRead,
  onToggleTafsirRead,
  wordsLearned,
  onToggleWordsLearned,
  selected,
  onSelect,
  wordsExpanded,
  onToggleWords,
  interlinear,
  wordStatuses,
  onOpenFocus,
  tajweed,
  reciting,
  recitingWordPosition,
  onPlayFromHere,
  canPlay,
}: {
  verse: VerseWithWords;
  memorized: boolean;
  onToggleMemorized: () => void;
  /** Whether the tafsir on this ayah has been read. */
  tafsirRead: boolean;
  onToggleTafsirRead: () => void;
  /** Whether the words in this ayah have been learned. */
  wordsLearned: boolean;
  onToggleWordsLearned: () => void;
  selected: boolean;
  onSelect: () => void;
  wordsExpanded: boolean;
  onToggleWords: () => void;
  /**
   * Expanding the words prints each gloss under its word in the Arabic line,
   * rather than in a row of chips below the translation.
   */
  interlinear: boolean;
  wordStatuses: Map<number, WordStatus>;
  /**
   * Opens focus mode on this ayah. Absent in the continuous surah reader,
   * where a ruku's single-ayah view is not the mode being read in.
   */
  onOpenFocus?: () => void;
  /** Colour the Arabic by tajweed rule. */
  tajweed: boolean;
  /** This ayah is the one currently being recited. */
  reciting: boolean;
  /** Position of the word being recited, when this is the reciting ayah. */
  recitingWordPosition: number | null;
  onPlayFromHere: () => void;
  canPlay: boolean;
}) {
  const t = useT();
  const language = useLanguage();
  const reference = verseKey(verse.surah_number, verse.ayah_number);
  const pending = usePendingMarks();
  const wordsBusy = verse.words.some((word) => pending.words.has(word.id));

  // The three markers read as one group — "known by heart", "understood",
  // "vocabulary learned" is the set that says what is left to do on this
  // ayah. With a pointer they ride in the header beside the actions; on touch
  // that row cannot hold seven thumb-sized targets, so they drop to a row of
  // their own under the translation, captioned since no tooltip will show.
  const markers = (captioned: boolean) => (
    <>
      <Marker
        on={memorized}
        onToggle={onToggleMemorized}
        busy={pending.memorized.has(verse.id)}
        tooltip={memorized ? t("verse.memorized") : t("verse.markMemorized")}
        label={t("verse.markMemorizedLabel", { reference })}
        tone="accent"
        caption={captioned ? t("verse.markerMemorized") : undefined}
      >
        <Check className="size-3.5 shrink-0" aria-hidden />
      </Marker>

      <Marker
        on={tafsirRead}
        onToggle={onToggleTafsirRead}
        busy={pending.tafsirRead.has(verse.id)}
        tooltip={tafsirRead ? t("verse.tafsirRead") : t("verse.markTafsirRead")}
        label={t("verse.markTafsirLabel", { reference })}
        tone="gold"
        caption={captioned ? t("verse.markerTafsir") : undefined}
      >
        <GraduationCap className="size-3.5 shrink-0" aria-hidden />
      </Marker>

      <Marker
        on={wordsLearned}
        onToggle={onToggleWordsLearned}
        busy={wordsBusy}
        tooltip={wordsLearned ? t("verse.wordsLearned") : t("verse.markWordsLearned")}
        label={t("verse.markWordsLabel", { reference })}
        tone="green"
        caption={captioned ? t("verse.markerWords") : undefined}
      >
        <WholeWord className="size-3.5 shrink-0" aria-hidden />
      </Marker>
    </>
  );

  return (
    // No card: the ayah runs the full width of the reading column and is
    // divided from the next by a rule, the way a printed page divides them.
    // Everything horizontal comes from the one gutter.
    <article
      id={`verse-${verse.id}`}
      data-reciting={reciting || undefined}
      className={cn(
        "verse-row reader-gutter relative scroll-mt-24 border-b border-border py-6 md:py-7",
        "transition-colors",
        // Recitation wins over selection: it moves on its own and the reader
        // is following it, so it has to be findable at a glance while
        // scrolling. Selection is where they last clicked, which they know.
        reciting ? "bg-accent-soft/20" : selected ? "bg-surface-2/60" : null,
      )}
    >
      {/* With the border gone, the state that used to live in it moves to a
          rail on the column edge — visible while scrolling past, and it costs
          the text no width. */}
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-[3px] transition-colors",
          reciting ? "bg-accent" : selected ? "bg-accent/40" : "bg-transparent",
        )}
        aria-hidden
      />

      <div className="flex items-center gap-1">
        <span
          className={cn(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1.5",
            "text-[0.75rem] font-semibold tabular-nums",
            memorized ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted",
          )}
        >
          {reciting ? <Volume2 className="size-3.5" aria-hidden /> : verse.ayah_number}
        </span>

        <div className="flex items-center gap-1 touch:hidden">
          <span className="mx-1.5 h-4 w-px bg-border" aria-hidden />
          {markers(false)}
        </div>

        <span className="flex-1" />

        {canPlay ? (
          <Action onClick={onPlayFromHere} tooltip={t("verse.playFromHere")} active={reciting}>
            <Play className="size-3.5" aria-hidden />
          </Action>
        ) : null}

        <Action
          onClick={onToggleWords}
          tooltip={wordsExpanded ? t("verse.hideWordByWord") : t("verse.showWordByWord")}
          active={wordsExpanded}
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", wordsExpanded && "rotate-180")}
            aria-hidden
          />
          <span className="text-[0.6875rem] tabular-nums">{verse.words.length}</span>
        </Action>

        <Action onClick={onSelect} tooltip={t("verse.tafsir")} active={selected}>
          <BookOpen className="size-3.5" aria-hidden />
        </Action>

        {onOpenFocus ? (
          <Action onClick={onOpenFocus} tooltip={t("verse.focusHint")}>
            <Expand className="size-3.5" aria-hidden />
          </Action>
        ) : null}
      </div>

      {interlinear && wordsExpanded ? (
        <InterlinearText
          className="mt-4"
          verse={verse}
          wordStatuses={wordStatuses}
          tajweed={tajweed}
          recitingWordPosition={reciting ? recitingWordPosition : null}
        />
      ) : (
        <p className="arabic mt-4 text-fg" data-selectable dir="rtl">
          <TajweedText text={verse.arabic_text} spans={verse.tajweed} enabled={tajweed} />
        </p>
      )}

      <p className="mt-4 text-[0.9375rem] leading-relaxed text-fg-muted" data-selectable>
        {verseTranslation(verse, language)}
      </p>

      <div className="mt-5 hidden gap-2 touch:flex">{markers(true)}</div>

      {wordsExpanded && !interlinear ? (
        <div className="mt-5 rounded-xl border border-border bg-surface-2/40 p-3.5">
          <div className="flex flex-wrap gap-2" dir="rtl">
            {verse.words.map((word) => (
              <WordChip
                key={word.id}
                word={word}
                verse={verse}
                status={wordStatuses.get(word.id)}
                reciting={reciting && recitingWordPosition === word.position}
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
