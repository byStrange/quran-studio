/**
 * The verse translations the reader has selected, stacked.
 *
 * One place for the rule that used to be copied into every reader: resolve the
 * selected editions, print each one, and attribute it only when more than one
 * is shown — a lone translation needs no label to tell it apart. The three
 * readers differ only in how the block is laid out, which the props carry:
 * the study and focus columns stack labelled blocks, the mushaf side-panel
 * prints compact lines led by the ayah reference with the attribution inline.
 */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { selectedVerseTranslations, type MultiTranslatedVerse } from "@/lib/language";
import { useLanguage } from "@/providers/I18nProvider";

export function VerseTranslations({
  verse,
  translations,
  className,
  align = "start",
  textClassName,
  textStyle,
  leading,
  inlineLabel = false,
}: {
  verse: MultiTranslatedVerse;
  /** Selected edition keys; empty follows the interface language. */
  translations: string[];
  className?: string;
  /** Left-aligned blocks (study, mushaf) or centred ones (focus mode). */
  align?: "start" | "center";
  textClassName?: string;
  /** Sizing for the translation text, for focus mode's adjustable size. */
  textStyle?: CSSProperties;
  /** Rendered before the first translation's text — the ayah reference in the mushaf panel. */
  leading?: ReactNode;
  /** Put the attribution inline before the text rather than as a block above it. */
  inlineLabel?: boolean;
}) {
  const language = useLanguage();
  const shown = selectedVerseTranslations(verse, translations, language);
  const attributed = shown.length > 1;

  return (
    <div
      data-selectable
      className={cn(align === "center" ? "flex flex-col items-center gap-4" : "space-y-3", className)}
    >
      {shown.map((tr, i) => (
        <div key={tr.key} className={align === "center" ? "flex flex-col items-center gap-1" : undefined}>
          {attributed && !inlineLabel ? (
            <div
              className={cn(
                "text-[0.6875rem] font-medium uppercase tracking-wide text-fg-subtle",
                align === "start" && "mb-0.5",
              )}
            >
              {tr.translator}
            </div>
          ) : null}
          <p lang={tr.tag} className={cn("leading-relaxed text-fg-muted", textClassName)} style={textStyle}>
            {i === 0 ? leading : null}
            {attributed && inlineLabel ? (
              <span className="mr-1.5 font-medium text-fg-subtle">{tr.translator}:</span>
            ) : null}
            {tr.text}
          </p>
        </div>
      ))}
    </div>
  );
}
