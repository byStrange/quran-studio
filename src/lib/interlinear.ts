/**
 * Locating each word of a verse inside its `arabic_text`.
 *
 * The interlinear reader prints every word over its own gloss, but the words
 * have to come out of `arabic_text` rather than `quran_words.arabic`: that is
 * the string the tajweed spans are ranges over, and the two are not identical
 * — the word list writes some tanween with an extra small meem (U+06ED) and
 * carries waqf marks the verse text spaces differently. Cutting the verse at
 * its own word boundaries keeps the interlinear Arabic the same text the
 * plain line shows, colouring included.
 */

/** Any Arabic letter. A whitespace-separated token without one is a mark. */
const LETTER = /[ء-غف-يٱ-ۓە]/;

/**
 * Splits `text` into `count` word ranges, or returns null if the verse does
 * not divide into that many words.
 *
 * Tokens with no letter — waqf signs (ۚ ۖ ۛ), the rub el hizb (۞) — are not
 * words of their own: a trailing mark belongs to the word before it, and one
 * that opens the verse to the word after. Null is a real outcome (a handful
 * of verses split differently in the word list than in the text), and the
 * caller falls back to the word list's own spelling for those.
 */
export function splitVerseWords(
  text: string,
  count: number,
): Array<{ start: number; end: number }> | null {
  const ranges: Array<{ start: number; end: number }> = [];
  let pendingStart: number | null = null;

  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const previous = ranges.at(-1);
    if (LETTER.test(match[0])) {
      ranges.push({ start: pendingStart ?? start, end });
      pendingStart = null;
    } else if (previous) {
      previous.end = end;
    } else {
      pendingStart ??= start;
    }
  }

  return ranges.length === count ? ranges : null;
}
