/**
 * Madani mushaf rendering.
 *
 * Mushaf mode does not re-typeset the Quran — it replays the printed King Fahd
 * mushaf. Each of the 604 pages has its own font in which every word is a
 * single Private Use Area glyph, drawn with that line's justification already
 * in the outline. So a line is rendered by emitting its glyph codes in order;
 * there is no letter spacing, kashida or `text-align: justify` to apply, and
 * doing any of those would break the fidelity rather than help it.
 *
 * Two consequences shape this file. Glyph codes mean nothing except in their
 * own page's font, so fonts are loaded per page and text must not be rendered
 * before its font arrives — a fallback typeface would draw 15 lines of tofu.
 * And because a page font is 60–90KB, they are fetched on demand and kept,
 * rather than all 46MB being declared up front.
 *
 * The page is monochrome. Tajweed colouring belongs to the study reader, which
 * colours character ranges over the readable Arabic; the mushaf draws whole
 * words as single glyphs, and there is no honest way to colour two letters of
 * one. `pnpm test:mushaf-fonts` guards the pairing between these codes and the
 * files that draw them.
 */
export const TOTAL_PAGES = 604;
export const LINES_PER_PAGE = 15;

export type MushafLineType = "ayah" | "surah_name" | "basmalah" | "blank";

export interface MushafLine {
  page_number: number;
  line_number: number;
  line_type: MushafLineType;
  surah_number: number | null;
  is_centered: boolean;
}

export interface MushafGlyph {
  id: number;
  verse_id: number;
  page_number: number;
  line_number: number;
  position: number;
  glyph: string;
  char_type: "word" | "end";
}

/** A page as the renderer wants it: lines in order, each with its glyphs. */
export interface MushafPageData {
  page: number;
  lines: Array<MushafLine & { glyphs: MushafGlyph[] }>;
  /** Ayah ids on the page, first to last, for prev/next and tafsir selection. */
  verseIds: number[];
}

// --- fonts -----------------------------------------------------------------

export const pageFontFamily = (page: number): string => `QCF-P${page}`;

const fontUrl = (page: number): string => `/fonts/qcf/p${page}.woff2`;

/** Pages whose @font-face has been declared, so it is only declared once. */
const declared = new Set<number>();
/** In-flight and settled load promises, keyed by page. */
const loading = new Map<number, Promise<void>>();

function declareFont(page: number): void {
  if (declared.has(page)) return;
  declared.add(page);

  const family = pageFontFamily(page);
  const style = document.createElement("style");
  style.dataset.qcfPage = String(page);

  // `font-display: block` rather than `swap`: there is no sensible fallback
  // for PUA glyphs, so waiting is right and swapping would flash tofu.
  style.textContent = `
@font-face {
  font-family: "${family}";
  src: url("${fontUrl(page)}") format("woff2");
  font-display: block;
}
`;
  document.head.append(style);
}

/**
 * Declares and loads a page's font, resolving once it can actually be painted.
 *
 * `document.fonts.load` is given a real glyph from the page: the default probe
 * string is Latin, which no QCF font contains, and the browser would report
 * success without fetching anything.
 */
export function loadPageFont(page: number, sampleGlyph: string): Promise<void> {
  const existing = loading.get(page);
  if (existing) return existing;

  declareFont(page);
  const family = pageFontFamily(page);
  const promise = document.fonts
    .load(`1rem "${family}"`, sampleGlyph)
    .then((faces) => {
      if (faces.length === 0) {
        throw new Error(`page font ${family} did not load`);
      }
    })
    .catch((error) => {
      // Let a later attempt retry rather than caching the failure forever.
      loading.delete(page);
      throw error;
    });

  loading.set(page, promise);
  return promise;
}

// --- surah name banners ----------------------------------------------------

/**
 * The ornamental surah-name glyph for a surah.
 *
 * The banner font encodes the surah number as its decimal digits read as hex —
 * surah 5 is U+E005, surah 12 U+E012, surah 114 U+E114 — so the codepoint is
 * built from the zero-padded number rather than by adding an offset.
 */
export function surahNameGlyph(surahNumber: number): string {
  if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) {
    throw new Error(`no surah ${surahNumber}`);
  }
  return String.fromCodePoint(parseInt(`E${String(surahNumber).padStart(3, "0")}`, 16));
}

// --- navigation ------------------------------------------------------------

export function isValidPage(page: number): boolean {
  return Number.isInteger(page) && page >= 1 && page <= TOTAL_PAGES;
}

/** Groups a page's flat glyph rows onto its lines, in reading order. */
export function assemblePage(
  page: number,
  lines: readonly MushafLine[],
  glyphs: readonly MushafGlyph[],
): MushafPageData {
  const byLine = new Map<number, MushafGlyph[]>();
  for (const glyph of glyphs) {
    const list = byLine.get(glyph.line_number);
    if (list) list.push(glyph);
    else byLine.set(glyph.line_number, [glyph]);
  }
  for (const list of byLine.values()) {
    // Word ids ascend through the mushaf, so they are already reading order —
    // but position resets per verse, so sorting on it alone would interleave
    // the verses that share a line.
    list.sort((a, b) => a.id - b.id);
  }

  const verseIds: number[] = [];
  const seen = new Set<number>();

  const assembled = [...lines]
    .sort((a, b) => a.line_number - b.line_number)
    .map((line) => {
      const lineGlyphs = byLine.get(line.line_number) ?? [];
      for (const glyph of lineGlyphs) {
        if (!seen.has(glyph.verse_id)) {
          seen.add(glyph.verse_id);
          verseIds.push(glyph.verse_id);
        }
      }
      return { ...line, glyphs: lineGlyphs };
    });

  return { page, lines: assembled, verseIds };
}
