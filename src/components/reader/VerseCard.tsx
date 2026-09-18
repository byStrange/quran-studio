import { BookOpen, Check, ChevronDown, Expand, GraduationCap, Play, Volume2, WholeWord } from "lucide-react";
import { cn, verseKey } from "@/lib/utils";
import { verseTranslation } from "@/lib/language";
import { useLanguage, useT } from "@/providers/I18nProvider";
import type { VerseWithWords, WordStatus } from "@/lib/types";
import { WordChip } from "./WordChip";
import { TajweedText } from "./TajweedText";
import { Tooltip } from "@/components/ui/primitives";

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

  return (
    <article
      id={`verse-${verse.id}`}
      data-reciting={reciting || undefined}
      className={cn(
        "scroll-mt-24 rounded-card border bg-surface transition-colors",
        // Recitation wins over selection: it moves on its own and the reader
        // is following it, so it has to be findable at a glance while
        // scrolling. Selection is where they last clicked, which they know.
        reciting
          ? "border-accent bg-accent-soft/25 shadow-sm"
          : selected
            ? "border-accent/50 shadow-sm"
            : "border-border",
      )}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <span
            className={cn(
              "grid size-8 place-items-center rounded-full text-[0.75rem] font-semibold tabular-nums",
              memorized ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-muted",
            )}
          >
            {reciting ? <Volume2 className="size-3.5" aria-hidden /> : verse.ayah_number}
          </span>

          <Tooltip content={memorized ? t("verse.memorized") : t("verse.markMemorized")}>
            <button
              onClick={onToggleMemorized}
              aria-pressed={memorized}
              aria-label={t("verse.markMemorizedLabel", { reference })}
              className={cn(
                "grid size-7 place-items-center rounded-lg border transition-colors",
                memorized
                  ? "border-accent/40 bg-accent-soft text-accent-soft-fg"
                  : "border-border text-fg-subtle hover:border-border-strong hover:text-fg",
              )}
            >
              <Check className="size-3.5" aria-hidden />
            </button>
          </Tooltip>

          {/* The second marker sits directly under the first because the two
              are read together — "known by heart" and "understood" are the
              pair that tells you what is left to do on this ayah. */}
          <Tooltip content={tafsirRead ? t("verse.tafsirRead") : t("verse.markTafsirRead")}>
            <button
              onClick={onToggleTafsirRead}
              aria-pressed={tafsirRead}
              aria-label={t("verse.markTafsirLabel", { reference })}
              className={cn(
                "grid size-7 place-items-center rounded-lg border transition-colors",
                tafsirRead
                  ? "border-gold/50 bg-gold-soft text-gold-soft-fg"
                  : "border-border text-fg-subtle hover:border-border-strong hover:text-fg",
              )}
            >
              <GraduationCap className="size-3.5" aria-hidden />
            </button>
          </Tooltip>

          <Tooltip content={wordsLearned ? t("verse.wordsLearned") : t("verse.markWordsLearned")}>
            <button
              onClick={onToggleWordsLearned}
              aria-pressed={wordsLearned}
              aria-label={t("verse.markWordsLabel", { reference })}
              className={cn(
                "grid size-7 place-items-center rounded-lg border transition-colors",
                wordsLearned
                  ? "border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-border text-fg-subtle hover:border-border-strong hover:text-fg",
              )}
            >
              <WholeWord className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
        </div>

        <div className="min-w-0 flex-1">
          <p className="arabic text-fg" data-selectable dir="rtl">
            <TajweedText text={verse.arabic_text} spans={verse.tajweed} enabled={tajweed} />
          </p>

          <p className="mt-4 text-[0.9375rem] leading-relaxed text-fg-muted" data-selectable>
            {verseTranslation(verse, language)}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-1">
            {canPlay ? (
              <Tooltip content={t("verse.playFromHere")}>
                <button
                  onClick={onPlayFromHere}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8125rem]",
                    "transition-colors",
                    reciting
                      ? "text-accent-soft-fg"
                      : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Play className="size-3.5" aria-hidden />
                  {t("verse.play")}
                </button>
              </Tooltip>
            ) : null}

            <button
              onClick={onToggleWords}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8125rem]",
                "text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg",
              )}
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", wordsExpanded && "rotate-180")}
                aria-hidden
              />
              {wordsExpanded ? t("verse.hideWordByWord") : t("verse.showWordByWord")}
              <span className="text-fg-subtle">({verse.words.length})</span>
            </button>

            <button
              onClick={onSelect}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8125rem] transition-colors",
                selected
                  ? "text-accent-soft-fg"
                  : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
              )}
            >
              <BookOpen className="size-3.5" aria-hidden />
              {t("verse.tafsir")}
            </button>

            {onOpenFocus ? (
            <Tooltip content={t("verse.focusHint")}>
              <button
                onClick={onOpenFocus}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.8125rem]",
                  "text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg",
                )}
              >
                <Expand className="size-3.5" aria-hidden />
                {t("verse.focus")}
              </button>
            </Tooltip>
            ) : null}
          </div>
        </div>
      </div>

      {wordsExpanded ? (
        <div className="border-t border-border bg-surface-2/40 p-4">
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
