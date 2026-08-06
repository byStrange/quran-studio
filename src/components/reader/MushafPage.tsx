/**
 * One page of the Madani mushaf, reproduced from its own page font.
 *
 * The page is laid out as 15 equal line boxes, which is what makes it read as
 * a page rather than as a column of text: blank and heading lines take up the
 * same room they do on paper, so the ayah lines land where the eye expects
 * them. Line boxes are sized in `em`, so the whole page scales as one when the
 * font size changes.
 *
 * Nothing is painted until the page font has loaded — see `useMushafScale`.
 */
import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  surahNameGlyph,
  type MushafGlyph,
  type MushafLine,
  type MushafPageData,
} from "@/lib/mushaf";

/** Consecutive glyphs on one line that belong to the same ayah. */
interface VerseRun {
  verseId: number;
  text: string;
}

function toVerseRuns(glyphs: readonly MushafGlyph[]): VerseRun[] {
  const runs: VerseRun[] = [];
  for (const glyph of glyphs) {
    const last = runs[runs.length - 1];
    if (last && last.verseId === glyph.verse_id) last.text += glyph.glyph;
    else runs.push({ verseId: glyph.verse_id, text: glyph.glyph });
  }
  return runs;
}

export const MushafPage = memo(function MushafPage({
  page,
  fontFamily,
  fontSize,
  selectedVerseId,
  onSelectVerse,
  memorized,
}: {
  page: MushafPageData;
  fontFamily: string;
  /** Pixel size that makes a full line span the measure. Null while measuring. */
  fontSize: number | null;
  selectedVerseId: number | null;
  onSelectVerse: (verseId: number) => void;
  memorized: ReadonlySet<number>;
}) {
  return (
    <div
      className="mushaf-page"
      style={{
        fontFamily: `"${fontFamily}"`,
        // Hidden rather than unmounted while measuring, so the measurement
        // happens against the real layout instead of a stand-in.
        fontSize: fontSize ?? 32,
        visibility: fontSize === null ? "hidden" : undefined,
      }}
      dir="rtl"
    >
      {page.lines.map((line) => (
        <MushafPageLine
          key={line.line_number}
          line={line}
          selectedVerseId={selectedVerseId}
          onSelectVerse={onSelectVerse}
          memorized={memorized}
        />
      ))}
    </div>
  );
});

function MushafPageLine({
  line,
  selectedVerseId,
  onSelectVerse,
  memorized,
}: {
  line: MushafLine & { glyphs: MushafGlyph[] };
  selectedVerseId: number | null;
  onSelectVerse: (verseId: number) => void;
  memorized: ReadonlySet<number>;
}) {
  const runs = useMemo(() => toVerseRuns(line.glyphs), [line.glyphs]);

  if (line.line_type === "blank") {
    return <div className="mushaf-line" aria-hidden />;
  }

  if (line.line_type === "surah_name") {
    return (
      <div className="mushaf-line mushaf-line-centered">
        <span className="mushaf-surah-banner">{surahNameGlyph(line.surah_number!)}</span>
      </div>
    );
  }

  if (line.line_type === "basmalah") {
    // Not ayah text outside Al-Fatiha, so the mushaf fonts carry no glyph for
    // it. Set in the app's Quran typeface instead, sized to sit within the line.
    return (
      <div className="mushaf-line mushaf-line-centered">
        <span className="mushaf-basmalah">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mushaf-line",
        line.is_centered ? "mushaf-line-centered" : "mushaf-line-full",
      )}
    >
      {runs.map((run) => (
        <span
          key={run.verseId}
          role="button"
          tabIndex={0}
          data-verse-id={run.verseId}
          data-selected={run.verseId === selectedVerseId ? "" : undefined}
          data-memorized={memorized.has(run.verseId) ? "" : undefined}
          className="mushaf-ayah"
          onClick={() => onSelectVerse(run.verseId)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectVerse(run.verseId);
            }
          }}
        >
          {run.text}
        </span>
      ))}
    </div>
  );
}
