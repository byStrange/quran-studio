/**
 * Tajweed rules, as the Tarteel Mushaf presents them.
 *
 * The rule names come from the import (`scripts/seed/tajweed.ts`); everything
 * here is presentation — the label a reader sees, what the rule asks them to
 * do, and which colour carries it. Colours live in `index.css` as `--tj-*`
 * tokens so both themes are defined in one place, and are referenced by name
 * rather than value so a span only ever needs `data-tajweed`.
 *
 * The palette follows the Tarteel Mushaf colour system, documented at
 * https://support.tarteel.ai/en/articles/14936922-understanding-tajweed-colors-in-the-tarteel-mushaf
 *
 * Madd escalates by obligation: Yellow (ṭabīʿī) → Light Orange (ʿāriḍ
 * li-sukūn) → Orange-Red (wājib muttaṣil) → Dark Red (lāzim).
 * Ghunnah = Green, Qalqalah = Light Blue, Tafkhim = Dark Blue, Silent = Grey.
 *
 * Note: Izhar, Idgham, and Ikhfa are not part of the Tarteel colour system
 * but remain in the rule set with their previous colours for visual distinction.
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

/** A rule covering `arabic_text.slice(s, e)`, as stored in `quran_verses.tajweed`. */
export interface TajweedSpan {
  r: TajweedRule;
  s: number;
  e: number;
}

export type TajweedGroup = "madd" | "ghunnah" | "qalqalah" | "tafkhim" | "silent" | "other";

/**
 * The legend's sections, in order.
 *
 * Ids only. Their titles — and every rule's label and one-line hint — are
 * translated strings and live in `locales/*`, keyed `tajweed.group.<id>` and
 * `tajweed.<rule>.label` / `.hint`. What stays here is the part that is not
 * presentation: which rules exist, and which section each belongs to.
 */
export const TAJWEED_GROUPS: readonly TajweedGroup[] = [
  "madd",
  "ghunnah",
  "qalqalah",
  "tafkhim",
  "silent",
  "other",
];

/**
 * Which section each rule belongs to.
 *
 * `tafkhim` is a section with no rule in it: the quran.com spans carry no
 * tafkhim class, but the colour is part of the Tarteel system and a reader
 * meets it in the text, so the legend shows it as a standalone swatch rather
 * than leaving a colour unexplained.
 */
const RULE_GROUP: Record<TajweedRule, TajweedGroup> = {
  madda_normal: "madd",
  madda_permissible: "madd",
  madda_obligatory: "madd",
  madda_necessary: "madd",
  ghunnah: "ghunnah",
  qalaqah: "qalqalah",
  ikhafa: "other",
  ikhafa_shafawi: "other",
  idgham_ghunnah: "other",
  idgham_wo_ghunnah: "other",
  idgham_shafawi: "other",
  idgham_mutajanisayn: "other",
  idgham_mutaqaribayn: "other",
  iqlab: "other",
  ham_wasl: "silent",
  laam_shamsiyah: "silent",
  slnt: "silent",
};

/** Rules in the order the legend lists them, grouped. */
export function rulesByGroup(group: TajweedGroup): TajweedRule[] {
  return TAJWEED_RULES.filter((rule) => RULE_GROUP[rule] === group);
}

/**
 * Splits `text` into runs, each carrying the rule that covers it (or null).
 *
 * Spans arrive ordered and non-overlapping from the importer; anything that
 * violates that — a stale row written by an older seed, say — is skipped
 * rather than allowed to reorder or duplicate the text, because the one thing
 * this must never do is render the verse wrong.
 */
export function toTajweedRuns(
  text: string,
  spans: readonly TajweedSpan[] | null | undefined,
): Array<{ text: string; rule: TajweedRule | null }> {
  if (!spans || spans.length === 0) return [{ text, rule: null }];

  const runs: Array<{ text: string; rule: TajweedRule | null }> = [];
  let cursor = 0;

  for (const span of spans) {
    if (!span || span.s < cursor || span.e <= span.s || span.e > text.length) continue;
    if (span.s > cursor) runs.push({ text: text.slice(cursor, span.s), rule: null });
    runs.push({ text: text.slice(span.s, span.e), rule: span.r });
    cursor = span.e;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), rule: null });

  return runs;
}
