/**
 * Turns the downloaded surah pages into ayah-ranged tafsir segments.
 *
 *   pnpm tafsir:uz:parse            # every surah
 *   pnpm tafsir:uz:parse 2 18       # just these
 *
 * How the ayah anchors are found
 * ------------------------------
 * The book prints each ayah (or run of ayahs) as its own paragraph, the
 * translation prefixed with its number — "1- Алиф, Лам, Мим." or
 * "8 — Одамлардан шундайлари борки…" — and usually bold, with the commentary
 * on it following as ordinary paragraphs until the next such line. So a
 * segment is: one or more consecutive numbered lines, then everything up to
 * the next numbered line.
 *
 * A bare number-dash prefix is not enough on its own, because the commentary
 * quotes numbered lists too. Two constraints do the filtering:
 *
 *   - the number must move forward — never back to an ayah already passed,
 *     and never past the surah's ayah count;
 *   - the line is trusted more when the emphasis wraps the whole paragraph,
 *     which is how the typesetting distinguishes an ayah from prose.
 *
 * Anything accepted on the weaker signal, and every gap or overlap in the
 * result, is written to the segment's `issues` for review rather than being
 * silently patched. Nothing here guesses: it reports.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AYAH_COUNTS } from "./ayah-counts.ts";
import { blocksOf, contentSlice, readPage, type Block } from "./lib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
const OUT = join(HERE, "out");

// The number is separated from its ayah by whichever of these the typesetter
// of that surah reached for: "1- ", "8 — ", "1. ", "41. – " all occur, and a
// few surahs switch style partway through.
const SEP = String.raw`[-–—.:]\s*[-–—]?`;
/** "12-15 —": a run of ayahs shown under one heading. */
const RANGE_PREFIX = new RegExp(String.raw`^(\d{1,3})\s*[-–—]\s*(\d{1,3})\s*${SEP}\s+(?=\S)`);
/** "12 —": a single ayah. */
const SINGLE_PREFIX = new RegExp(String.raw`^(\d{1,3})\s*${SEP}\s+(?=\S)`);
/** The same, mid-paragraph: some blocks carry two or three ayahs in a row. */
const runOn = (n: number) =>
  new RegExp(String.raw`(?:^|[\s.?!»”"'])(${n})\s*${SEP}\s+(?=\S)`);

export interface Segment {
  ayah_start: number;
  ayah_end: number;
  /** Index of the block that opens this segment, for the review desk. */
  block: number;
  /** The translated ayah line(s) that opened this segment, number stripped. */
  verse: string;
  /**
   * The commentary, in the order the book prints it. Headings are kept in
   * place rather than lifted into a list of their own: in a passage that runs
   * twenty paragraphs they are how a reader finds where they are, and that
   * only works if they sit where they belong.
   */
  body: Array<{ kind: "heading" | "para"; text: string }>;
  confidence: "high" | "low";
  issues: string[];
}

/**
 * Hand corrections for one surah, written by the review tool.
 *
 * The book's own numbering carries most surahs, but a few comment on ayahs
 * without ever numbering them — there the anchors have to be placed by hand,
 * and this is where that work is kept. Corrections live beside the parser
 * rather than in its output so that re-running the parse never loses them.
 */
export interface Overrides {
  /** Blocks that open an ayah range, whatever the automatic pass thought. */
  anchors?: Array<{ block: number; start: number; end: number }>;
  /** Blocks the automatic pass wrongly read as ayah lines. */
  reject?: number[];
  notes?: string;
}

export interface ParsedSurah {
  surah: number;
  title: string;
  s_id: string;
  source_url: string;
  ayah_count: number;
  /** Text before the first numbered ayah — the book's preface to the surah. */
  intro: string[];
  segments: Segment[];
  issues: string[];
}

interface Anchor {
  index: number;
  start: number;
  end: number;
  verse: string;
  emphasised: boolean;
  /** The separator this line used, so a surah's odd one out can be spotted. */
  style: string;
  /** The number follows on from the previous ayah with no gap. */
  contiguous: boolean;
}

/**
 * The Uzbek text was translated from the Turkish edition and carries its
 * footnotes: "[12]" markers in the prose, and blocks of citations —
 * "[68] Ebu'l-Fida İsmail İbn Kesir, … Çağrı Yayınları: 3/1127-1132." —
 * dumped at the end of each part of the upload. The citations land on
 * whichever ayah happened to be last there, where they read as commentary on
 * it, and the markers point at a bibliography the reader will never see. Both
 * go. The review desk still shows them, because it works from the raw blocks.
 */
const isCitation = (text: string) => /^\[\d{1,3}\]\s/.test(text);
const withoutFootnoteMarks = (text: string) =>
  text.replace(/\s*\[\d{1,3}\]/g, "").trim();

function anchorAt(block: Block, lowest: number, ceiling: number): Anchor | null {
  const range = RANGE_PREFIX.exec(block.text);
  const single = range ? null : SINGLE_PREFIX.exec(block.text);
  const m = range ?? single;
  if (!m) return null;
  // "002. Бақара сураси" repeats the surah title inside the content; a
  // zero-padded number is a title, never an ayah.
  const first = m[1] ?? "";
  if (/^0\d/.test(first)) return null;
  const start = Number(first);
  let end = range ? Number(m[2]) : start;
  if (start < lowest || end < start || end > ceiling) return null;

  // A paragraph sometimes runs several ayahs together — "9 — … 10 — …" — so
  // keep taking the next number as long as it is the one that should follow.
  let verse = block.text.slice(m[0].length).trim();
  while (end + 1 <= ceiling) {
    const next = runOn(end + 1).exec(verse);
    if (!next) break;
    end += 1;
  }

  return {
    index: -1,
    start,
    end,
    verse,
    emphasised: block.emphasised,
    style: m[0].replace(/\d/g, "").trim(),
    contiguous: start === lowest,
  };
}

export function parseSurah(
  html: string,
  surah: number,
  title: string,
  sId: string,
  overrides: Overrides = {},
): ParsedSurah {
  const ayahCount = AYAH_COUNTS[surah] ?? 0;
  const blocks = blocksOf(contentSlice(html));

  // Some surahs were typeset entirely in <h3>. There, an h3 is a paragraph
  // like any other; where h-tags are a minority they really are section
  // titles, and worth keeping as the segment's sub-headings.
  const counts = new Map<string, number>();
  for (const b of blocks) counts.set(b.tag, (counts.get(b.tag) ?? 0) + 1);
  const isHeading = (b: Block) =>
    /^h[1-6]$/.test(b.tag) && (counts.get(b.tag) ?? 0) < blocks.length * 0.5;

  // --- pass 1: find the ayah lines ----------------------------------------
  // Every number-prefixed line is a candidate; the ayah lines are the longest
  // run of them whose numbers only ever move forward. Picking that run rather
  // than taking candidates greedily matters, because a stray number early on
  // — a heading, a footnote, a numbered list — would otherwise swallow every
  // real ayah below it. This is longest-increasing-subsequence, weighted so
  // that a line typeset like an ayah outranks one that merely starts with a
  // digit.
  const rejected = new Set(overrides.reject ?? []);
  const candidates: Anchor[] = [];
  for (const [i, block] of blocks.entries()) {
    if (rejected.has(i)) continue;
    const a = anchorAt(block, 1, ayahCount);
    if (!a) continue;
    a.index = i;
    candidates.push(a);
  }
  const anchors = applyForced(longestForwardRun(candidates), overrides.anchors ?? [], blocks);

  // --- pass 2: cut the commentary on those lines --------------------------
  const issues: string[] = [];
  const first = anchors[0];
  const intro = first
    ? blocks.slice(0, first.index).map((b) => b.text)
    : blocks.map((b) => b.text);
  if (!first) issues.push("no ayah lines found — needs manual segmentation");

  // What an ayah line looks like in *this* surah: the separator and the
  // emphasis most of them use. The book is inconsistent between surahs and
  // occasionally within one, so this is measured, never assumed.
  const house = commonest(anchors.map((a) => a.style)) ?? "—";
  const emphasisIsTheMarker =
    anchors.length > 0 && anchors.filter((a) => a.emphasised).length > anchors.length * 0.6;

  const segments: Segment[] = [];
  for (let k = 0; k < anchors.length; k++) {
    // Consecutive ayah lines belong to one segment: the book prints, say,
    // 8 and 9 back to back and then comments on both at once.
    let j = k;
    for (;;) {
      const here = anchors[j];
      const next = anchors[j + 1];
      if (!here || !next || next.index !== here.index + 1) break;
      j++;
    }
    const verses = anchors.slice(k, j + 1);
    const opener = verses[0]!;
    const last = verses[verses.length - 1]!;
    const following = anchors[j + 1];
    const body = blocks.slice(last.index + 1, following ? following.index : blocks.length);

    const segIssues: string[] = [];
    // A jump means the ayahs in between were never given their own line. The
    // commentary here is what the reader has for them, so the range stretches
    // to cover them — and says so.
    const nextStart = following ? following.start : ayahCount + 1;
    let end = last.end;
    if (nextStart > end + 1) {
      segIssues.push(`no ayah line for ${end + 1}-${nextStart - 1}; range extended over them`);
      end = nextStart - 1;
    }
    // Confidence is about whether this really is an ayah line. A number that
    // follows straight on from the previous one is about as safe as it gets.
    // Where it jumps, the page's own typesetting decides: a line that looks
    // like every other ayah line in the surah is trusted, an odd one out is
    // the shape a stray numbered list item has, so it gets flagged.
    const odd = verses.filter(
      (v) => !v.contiguous && (v.emphasised !== emphasisIsTheMarker || v.style !== house),
    );
    if (odd[0])
      segIssues.push(
        `ayah line "${odd[0].start}${odd[0].style}" is set differently from the rest of this surah` +
          " — check it is an ayah and not a numbered list item",
      );

    segments.push({
      ayah_start: opener.start,
      ayah_end: end,
      block: opener.index,
      verse: verses.map((v) => `${v.start}. ${v.verse}`).join("\n"),
      body: body
        .filter((b) => !isCitation(b.text))
        .map((b) => ({
          kind: isHeading(b) ? ("heading" as const) : ("para" as const),
          text: withoutFootnoteMarks(b.text),
        }))
        .filter((b) => b.text),
      confidence: odd.length ? "low" : "high",
      issues: segIssues,
    });
    k = j;
  }

  // --- pass 3: fold away segments with no commentary of their own ---------
  // The book sometimes prints an ayah line, then a section heading, then the
  // next ayah line — the heading introduces commentary that belongs to the
  // pair, and the first ayah is left holding a title and nothing else. Its
  // range is merged into the neighbour that does carry the commentary, so no
  // ayah ends up with a row that says nothing, and none is dropped for having
  // one.
  for (let i = segments.length - 1; i >= 0; i--) {
    const here = segments[i]!;
    if (prose(here).length > 0) continue;
    const into = segments[i + 1] ?? segments[i - 1];
    if (!into) continue;
    into.ayah_start = Math.min(into.ayah_start, here.ayah_start);
    into.ayah_end = Math.max(into.ayah_end, here.ayah_end);
    into.verse = [here.verse, into.verse].join("\n").trim();
    into.body = segments[i + 1] ? [...here.body, ...into.body] : [...into.body, ...here.body];
    into.block = Math.min(into.block, here.block);
    into.issues = [...new Set([...into.issues, ...here.issues])];
    segments.splice(i, 1);
  }

  // --- pass 4: whole-surah checks -----------------------------------------
  const opens = segments[0];
  const closes = segments[segments.length - 1];
  if (opens && closes) {
    if (opens.ayah_start !== 1) issues.push(`starts at ayah ${opens.ayah_start}, not 1`);
    if (closes.ayah_end !== ayahCount)
      issues.push(`ends at ayah ${closes.ayah_end}, surah has ${ayahCount}`);
    const empty = segments.filter((s) => prose(s).length < 200).length;
    if (empty) issues.push(`${empty} segment(s) carry almost no commentary`);
  }

  return {
    surah,
    title,
    s_id: sId,
    source_url: `https://shomila.islomiy.info/index.php?act=book&sec=81&b_id=178&s_id=${sId}`,
    ayah_count: ayahCount,
    intro,
    segments,
    issues,
  };
}

// --- driver ----------------------------------------------------------------

function sections(): Array<{ sId: string; slug: string; title: string }> {
  return readFileSync(join(HERE, "sections.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [sId = "", slug = "", title = ""] = l.split("\t");
      return { sId, slug, title };
    });
}

function main(): void {
  const only = new Set(process.argv.slice(2).map(Number).filter(Boolean));
  mkdirSync(OUT, { recursive: true });
  const report: string[] = [];
  let totalSegments = 0;
  let covered = 0;
  let flagged = 0;

  for (const s of sections()) {
    const surah = Number(s.slug);
    if (!surah || surah < 1 || surah > 114) continue;
    if (only.size && !only.has(surah)) continue;
    const file = join(RAW, `${s.slug}.html`);
    if (!existsSync(file)) {
      report.push(`${s.slug}  MISSING PAGE — run fetch.sh`);
      continue;
    }
    const overrideFile = join(HERE, "overrides", `${s.slug}.json`);
    const overrides: Overrides = existsSync(overrideFile)
      ? JSON.parse(readFileSync(overrideFile, "utf8"))
      : {};
    const parsed = parseSurah(readPage(file), surah, s.title, s.sId, overrides);
    writeFileSync(join(OUT, `${s.slug}.json`), JSON.stringify(parsed, null, 2) + "\n");

    const seen = new Set<number>();
    for (const seg of parsed.segments)
      for (let a = seg.ayah_start; a <= seg.ayah_end; a++) seen.add(a);
    const missing = [];
    for (let a = 1; a <= parsed.ayah_count; a++) if (!seen.has(a)) missing.push(a);
    const low = parsed.segments.filter((x) => x.confidence === "low").length;
    totalSegments += parsed.segments.length;
    covered += seen.size;
    flagged += low + parsed.issues.length;

    const bits = [
      `${s.slug}  ${String(parsed.segments.length).padStart(4)} seg`,
      `${String(seen.size).padStart(4)}/${String(parsed.ayah_count).padEnd(4)} ayahs`,
      low ? `${low} low-confidence` : "",
      missing.length ? `missing ${summarise(missing)}` : "",
      ...parsed.issues,
    ].filter(Boolean);
    report.push(bits.join("  |  "));
  }

  const text = report.join("\n");
  writeFileSync(join(OUT, "report.txt"), text + "\n");
  console.log(text);
  console.log(`\n${totalSegments} segments, ${covered} ayahs covered, ${flagged} things flagged`);
  console.log(`written to ${OUT}`);
}

/**
 * Hand-placed anchors win outright: anything the automatic pass found that
 * covers the same block or overlaps the same ayahs steps aside for them.
 */
function applyForced(
  auto: Anchor[],
  forced: NonNullable<Overrides["anchors"]>,
  blocks: Block[],
): Anchor[] {
  if (!forced.length) return auto;
  const kept = auto.filter(
    (a) => !forced.some((f) => f.block === a.index || (f.start <= a.end && a.start <= f.end)),
  );
  for (const f of forced) {
    const block = blocks[f.block];
    if (!block) continue;
    kept.push({
      index: f.block,
      start: f.start,
      end: Math.max(f.start, f.end),
      verse: block.text.replace(SINGLE_PREFIX, "").trim(),
      emphasised: block.emphasised,
      style: "manual",
      contiguous: true,
    });
  }
  kept.sort((a, b) => a.index - b.index);
  return kept;
}

/**
 * The best chain of candidates in document order whose ayah numbers never go
 * backwards or overlap. "Best" is the highest total weight, and weight is
 * biased towards lines that look the way ayah lines look on the page.
 */
function longestForwardRun(all: Anchor[]): Anchor[] {
  if (!all.length) return [];

  // What an ayah line looks like here has to be read off the ayah lines, not
  // off every line that starts with a digit — in Baqara the numbered lists
  // inside the commentary outnumber the ayahs, and taking the majority over
  // all candidates makes a list item the model of an ayah and the real ayah
  // lines the outliers. So: pick a chain on the weakest useful prior, learn
  // the style from the chain it gives, then pick again knowing it. Twice is
  // enough; the second chain has never disagreed with a third.
  let chain = chainBy(all, (a) => (a.emphasised ? 1.1 : 1));
  for (let round = 0; round < 2; round++) {
    const marker = chain.filter((a) => a.emphasised).length > chain.length * 0.6;
    const house = commonest(chain.map((a) => a.style)) ?? "—";
    chain = chainBy(
      all,
      (a) => 1 + (a.emphasised === marker ? 1 : 0) + (a.style === house ? 1 : 0),
    );
  }

  for (const [i, a] of chain.entries())
    a.contiguous = a.start === (i === 0 ? 1 : chain[i - 1]!.end + 1);
  return chain;
}

/** Heaviest chain of anchors, in document order, whose ayahs never overlap. */
function chainBy(all: Anchor[], weight: (a: Anchor) => number): Anchor[] {
  const best = all.map(weight);
  const from = all.map(() => -1);
  for (const [i, here] of all.entries()) {
    for (const [j, earlier] of all.slice(0, i).entries()) {
      if (earlier.end >= here.start) continue;
      const score = best[j]! + weight(here);
      if (score > best[i]!) {
        best[i] = score;
        from[i] = j;
      }
    }
  }
  let tail = 0;
  for (const [i, score] of best.entries()) if (score > best[tail]!) tail = i;
  const chain: Anchor[] = [];
  for (let i = tail; i >= 0; i = from[i]!) chain.push(all[i]!);
  return chain.reverse();
}

/** A segment's actual commentary, headings aside. */
export function prose(segment: Segment): string {
  return segment.body
    .filter((b) => b.kind === "para")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

function commonest(values: string[]): string | undefined {
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function summarise(nums: number[]): string {
  const runs: string[] = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j]! + 1) j++;
    runs.push(i === j ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
    i = j + 1;
  }
  return runs.length > 6 ? `${runs.slice(0, 6).join(",")}… (${nums.length})` : runs.join(",");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) main();
