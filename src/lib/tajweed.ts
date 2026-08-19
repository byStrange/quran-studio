/**
 * Tajweed rules, as the reader presents them.
 *
 * The rule names come from the import (`scripts/seed/tajweed.ts`); everything
 * here is presentation — the label a reader sees, what the rule asks them to
 * do, and which colour carries it. Colours live in `index.css` as `--tj-*`
 * tokens so both themes are defined in one place, and are referenced by name
 * rather than value so a span only ever needs `data-tajweed`.
 *
 * The palette is the standard tajweed one, matched hex for hex in light mode
 * (#537FFF madd ṭabīʿī, #FF7E1E ghunnah, #DD0008 qalqalah, #9400A8 ikhfāʾ,
 * #169200 idghām, #AAAAAA silent, …) — the same values every implementation of
 * these rule classes ships, including the quran.com source the spans come
 * from. It is deliberately not a house palette: readers arrive having learnt
 * these colours from a printed mushaf, so a "nicer" green is just a wrong one.
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

export type TajweedGroup = "madd" | "nun" | "meem" | "other";

export interface TajweedRuleInfo {
  label: string;
  /** What the rule asks the reciter to do, in one line. */
  hint: string;
  group: TajweedGroup;
}

export const TAJWEED_GROUPS: Array<{ id: TajweedGroup; title: string }> = [
  { id: "madd", title: "Prolongation" },
  { id: "nun", title: "Nūn sākinah & tanwīn" },
  { id: "meem", title: "Mīm sākinah" },
  { id: "other", title: "Other" },
];

export const TAJWEED_INFO: Record<TajweedRule, TajweedRuleInfo> = {
  madda_normal: {
    label: "Madd ṭabīʿī",
    hint: "Natural prolongation — hold for 2 counts.",
    group: "madd",
  },
  madda_permissible: {
    label: "Madd munfaṣil",
    hint: "Permissible prolongation — 2, 4 or 5 counts.",
    group: "madd",
  },
  madda_obligatory: {
    label: "Madd muttaṣil",
    hint: "Obligatory prolongation — 4 or 5 counts.",
    group: "madd",
  },
  madda_necessary: {
    label: "Madd lāzim",
    hint: "Necessary prolongation — hold for 6 counts.",
    group: "madd",
  },
  ikhafa: {
    label: "Ikhfāʾ",
    hint: "Nūn sākinah or tanwīn hidden, with nasalisation.",
    group: "nun",
  },
  idgham_ghunnah: {
    label: "Idghām with ghunnah",
    hint: "Merged into the next letter, nasalised.",
    group: "nun",
  },
  idgham_wo_ghunnah: {
    label: "Idghām without ghunnah",
    hint: "Merged into the next letter, no nasalisation.",
    group: "nun",
  },
  iqlab: {
    label: "Iqlāb",
    hint: "Nūn or tanwīn becomes a mīm sound before bāʾ.",
    group: "nun",
  },
  ikhafa_shafawi: {
    label: "Ikhfāʾ shafawī",
    hint: "Mīm sākinah hidden before bāʾ.",
    group: "meem",
  },
  idgham_shafawi: {
    label: "Idghām shafawī",
    hint: "Mīm sākinah merged into a following mīm.",
    group: "meem",
  },
  ghunnah: {
    label: "Ghunnah",
    hint: "Nasalisation held for 2 counts.",
    group: "other",
  },
  qalaqah: {
    label: "Qalqalah",
    hint: "Echoing bounce on a letter carrying sukūn.",
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
  ham_wasl: {
    label: "Hamzat al-waṣl",
    hint: "Connecting hamza — silent when joined to the word before.",
    group: "other",
  },
  laam_shamsiyah: {
    label: "Lām shamsiyyah",
    hint: "Silent lām; the letter after it doubles.",
    group: "other",
  },
  slnt: {
    label: "Silent",
    hint: "Written but not pronounced.",
    group: "other",
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
