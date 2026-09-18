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

export interface TajweedRuleInfo {
  label: string;
  /** What the rule asks the reciter to do, in one line. */
  hint: string;
  group: TajweedGroup;
}

export const TAJWEED_GROUPS: Array<{ id: TajweedGroup; title: string }> = [
  { id: "madd", title: "Prolongation (Madd)" },
  { id: "ghunnah", title: "Nasalization (Ghunnah)" },
  { id: "qalqalah", title: "Echoing Sound (Qalqalah)" },
  { id: "tafkhim", title: "Emphatic Pronunciation (Tafkhim)" },
  { id: "silent", title: "Silent Letters" },
  { id: "other", title: "Other Rules" },
];

export const TAJWEED_INFO: Record<TajweedRule, TajweedRuleInfo> = {
  madda_normal: {
    label: "Madd Ṭabīʿī",
    hint: "Normal prolongation — hold for 2 vowel counts.",
    group: "madd",
  },
  madda_permissible: {
    label: "Madd ʿĀriḍ li-Sukūn",
    hint: "Permissible prolongation — 2, 4, or 6 counts when pausing at end of verse.",
    group: "madd",
  },
  madda_obligatory: {
    label: "Madd Wājib Muttaṣil",
    hint: "Obligatory prolongation — 4 to 5 counts; Madd letter followed by Hamzah in same word.",
    group: "madd",
  },
  madda_necessary: {
    label: "Madd Lāzim",
    hint: "Necessary prolongation — must hold for 6 vowel counts.",
    group: "madd",
  },
  ghunnah: {
    label: "Ghunnah",
    hint: "Nasalization from the nose lasting 2 vowel counts — on ن and م.",
    group: "ghunnah",
  },
  qalaqah: {
    label: "Qalqalah",
    hint: "Echoing bounce on ق ط ب ج د when carrying sukūn; especially audible when stopping.",
    group: "qalqalah",
  },
  ikhafa: {
    label: "Ikhfāʾ",
    hint: "Nūn sākinah or tanwīn hidden before certain letters, with nasalisation.",
    group: "other",
  },
  ikhafa_shafawi: {
    label: "Ikhfāʾ shafawī",
    hint: "Mīm sākinah hidden before bāʾ.",
    group: "other",
  },
  idgham_ghunnah: {
    label: "Idghām with ghunnah",
    hint: "Merged into the next letter, nasalised.",
    group: "other",
  },
  idgham_wo_ghunnah: {
    label: "Idghām without ghunnah",
    hint: "Merged into the next letter, no nasalisation.",
    group: "other",
  },
  idgham_shafawi: {
    label: "Idghām shafawī",
    hint: "Mīm sākinah merged into a following mīm.",
    group: "other",
  },
  idgham_mutajanisayn: {
    label: "Idghām mutajānisayn",
    hint: "Merged between letters sharing a point of articulation.",
    group: "other",
  },
  idgham_mutaqaribayn: {
    label: "Idghām mutaqāribayn",
    hint: "Merged between letters with close points of articulation.",
    group: "other",
  },
  iqlab: {
    label: "Iqlāb",
    hint: "Nūn or tanwīn becomes a mīm sound before bāʾ.",
    group: "other",
  },
  ham_wasl: {
    label: "Hamzat al-waṣl",
    hint: "Connecting hamza — written but silent when joined to the preceding word.",
    group: "silent",
  },
  laam_shamsiyah: {
    label: "Lām shamsiyyah",
    hint: "Silent lām; the following letter doubles.",
    group: "silent",
  },
  slnt: {
    label: "Silent",
    hint: "Written but not pronounced during recitation.",
    group: "silent",
  },
};

/** Rules in the order the legend lists them, grouped. */
export function rulesByGroup(group: TajweedGroup): TajweedRule[] {
  return TAJWEED_RULES.filter((rule) => TAJWEED_INFO[rule].group === group);
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
