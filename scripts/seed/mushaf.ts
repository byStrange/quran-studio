/**
 * Madani mushaf page layout.
 *
 * quran.com's `verses/by_page` endpoint returns, for every word, the page and
 * line it occupies in the printed King Fahd mushaf together with its glyph
 * code in that page's QCF font. That is enough to place ayah text, but not to
 * reproduce a page: the endpoint says nothing about the ornamental surah-name
 * banner or the basmalah beneath it, because neither is ayah text.
 *
 * Those lines are recoverable anyway. Line numbers are assigned over the
 * *printed* page, so the furniture still consumes them — a surah opening
 * mid-page leaves a gap in the numbering exactly as wide as the lines it
 * occupies. `deriveLines` reads the gaps back out, and every derivation is
 * checked rather than trusted: each page must come to exactly 15 lines, and
 * each gap must be the width the surah in question is supposed to need.
 */
import { cachedJson, log } from "./util.ts";

const QURAN_API = "https://api.quran.com/api/v4";

export const TOTAL_PAGES = 604;
export const LINES_PER_PAGE = 15;

/**
 * Lines the printed mushaf centres instead of stretching to the full measure.
 *
 * These cannot be derived: a short line and a centred one are the same glyphs,
 * and the QCF fonts bake justification into the outlines, so nothing in the
 * data distinguishes them. The list is quran.com's, which is in turn read off
 * the printed copy — pages 1 and 2 entirely, plus the closing line of surahs
 * that end partway across a line.
 */
const CENTERED: Record<number, readonly number[]> = {
  255: [2], // 13 Ar-Ra'd, last ayah
  528: [9], // 67 Al-Qalam, last ayah
  534: [6], // 55 Ar-Rahman, last ayah
  545: [6], // 58 Al-Mujadila, last ayah
  586: [1], // 80 'Abasa, last ayah
  593: [2], // 88 Al-Ghashiyah, last two ayahs
  594: [5], // 89 Al-Fajr, last two ayahs
  600: [10], // 100 Al-'Adiyat, last two ayahs
  602: [5, 15], // 106 Quraysh, 108 Al-Kawthar
  603: [10, 15], // 110 An-Nasr, 111 Al-Masad
  604: [4, 9, 14, 15], // 112 Al-Ikhlas, 113 Al-Falaq, 114 An-Nas
};

const FULLY_CENTERED_PAGES = new Set([1, 2]);

/**
 * At-Tawbah is the one surah the mushaf opens without a basmalah, so its
 * heading is a single line. Al-Fatiha's basmalah is its first ayah, which
 * means it arrives as ayah glyphs and needs no line of its own either.
 */
const NO_BASMALAH_LINE = new Set([1, 9]);

// --- wire types ------------------------------------------------------------

interface PageResponse {
  verses: Array<{
    id: number;
    verse_number: number;
    verse_key: string;
    page_number: number;
    words?: Array<{
      id: number;
      position: number;
      char_type_name: string;
      code_v1: string | null;
      line_number: number | null;
    }>;
  }>;
}

// --- domain shapes ---------------------------------------------------------

export interface MushafLine {
  page_number: number;
  line_number: number;
  line_type: "ayah" | "surah_name" | "basmalah" | "blank";
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

/** A page's glyphs, before its blank lines have been accounted for. */
interface PageGlyphs {
  page: number;
  glyphs: MushafGlyph[];
  /** Surah number of the ayah that opens each line that starts a new surah. */
  surahStartingAtLine: Map<number, number>;
}

// --- fetching --------------------------------------------------------------

export async function fetchPage(page: number): Promise<PageGlyphs> {
  const url =
    `${QURAN_API}/verses/by_page/${page}` +
    `?words=true&word_fields=code_v1,line_number&per_page=50`;
  const data = await cachedJson<PageResponse>(`page-${page}`, url);

  const glyphs: MushafGlyph[] = [];
  const surahStartingAtLine = new Map<number, number>();

  for (const verse of data.verses) {
    const [surahText, ayahText] = verse.verse_key.split(":");
    const surahNumber = Number(surahText);
    const ayahNumber = Number(ayahText);

    for (const word of verse.words ?? []) {
      if (word.line_number === null || !word.code_v1) {
        throw new Error(`page ${page}: word ${word.id} has no line or glyph`);
      }
      if (word.char_type_name !== "word" && word.char_type_name !== "end") {
        throw new Error(
          `page ${page}: word ${word.id} has unexpected char type "${word.char_type_name}"`,
        );
      }
      glyphs.push({
        id: word.id,
        verse_id: verse.id,
        page_number: page,
        line_number: word.line_number,
        position: word.position,
        glyph: word.code_v1,
        char_type: word.char_type_name,
      });

      // The banner belongs above the line the surah's first word lands on.
      if (ayahNumber === 1 && word.position === 1) {
        surahStartingAtLine.set(word.line_number, surahNumber);
      }
    }
  }

  if (glyphs.length === 0) throw new Error(`page ${page}: no glyphs returned`);
  return { page, glyphs, surahStartingAtLine };
}

// --- layout derivation -----------------------------------------------------

/** How many lines of furniture the mushaf gives a surah before its first ayah. */
function headingHeight(surah: number): number {
  // Al-Fatiha's basmalah is its own first ayah, so it arrives as ayah glyphs;
  // At-Tawbah is the one surah the mushaf opens without a basmalah at all.
  // Both therefore take a banner and nothing else.
  return NO_BASMALAH_LINE.has(surah) ? 1 : 2;
}

/**
 * Reconstructs all 9,060 lines of the mushaf from the lines glyphs occupy.
 *
 * This works over the whole book rather than a page at a time because a surah
 * heading is not obliged to fit on one page: At-Tawbah's banner sits on the
 * last line of page 186 and As-Sajdah's on the last line of page 414, in both
 * cases with the surah's text beginning overleaf.
 *
 * Headings are claimed by walking *backwards* from each surah's first ayah
 * line over contiguous empty lines, taking at most as many as that surah is
 * owed. Bounding the walk is what keeps pages 1 and 2 honest: they are typeset
 * short inside a decorative frame, and their trailing empty lines are real
 * blanks, not furniture belonging to the surah that follows.
 */
export function deriveLines(pages: readonly PageGlyphs[]): MushafLine[] {
  const totalLines = TOTAL_PAGES * LINES_PER_PAGE;
  const globalIndex = (page: number, line: number) => (page - 1) * LINES_PER_PAGE + line - 1;

  const used = new Array<boolean>(totalLines).fill(false);
  /** Global line index of each surah's first ayah line. */
  const surahStarts: Array<{ index: number; surah: number }> = [];

  for (const page of pages) {
    for (const glyph of page.glyphs) {
      used[globalIndex(page.page, glyph.line_number)] = true;
    }
    for (const [line, surah] of page.surahStartingAtLine) {
      surahStarts.push({ index: globalIndex(page.page, line), surah });
    }
  }

  const types = new Array<MushafLine["line_type"]>(totalLines).fill("blank");
  const owners = new Array<number | null>(totalLines).fill(null);
  for (let i = 0; i < totalLines; i++) if (used[i]) types[i] = "ayah";

  for (const { index, surah } of surahStarts) {
    const want = headingHeight(surah);
    // Collect the contiguous empty lines immediately above the surah's text.
    const claimed: number[] = [];
    for (let i = index - 1; i >= 0 && claimed.length < want; i--) {
      if (used[i] || owners[i] !== null) break;
      claimed.push(i);
    }
    if (claimed.length !== want) {
      throw new Error(
        `surah ${surah} starts at global line ${index} with ${claimed.length} empty ` +
          `lines above it, expected ${want}`,
      );
    }
    // `claimed` runs upwards from the text: nearest is the basmalah when the
    // surah takes one, and the line above it is the banner.
    claimed.forEach((i, distance) => {
      owners[i] = surah;
      types[i] = distance === 0 && want === 2 ? "basmalah" : "surah_name";
    });
  }

  const lines: MushafLine[] = [];
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const centered = new Set(CENTERED[page] ?? []);
    const fullyCentered = FULLY_CENTERED_PAGES.has(page);
    for (let line = 1; line <= LINES_PER_PAGE; line++) {
      const i = globalIndex(page, line);
      lines.push({
        page_number: page,
        line_number: line,
        line_type: types[i]!,
        surah_number: owners[i] ?? null,
        is_centered: fullyCentered || centered.has(line),
      });
    }
  }
  return lines;
}

/**
 * Checks the derived layout against what the printed mushaf must be true of.
 *
 * The derivation reads structure out of gaps, which would silently produce a
 * plausible-looking wrong book if the upstream line numbers ever shifted.
 * These assertions are what make that loud instead.
 */
export function verifyLayout(pages: readonly PageGlyphs[], lines: MushafLine[]): void {
  if (lines.length !== TOTAL_PAGES * LINES_PER_PAGE) {
    throw new Error(
      `derived ${lines.length} lines, expected ${TOTAL_PAGES * LINES_PER_PAGE}`,
    );
  }

  for (const page of pages) {
    for (const glyph of page.glyphs) {
      if (glyph.line_number < 1 || glyph.line_number > LINES_PER_PAGE) {
        throw new Error(`page ${page.page}: glyph ${glyph.id} is on line ${glyph.line_number}`);
      }
    }
  }

  // All 114 surahs get exactly the heading the mushaf owes them.
  for (let surah = 1; surah <= 114; surah++) {
    const heading = lines.filter((l) => l.surah_number === surah);
    const banners = heading.filter((l) => l.line_type === "surah_name").length;
    const basmalahs = heading.filter((l) => l.line_type === "basmalah").length;
    const wantBasmalah = headingHeight(surah) - 1;

    if (banners !== 1) {
      throw new Error(`surah ${surah} has ${banners} banner lines, expected 1`);
    }
    if (basmalahs !== wantBasmalah) {
      throw new Error(
        `surah ${surah} has ${basmalahs} basmalah lines, expected ${wantBasmalah}`,
      );
    }
  }

  // Blank lines are a quirk of the two framed opening pages and nowhere else.
  const strayBlanks = lines.filter((l) => l.line_type === "blank" && l.page_number > 2);
  if (strayBlanks.length > 0) {
    const first = strayBlanks[0]!;
    throw new Error(
      `${strayBlanks.length} unexplained blank lines past page 2 ` +
        `(first: page ${first.page_number} line ${first.line_number})`,
    );
  }
}

/** Every page of the mushaf, fetched and derived. */
export async function buildMushafLayout(): Promise<{
  lines: MushafLine[];
  glyphs: MushafGlyph[];
}> {
  const pages: PageGlyphs[] = [];

  // Sequential rather than concurrent: this is a one-time import against a
  // free public API, and 604 polite requests cost a couple of minutes once.
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    pages.push(await fetchPage(page));
    if (page % 50 === 0 || page === TOTAL_PAGES) {
      log("mushaf", `fetched page ${page}/${TOTAL_PAGES}`);
    }
  }

  const lines = deriveLines(pages);
  verifyLayout(pages, lines);
  return { lines, glyphs: pages.flatMap((p) => p.glyphs) };
}

/** First and last mushaf page each ruku touches, for ruku ↔ page navigation. */
export function deriveRukuPages(
  glyphs: readonly MushafGlyph[],
  verseRuku: ReadonlyMap<number, number>,
): Array<{ ruku_number: number; page_start: number; page_end: number }> {
  const pages = new Map<number, { start: number; end: number }>();

  for (const glyph of glyphs) {
    const ruku = verseRuku.get(glyph.verse_id);
    if (ruku === undefined) {
      throw new Error(`glyph ${glyph.id} belongs to verse ${glyph.verse_id}, which has no ruku`);
    }
    const span = pages.get(ruku);
    if (!span) {
      pages.set(ruku, { start: glyph.page_number, end: glyph.page_number });
    } else {
      span.start = Math.min(span.start, glyph.page_number);
      span.end = Math.max(span.end, glyph.page_number);
    }
  }

  return [...pages.entries()]
    .map(([ruku_number, span]) => ({
      ruku_number,
      page_start: span.start,
      page_end: span.end,
    }))
    .sort((a, b) => a.ruku_number - b.ruku_number);
}
