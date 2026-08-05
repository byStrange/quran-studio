import { BookOpen, Check, ChevronDown } from "lucide-react";
import { cn, verseKey } from "@/lib/utils";
import type { VerseWithWords, WordStatus } from "@/lib/types";
import { WordChip } from "./WordChip";
import { Tooltip } from "@/components/ui/primitives";

export function VerseCard({
  verse,
  memorized,
  onToggleMemorized,
  selected,
  onSelect,
  wordsExpanded,
  onToggleWords,
  wordStatuses,
}: {
  verse: VerseWithWords;
  memorized: boolean;
  onToggleMemorized: () => void;
  selected: boolean;
  onSelect: () => void;
  wordsExpanded: boolean;
  onToggleWords: () => void;
  wordStatuses: Map<number, WordStatus>;
}) {
  return (
    <article
      id={`verse-${verse.id}`}
      className={cn(
        "scroll-mt-4 rounded-card border bg-surface transition-colors",
        selected ? "border-accent/50 shadow-sm" : "border-border",
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
            {verse.ayah_number}
          </span>

          <Tooltip content={memorized ? "Marked as memorized" : "Mark as memorized"}>
            <button
              onClick={onToggleMemorized}
              aria-pressed={memorized}
              aria-label={`Mark ${verseKey(verse.surah_number, verse.ayah_number)} as memorized`}
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
        </div>

        <div className="min-w-0 flex-1">
          <p className="arabic text-fg" data-selectable dir="rtl">
            {verse.arabic_text}
          </p>

          <p className="mt-4 text-[0.9375rem] leading-relaxed text-fg-muted" data-selectable>
            {verse.translation_en}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-1">
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
              {wordsExpanded ? "Hide" : "Show"} word by word
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
              Tafsir
            </button>
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
              />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}
