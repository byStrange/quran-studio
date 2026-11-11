/**
 * Journey — the lesson planner.
 *
 * The study reader assumes someone who will sit with a ruku and its tafsir.
 * Journey is for a younger reader who already recites, and should come to know
 * what the words in their mouth mean: a surah is cut into short *stops*, and a
 * stop is played as a handful of *scenes* — hear it with the meaning arriving
 * word by word, meet the words, play with them, then recite it yourself.
 *
 * Everything in this file is pure: verses in, a plan out, with the randomness
 * drawn from a seeded generator. That is what lets `scripts/test/journey.ts`
 * check the planner without a database, and what makes a lesson stable across
 * re-renders (a reshuffle on every render would move the tiles under a
 * finger).
 */
import type { TajweedSpan } from "@/lib/tajweed";

// --- content, as a scene sees it -------------------------------------------

export interface JourneyWord {
  /** `quran_words.id`. */
  id: number;
  /** `quran_words.position`, which is what the recitation timings key on. */
  position: number;
  /** The word as the word list spells it — what comparisons are made on. */
  arabic: string;
  /**
   * The word as it stands in the ayah's own text, which is what is drawn: the
   * tajweed spans are ranges over that text, not over the word list's
   * spelling (see `lib/interlinear.ts`).
   */
  text: string;
  /** Tajweed spans relative to `text`; null when they cannot be placed. */
  tajweed: TajweedSpan[] | null;
  transliteration: string | null;
  /**
   * The gloss in the reader's language, or null when the corpus has none.
   * A word without a meaning is still shown and still recited; it is only
   * left out of the games, which have nothing to ask about it.
   */
  meaning: string | null;
}

export interface JourneyVerse {
  /** `quran_verses.id`. */
  id: number;
  surah: number;
  ayah: number;
  ruku: number;
  arabic: string;
  tajweed: TajweedSpan[] | null;
  translation: string;
  /** BCP-47 tag of `translation`, for the rendered text's `lang`. */
  translationTag: string;
  words: JourneyWord[];
}

/** A few consecutive ayahs of one surah: one sitting's worth. */
export interface Stop {
  surah: number;
  /** Position among the surah's stops, from 0. */
  index: number;
  ayahStart: number;
  ayahEnd: number;
  verses: JourneyVerse[];
}

// --- stops -----------------------------------------------------------------

/**
 * How much a stop holds.
 *
 * Sized by words rather than ayahs because ayahs are not a unit of effort:
 * Al-Ikhlas is four ayahs and fifteen words, while a single ayah of
 * Al-Baqarah can be a page. Around two dozen words is what the scenes can
 * teach in one sitting without the word games turning into a list.
 */
export const STOP_WORD_BUDGET = 24;
export const STOP_MAX_AYAHS = 4;
/** A closing stop this small is folded into the one before it. */
const TAIL_WORDS = 7;
const TAIL_ABSORB_WORDS = STOP_WORD_BUDGET + TAIL_WORDS;

/**
 * Cuts a surah into stops.
 *
 * An ayah is never split — it is a unit of recitation, and a lesson that ended
 * mid-ayah would teach a pause the reciter must not make. An ayah longer than
 * the budget therefore becomes a stop of its own.
 */
export function planStops(verses: readonly JourneyVerse[]): Stop[] {
  const groups: JourneyVerse[][] = [];
  let current: JourneyVerse[] = [];
  let words = 0;

  for (const verse of verses) {
    const size = verse.words.length;
    const full =
      current.length >= STOP_MAX_AYAHS || (current.length > 0 && words + size > STOP_WORD_BUDGET);
    if (full) {
      groups.push(current);
      current = [];
      words = 0;
    }
    current.push(verse);
    words += size;
  }
  if (current.length > 0) groups.push(current);

  // One short ayah left dangling at the end of a surah is not a lesson.
  if (groups.length >= 2) {
    const tail = groups[groups.length - 1]!;
    const before = groups[groups.length - 2]!;
    const tailWords = countWords(tail);
    if (
      tail.length === 1 &&
      tailWords <= TAIL_WORDS &&
      countWords(before) + tailWords <= TAIL_ABSORB_WORDS
    ) {
      before.push(...tail);
      groups.pop();
    }
  }

  return groups.map((group, index) => ({
    surah: group[0]!.surah,
    index,
    ayahStart: group[0]!.ayah,
    ayahEnd: group[group.length - 1]!.ayah,
    verses: group,
  }));
}

function countWords(verses: readonly JourneyVerse[]): number {
  return verses.reduce((sum, verse) => sum + verse.words.length, 0);
}

/**
 * What a stop is called in stored progress.
 *
 * Keyed by where the stop starts rather than by its index: if the budget above
 * is ever retuned the indexes shift, but most stops still begin on the same
 * ayah, so stars already earned stay attached to the right passage.
 */
export function stopKey(stop: Pick<Stop, "surah" | "ayahStart">): string {
  return `${stop.surah}:${stop.ayahStart}`;
}

// --- randomness ------------------------------------------------------------

export type Rng = () => number;

/** mulberry32: small, fast, and good enough to shuffle tiles. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * A shuffle that is never the original order (when another order exists).
 * "Put these in order" must not arrive already in order.
 */
export function scrambled<T>(items: readonly T[], rng: Rng): T[] {
  if (items.length < 2) return [...items];
  for (let attempt = 0; attempt < 8; attempt++) {
    const out = shuffled(items, rng);
    if (out.some((item, index) => item !== items[index])) return out;
  }
  return [...items.slice(1), items[0]!];
}

// --- scenes ----------------------------------------------------------------

/** One word together with the ayah it is recited in. */
export interface WordRef {
  verseId: number;
  wordId: number;
}

export type Scene =
  /** The reciter recites; each word lights up and its meaning arrives with it. */
  | { kind: "listen" }
  /** Turn over each new word to find what it means. */
  | { kind: "meet"; words: WordRef[] }
  /** Pair each Arabic word with its meaning. */
  | { kind: "match"; words: WordRef[] }
  /** Hear one word; pick which word it was. */
  | { kind: "hear"; rounds: Array<{ answer: WordRef; choices: WordRef[] }> }
  /** Lay the meanings under an ayah's words, in the order they are recited. */
  | { kind: "build"; verseId: number; chips: WordRef[] }
  /** Read a meaning; pick the ayah that says it. */
  | { kind: "which"; rounds: Array<{ verseId: number; choiceVerseIds: number[] }> }
  /** Put the stop's ayahs back in order. */
  | { kind: "order"; verseIds: number[] }
  /**
   * What the passage teaches, drawn from the tafsir: a few points revealed one
   * at a time, then questions about them. Carries no content — the scene
   * fetches it — because it is written by the AI from the tafsir and may not
   * exist yet when the lesson is planned.
   */
  | { kind: "understand" }
  /** The reader recites; the meaning follows their own pace. */
  | { kind: "recite" };

export type SceneKind = Scene["kind"];

/** How many words one meet/match pair of scenes introduces. */
export const WORDS_PER_GROUP = 5;
/** How many such groups a stop has at most; the rest are met by ear only. */
const MAX_GROUPS = 2;
const HEAR_ROUNDS = 4;
const HEAR_CHOICES = 3;
const WHICH_ROUNDS = 3;
const WHICH_CHOICES = 3;
/** An ayah whose meaning is laid out word by word has this many words. */
const BUILD_MIN_WORDS = 3;
const BUILD_MAX_WORDS = 8;
/** Ayahs longer than this make poor multiple-choice tiles. */
const CHOICE_MAX_WORDS = 14;

/**
 * Letters only: no harakat, no Quranic annotation marks, no tatweel.
 *
 * Two spellings of one word — "ٱللَّهُ" and "ٱللَّهِ" — are the same word to a
 * learner, and offering both as different answers to "which word did you
 * hear?" would be a trick question.
 */
export function bareArabic(text: string): string {
  return text.replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ\s]/g, "");
}

function normalizeMeaning(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The words of a stop worth teaching, each once, in recitation order.
 *
 * "Once" is by letters and by meaning both: a matching game cannot hold two
 * tiles that read the same, on either side.
 */
export function teachableWords(stop: Stop): WordRef[] {
  const seenArabic = new Set<string>();
  const seenMeaning = new Set<string>();
  const out: WordRef[] = [];
  for (const verse of stop.verses) {
    for (const word of verse.words) {
      if (!word.meaning) continue;
      const arabic = bareArabic(word.arabic);
      const meaning = normalizeMeaning(word.meaning);
      if (!arabic || !meaning || seenArabic.has(arabic) || seenMeaning.has(meaning)) continue;
      seenArabic.add(arabic);
      seenMeaning.add(meaning);
      out.push({ verseId: verse.id, wordId: word.id });
    }
  }
  return out;
}

/**
 * Splits the teachable words into groups of about `WORDS_PER_GROUP`.
 *
 * Evenly rather than greedily — seven words are a four and a three, not a five
 * and a pair, because matching two tiles is not a game.
 */
function wordGroups(words: readonly WordRef[]): WordRef[][] {
  const taught = words.slice(0, WORDS_PER_GROUP * MAX_GROUPS);
  if (taught.length === 0) return [];
  const count = Math.ceil(taught.length / WORDS_PER_GROUP);
  const groups: WordRef[][] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    const size = Math.ceil((taught.length - at) / (count - i));
    groups.push(taught.slice(at, at + size));
    at += size;
  }
  return groups;
}

function pick<T>(items: readonly T[], count: number, rng: Rng): T[] {
  return shuffled(items, rng).slice(0, count);
}

/**
 * The scenes of one stop, in the order they are played.
 *
 * The arc is always the same — hear it, meet its words, play with them, think
 * about whole ayahs, recite it — and the middle grows or shrinks with what the
 * stop holds. A scene that the passage cannot support (ordering a single ayah,
 * matching one word) is left out rather than played hollow.
 *
 * `surah` is the whole surah, which is where "which ayah says this?" finds
 * wrong answers once the stop's own ayahs run out.
 */
export function planLesson(
  stop: Stop,
  surah: readonly JourneyVerse[],
  rng: Rng,
  options: { tafsir?: boolean } = {},
): Scene[] {
  const scenes: Scene[] = [{ kind: "listen" }];
  const teachable = teachableWords(stop);
  const groups = wordGroups(teachable);

  for (const group of groups) {
    scenes.push({ kind: "meet", words: group });
    if (group.length >= 3) scenes.push({ kind: "match", words: shuffled(group, rng) });
  }

  const taught = groups.flat();
  if (taught.length >= HEAR_CHOICES) {
    const answers = pick(taught, HEAR_ROUNDS, rng);
    scenes.push({
      kind: "hear",
      rounds: answers.map((answer) => ({
        answer,
        choices: shuffled(
          [answer, ...pick(taught.filter((w) => w.wordId !== answer.wordId), HEAR_CHOICES - 1, rng)],
          rng,
        ),
      })),
    });
  }

  const build = planBuild(stop, rng);
  if (build) scenes.push(build);

  const which = planWhich(stop, surah, rng);
  if (which) scenes.push(which);

  if (stop.verses.length >= 3) {
    scenes.push({ kind: "order", verseIds: scrambled(stop.verses.map((v) => v.id), rng) });
  }

  // After the words and the ayahs, and before reciting: the recital that ends
  // the lesson should be the first one made knowing what the passage is about.
  if (options.tafsir) scenes.push({ kind: "understand" });

  scenes.push({ kind: "recite" });
  return scenes;
}

/**
 * The ayah whose meaning is assembled word by word.
 *
 * It needs every word glossed (an empty slot nothing can fill is a dead end)
 * and enough words to be a sentence without being a wall of chips.
 */
function planBuild(stop: Stop, rng: Rng): Scene | null {
  const suitable = stop.verses.filter(
    (verse) =>
      verse.words.length >= BUILD_MIN_WORDS &&
      verse.words.length <= BUILD_MAX_WORDS &&
      verse.words.every((word) => word.meaning),
  );
  if (suitable.length === 0) return null;
  const verse = suitable[Math.floor(rng() * suitable.length)]!;
  const chips = verse.words.map((word) => ({ verseId: verse.id, wordId: word.id }));
  return { kind: "build", verseId: verse.id, chips: scrambled(chips, rng) };
}

function planWhich(stop: Stop, surah: readonly JourneyVerse[], rng: Rng): Scene | null {
  const fits = (verse: JourneyVerse) =>
    verse.words.length <= CHOICE_MAX_WORDS && verse.translation.trim().length > 0;
  const askable = stop.verses.filter(fits);
  if (askable.length === 0) return null;

  // Two ayahs with the same wording (a refrain) cannot be told apart by their
  // meaning, so only one of each wording is ever offered together.
  const wording = (verse: JourneyVerse) => bareArabic(verse.arabic);
  const inStop = new Set(stop.verses.map((v) => v.id));
  const nearby = surah.filter((verse) => fits(verse) && !inStop.has(verse.id));

  const rounds: Array<{ verseId: number; choiceVerseIds: number[] }> = [];
  for (const verse of pick(askable, WHICH_ROUNDS, rng)) {
    const taken = new Set([wording(verse)]);
    const wrong: JourneyVerse[] = [];
    // The stop's own ayahs first — the ones just studied are the ones worth
    // telling apart — then the rest of the surah, nearest first.
    const candidates = [
      ...shuffled(askable.filter((v) => v.id !== verse.id), rng),
      ...[...nearby].sort(
        (a, b) => Math.abs(a.ayah - verse.ayah) - Math.abs(b.ayah - verse.ayah),
      ),
    ];
    for (const candidate of candidates) {
      if (wrong.length >= WHICH_CHOICES - 1) break;
      if (taken.has(wording(candidate))) continue;
      taken.add(wording(candidate));
      wrong.push(candidate);
    }
    if (wrong.length === 0) continue;
    rounds.push({
      verseId: verse.id,
      choiceVerseIds: shuffled([verse, ...wrong], rng).map((v) => v.id),
    });
  }
  return rounds.length > 0 ? { kind: "which", rounds } : null;
}

// --- lookups ---------------------------------------------------------------

/** Resolves the ids a scene carries back into the verses and words to draw. */
export interface JourneyIndex {
  verse: (verseId: number) => JourneyVerse | undefined;
  word: (ref: WordRef) => JourneyWord | undefined;
}

export function indexVerses(verses: readonly JourneyVerse[]): JourneyIndex {
  const byId = new Map(verses.map((verse) => [verse.id, verse]));
  return {
    verse: (verseId) => byId.get(verseId),
    word: (ref) => byId.get(ref.verseId)?.words.find((word) => word.id === ref.wordId),
  };
}

// --- scoring ---------------------------------------------------------------

export type Stars = 1 | 2 | 3;

/**
 * Stars for a finished stop.
 *
 * Finishing always earns one: the point is that the passage was heard, played
 * through and recited, and a child who needed many tries still did all of
 * that. The other two are for doing it cleanly, which is the reason to come
 * back to a stop.
 */
export function starsFor(mistakes: number): Stars {
  if (mistakes <= 1) return 3;
  if (mistakes <= 4) return 2;
  return 1;
}
