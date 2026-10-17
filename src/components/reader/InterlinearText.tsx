/**
 * An ayah printed word by word, each word over its own gloss.
 *
 * Takes the place of the plain Arabic line when the reader has chosen to read
 * the word-by-word under the text rather than in a row of chips beneath it.
 * The words still flow right to left and wrap like a line of text; each one
 * opens the same explanation a chip does.
 *
 * Not selectable: every word is a button, and a drag across buttons selects
 * nothing. Collapsing the words brings the plain, copyable line back.
 */
import { useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { splitVerseWords } from "@/lib/interlinear";
import { sliceTajweedSpans } from "@/lib/tajweed";
import { wordGloss } from "@/lib/language";
import type { VerseWithWords, WordStatus } from "@/lib/types";
import { useLanguage } from "@/providers/I18nProvider";
import { TajweedText } from "./TajweedText";
import { WordPopover } from "./WordPopover";

/**
 * Learning status shows on the gloss rather than as a box around the word: a
 * line of boxes would stop reading as a line of text.
 */
const GLOSS_STATUS: Record<WordStatus | "none", string> = {
  none: "text-fg-muted",
  new: "text-fg-muted",
  learning: "text-gold",
  learned: "text-accent",
};

export function InterlinearText({
  verse,
  wordStatuses,
  tajweed,
  recitingWordPosition,
  className,
  arabicStyle,
  glossStyle,
}: {
  verse: VerseWithWords;
  wordStatuses: Map<number, WordStatus>;
  tajweed: boolean;
  /** Position of the word being recited, or null when none is. */
  recitingWordPosition: number | null;
  className?: string;
  /** Sizing for the Arabic, for focus mode's adjustable text size. */
  arabicStyle?: CSSProperties;
  glossStyle?: CSSProperties;
}) {
  const language = useLanguage();

  const words = useMemo(() => {
    const ranges = splitVerseWords(verse.arabic_text, verse.words.length);
    return verse.words.map((word, index) => {
      const range = ranges?.[index];
      return range
        ? {
            word,
            text: verse.arabic_text.slice(range.start, range.end),
            spans: sliceTajweedSpans(verse.tajweed, range.start, range.end),
          }
        : // The verse does not divide into the word list's words, so its
          // spans cannot be placed on them: show the word list's spelling,
          // uncoloured, rather than colour the wrong letters.
          { word, text: word.arabic, spans: null };
    });
  }, [verse]);

  return (
    <div
      dir="rtl"
      className={cn("flex flex-wrap items-start gap-x-1 gap-y-3", className)}
    >
      {words.map(({ word, text, spans }) => {
        const reciting = recitingWordPosition === word.position;
        return (
          <WordPopover
            key={word.id}
            word={word}
            verse={verse}
            status={wordStatuses.get(word.id)}
          >
            <button
              className={cn(
                "flex flex-col items-center rounded-lg px-1.5 pb-1.5 text-center",
                "transition-colors hover:bg-surface-2",
                reciting && "bg-accent-soft ring-2 ring-accent/30 hover:bg-accent-soft",
              )}
            >
              <span className="arabic leading-[1.9] text-fg" style={arabicStyle}>
                <TajweedText text={text} spans={spans} enabled={tajweed} />
              </span>
              <span
                dir="auto"
                className={cn(
                  // Capped so one long gloss cannot push its word a line
                  // apart from the next; the Arabic itself is never capped.
                  "max-w-[9rem] text-[0.75rem] leading-snug",
                  reciting ? "text-accent-soft-fg" : GLOSS_STATUS[wordStatuses.get(word.id) ?? "none"],
                )}
                style={glossStyle}
              >
                {wordGloss(word, language)}
              </span>
            </button>
          </WordPopover>
        );
      })}
    </div>
  );
}
