/**
 * Turning a list of flagged ayahs into practice passages.
 *
 * A mistake is rarely about the ayah alone — it is usually the join: not
 * knowing how an ayah begins after the one before it, or losing the thread a
 * line later. So each flagged ayah is practised inside a window: a few ayahs
 * before it to lead in, the ayah itself, and a few after it to show it was
 * carried through. Flagged ayahs whose windows touch become one passage, so
 * 2:5 and 2:7 are recited together once rather than overlapping twice.
 */

export interface FlaggedAyah {
  id: number;
  surah_number: number;
  ayah_number: number;
}

export interface Passage<T extends FlaggedAyah = FlaggedAyah> {
  /** Stable for a given surah and set of flagged ayahs. */
  key: string;
  surah: number;
  /** First and last ayah shown, lead-in and follow-on included. */
  start: number;
  end: number;
  /** The flagged ayahs inside it, in order. */
  flagged: T[];
}

export interface PassageOptions {
  /** Ayahs shown before the first flagged one. */
  before: number;
  /** Ayahs shown after the last flagged one. */
  after: number;
}

/**
 * Groups flagged ayahs into passages, in Quran order.
 *
 * `ayahCounts` bounds each window to its surah: a lead-in never reaches back
 * into the previous surah, where the reciter would not be coming from.
 */
export function buildPassages<T extends FlaggedAyah>(
  flagged: readonly T[],
  ayahCounts: ReadonlyMap<number, number>,
  { before, after }: PassageOptions,
): Passage<T>[] {
  const sorted = [...flagged].sort(
    (a, b) => a.surah_number - b.surah_number || a.ayah_number - b.ayah_number,
  );
  const passages: Passage<T>[] = [];
  let current: Passage<T> | null = null;

  for (const ayah of sorted) {
    const last = ayahCounts.get(ayah.surah_number) ?? ayah.ayah_number;
    const start = Math.max(1, ayah.ayah_number - before);
    const end = Math.min(last, ayah.ayah_number + after);
    // Joined when this window starts no later than one past where the
    // current one ends: overlapping or directly continuing.
    if (current && current.surah === ayah.surah_number && start <= current.end + 1) {
      current.end = Math.max(current.end, end);
      current.flagged.push(ayah);
      continue;
    }
    current = { key: "", surah: ayah.surah_number, start, end, flagged: [ayah] };
    passages.push(current);
  }

  for (const passage of passages) {
    passage.key = `${passage.surah}:${passage.flagged.map((a) => a.ayah_number).join(",")}`;
  }
  return passages;
}

/**
 * Splits an ayah into the words a hint reveals one at a time.
 *
 * Whitespace is the word boundary in the Uthmani text; standalone pause and
 * sajdah marks are folded into the word before them, so a hint never spends a
 * tap revealing a symbol nobody recites.
 */
export function hintWords(arabic: string): string[] {
  const words: string[] = [];
  for (const token of arabic.split(/\s+/).filter(Boolean)) {
    const isMark = /^[ۖ-ۭؕ-ؚ۞۩]+$/u.test(token);
    if (isMark && words.length > 0) words[words.length - 1] += ` ${token}`;
    else words.push(token);
  }
  return words;
}
