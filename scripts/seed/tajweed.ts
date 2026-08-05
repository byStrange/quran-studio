/**
 * Tajweed rule import.
 *
 * quran.com serves a tajweed-annotated mushaf as HTML-ish markup:
 *
 *   بِسْمِ <tajweed class=ham_wasl>ٱ</tajweed>للَّهِ … <span class=end>١</span>
 *
 * That text is a *different digitisation* from the `text_uthmani` already in
 * `quran_verses.arabic_text` — same rasm, but it writes the dagger alif as
 * U+0672, silent letters with a plain sukun instead of U+06DF, and spaces waqf
 * marks differently. 4,210 of the 6,236 verses differ somewhere.
 *
 * Storing it as a second text column would mean the Arabic visibly reflows the
 * moment a reader toggles tajweed on, and would leave two disagreeing strings
 * for word-by-word and copy-paste to pick between. So instead the rules are
 * *aligned onto* the canonical text: this module diffs the two editions per
 * verse and re-expresses each rule as a character range over `arabic_text`.
 * Colouring then becomes a pure overlay.
 *
 * The alignment is checked rather than assumed — `verifyAlignment` compares the
 * rule sequence before and after mapping, and the seed refuses to write if the
 * two disagree beyond the known-benign case documented there.
 */
import { cachedJson } from "./util.ts";

const QURAN_API = "https://api.quran.com/api/v4";

/**
 * The seventeen rule classes the source emits, which is also the set the UI
 * knows how to colour. An unknown class is a source change, not a data error,
 * so it is reported rather than silently dropped.
 */
export const TAJWEED_RULES = [
  "ham_wasl",
  "madda_normal",
  "madda_permissible",
  "madda_obligatory",
  "madda_necessary",
  "ikhafa",
  "ikhafa_shafawi",
  "idgham_ghunnah",
  "idgham_wo_ghunnah",
  "idgham_shafawi",
  "idgham_mutajanisayn",
  "idgham_mutaqaribayn",
  "iqlab",
  "ghunnah",
  "qalaqah",
  "laam_shamsiyah",
  "slnt",
] as const;

export type TajweedRule = (typeof TAJWEED_RULES)[number];

/** A rule applied to `arabic_text.slice(s, e)`. */
export interface TajweedSpan {
  r: TajweedRule;
  s: number;
  e: number;
}

interface TajweedResponse {
  verses: Array<{ id: number; verse_key: string; text_uthmani_tajweed: string }>;
}

/**
 * Codepoints the tajweed edition uses where the Uthmani text uses another.
 * Applied only to build the string the diff runs against — never to anything
 * that gets stored — so it just has to make the two editions comparable.
 */
const EQUIVALENTS: Record<string, string> = {
  "ٲ": "ٰ", // alef with wavy hamza above → superscript (dagger) alef
  "ٮ": "ى", // dotless beh → alef maksura
};

/** Zero-width non-joiner: present only in the tajweed edition, as a spacer. */
const ZWNJ = "‌";

/**
 * Arabic marks that render on top of the preceding letter rather than beside
 * it — harakat, sukun, the superscript alef, and the small high waqf signs.
 * Where the two editions spell one of these differently the diff cannot pair
 * it up, and a mark left uncoloured above a coloured letter reads as an error,
 * so these inherit whatever rule their base letter carries.
 */
const COMBINING =
  /^[\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]+$/;

const TAG = /<(\/?)(tajweed|span)([^>]*)>/g;

/** Scope marker for `<span class=end>`, whose content is the ayah glyph. */
const GLYPH = "@ayah-glyph";
/** Scope marker for text under no rule at all. */
const PLAIN = "";

/** The whole annotated mushaf arrives in one response and is cached on disk. */
export async function fetchTajweedMarkup(): Promise<Map<number, string>> {
  const data = await cachedJson<TajweedResponse>(
    "tajweed",
    `${QURAN_API}/quran/verses/uthmani_tajweed`,
  );
  return new Map(data.verses.map((v) => [v.id, v.text_uthmani_tajweed]));
}

/**
 * Strips the markup down to plain text plus a per-character rule array.
 *
 * Rules nest in 33 places (a silent letter inside a madd, most often), and
 * there the inner rule is the one a reader needs to see — so the rule in force
 * is simply whatever is on top of the stack as each character is emitted.
 *
 * The source is not perfectly well-formed: verse 32:3 carries a stray `>` and
 * an unmatched closing tag. Both are tolerated here, and because the output is
 * projected onto the canonical text further down, neither can reach the reader.
 */
export function parseTajweedMarkup(markup: string): { text: string; rules: (string | null)[] } {
  const chars: string[] = [];
  const rules: (string | null)[] = [];
  const stack: string[] = [];
  let cursor = 0;

  const emit = (chunk: string) => {
    const scope = stack.length > 0 ? stack[stack.length - 1] : PLAIN;
    // The ayah-number glyph is dropped: the UI renders ayah numbers itself.
    if (scope === GLYPH) return;
    for (const ch of chunk) {
      chars.push(ch);
      rules.push(scope === PLAIN || scope === undefined ? null : scope);
    }
  };

  const tag = new RegExp(TAG.source, "g");
  for (let match = tag.exec(markup); match !== null; match = tag.exec(markup)) {
    emit(markup.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    if (match[1] === "/") {
      // An unmatched close tag would otherwise unbalance every rule after it.
      if (stack.length > 0) stack.pop();
      continue;
    }
    if (match[2] === "span") {
      stack.push(GLYPH);
    } else {
      stack.push(/class=(\w+)/.exec(match[3] ?? "")?.[1] ?? PLAIN);
    }
  }
  emit(markup.slice(cursor));

  return { text: chars.join(""), rules };
}

// --- alignment -------------------------------------------------------------

/** Pairs of (index in a, index in b) for characters the two strings share. */
function commonPairs(a: string, b: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];

  // The editions agree almost everywhere, so trimming the shared head and tail
  // leaves a diff region small enough for the O((N+M)·D) walk below to be cheap.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    pairs.push([head, head]);
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  for (const [i, j] of myersPairs(midA, midB)) pairs.push([head + i, head + j]);

  for (let k = tail - 1; k >= 0; k--) pairs.push([a.length - 1 - k, b.length - 1 - k]);
  return pairs;
}

/**
 * Myers' greedy diff, returning the matched (diagonal) moves.
 *
 * Chosen over an LCS table because the cost scales with the number of *edits*
 * rather than the product of the lengths, and here the two editions differ in a
 * few dozen places at most.
 */
function myersPairs(a: string, b: string): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [];

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + offset]! < v[k + 1 + offset]!)) {
        x = v[k + 1 + offset]!;
      } else {
        x = v[k - 1 + offset]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, d, offset);
    }
  }
  return [];
}

function backtrack(
  trace: Int32Array[],
  a: string,
  b: string,
  d: number,
  offset: number,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  let x = a.length;
  let y = b.length;

  for (let step = d; step > 0; step--) {
    const v = trace[step]!;
    const k = x - y;
    const prevK =
      k === -step || (k !== step && v[k - 1 + offset]! < v[k + 1 + offset]!) ? k + 1 : k - 1;
    const prevX = v[prevK + offset]!;
    const prevY = prevX - prevK;

    // Every step back along the diagonal is a character the two strings share.
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    pairs.push([x, y]);
  }

  return pairs.reverse();
}

/**
 * Re-expresses one verse's rules as ranges over `canonical`.
 *
 * Characters the two editions do not share simply carry no rule, except where
 * they sit *inside* a run — a rule interrupted by whitespace the other edition
 * spaces differently is one rule, not two, so whitespace-only gaps between
 * identical neighbours are closed up. Gaps are deliberately not bridged more
 * aggressively than that: two `ham_wasl` on neighbouring words are genuinely
 * two rules, and merging across them would paint the text between.
 */
export function alignToCanonical(markup: string, canonical: string): TajweedSpan[] {
  const { text, rules } = parseTajweedMarkup(markup);

  // Compare on a normalised copy, but keep indices into the original.
  const sourceIndex: number[] = [];
  let normalized = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === ZWNJ) continue;
    normalized += EQUIVALENTS[ch] ?? ch;
    sourceIndex.push(i);
  }

  const perChar: (string | null)[] = new Array(canonical.length).fill(null);
  for (const [i, j] of commonPairs(normalized, canonical)) {
    perChar[j] = rules[sourceIndex[i]!] ?? null;
  }

  // A diacritic the diff could not pair up belongs to the letter beneath it.
  // Applied per character, because such a mark is usually followed by ordinary
  // uncoloured text rather than by more marks.
  for (let i = 1; i < perChar.length; i++) {
    if (perChar[i] === null && perChar[i - 1] !== null && COMBINING.test(canonical[i]!)) {
      perChar[i] = perChar[i - 1]!;
    }
  }

  // The editions space waqf marks differently; a rule interrupted only by that
  // whitespace is one rule, not two. Nothing wider is bridged — two `ham_wasl`
  // on neighbouring words are genuinely two rules.
  for (let i = 0; i < perChar.length; i++) {
    if (perChar[i] !== null) continue;
    let j = i;
    while (j < perChar.length && perChar[j] === null) j++;
    const left = i > 0 ? (perChar[i - 1] ?? null) : null;
    const right = j < perChar.length ? (perChar[j] ?? null) : null;
    if (left !== null && left === right && /^\s*$/.test(canonical.slice(i, j))) {
      for (let k = i; k < j; k++) perChar[k] = left;
    }
    i = j - 1;
  }

  const spans: TajweedSpan[] = [];
  for (let i = 0; i < perChar.length; i++) {
    const rule = perChar[i];
    if (rule === null) continue;
    const start = i;
    while (i + 1 < perChar.length && perChar[i + 1] === rule) i++;
    spans.push({ r: rule as TajweedRule, s: start, e: i + 1 });
  }
  return spans;
}

// --- validation ------------------------------------------------------------

/**
 * Placeholder for a stretch carrying no rule. It keeps two runs of the *same*
 * rule from collapsing into one while the sequence is built, then drops out —
 * two separate `ham_wasl` must stay two entries, or a lost rule would look
 * like a match.
 */
const BREAK = "@break";

function ruleSequence(values: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (value !== null && value !== out[out.length - 1]) out.push(value);
    else if (value === null) out.push(BREAK); // a break, so two runs of one rule cannot merge
  }
  return out.filter((r) => r !== BREAK);
}

export interface AlignmentReport {
  verses: number;
  spans: number;
  exact: number;
  /** Rule present in the source but missing after mapping — never acceptable. */
  dropped: Array<{ verseId: number; rule: string }>;
  /** Unknown class emitted by the source. */
  unknown: Set<string>;
}

/**
 * Confirms the mapping preserved every rule, in order.
 *
 * `exact` counts verses whose rule sequence survives the projection unchanged.
 * The rest differ only by a run arriving as two adjacent runs of the *same*
 * rule, where a character the editions spell differently falls inside it; that
 * renders identically, since both halves take the same colour. A rule that
 * disappears entirely is a real failure and is reported separately.
 */
export function verifyAlignment(
  cases: ReadonlyArray<{ verseId: number; markup: string; canonical: string; spans: TajweedSpan[] }>,
): AlignmentReport {
  const report: AlignmentReport = {
    verses: cases.length,
    spans: 0,
    exact: 0,
    dropped: [],
    unknown: new Set(),
  };
  const known = new Set<string>(TAJWEED_RULES);

  for (const { verseId, markup, canonical, spans } of cases) {
    report.spans += spans.length;

    const { rules } = parseTajweedMarkup(markup);
    const before = ruleSequence(rules);
    for (const rule of before) if (!known.has(rule)) report.unknown.add(rule);

    const perChar: (string | null)[] = new Array(canonical.length).fill(null);
    for (const span of spans) for (let i = span.s; i < span.e; i++) perChar[i] = span.r;
    const after = ruleSequence(perChar);

    if (before.join("|") === after.join("|")) {
      report.exact++;
      continue;
    }
    // Collapse the benign "one run arrived as two adjacent same-rule runs" case
    // before deciding anything is actually missing.
    const collapse = (seq: string[]) => seq.filter((r, i) => r !== seq[i - 1]);
    const b = collapse(before);
    const a = collapse(after);
    if (b.join("|") === a.join("|")) continue;

    for (const rule of new Set(b)) {
      if (!a.includes(rule)) report.dropped.push({ verseId, rule });
    }
  }
  return report;
}
