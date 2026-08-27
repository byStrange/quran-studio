/**
 * Local Quran text matcher for the Listen & Follow feature.
 *
 * Takes imperfect Arabic text from speech recognition and identifies which
 * verse the user is reciting. Works entirely offline — the Quran is a closed
 * corpus of 6,236 verses, so even mediocre ASR accuracy is sufficient when
 * paired with good matching.
 *
 * Two-phase algorithm:
 *   1. **Discovery** (SEARCHING): n-gram inverted index over all verses.
 *      Three recognized words are usually enough to narrow to 1–3 candidates.
 *   2. **Tracking** (FOLLOWING): constrained edit-distance matching against
 *      a sliding window of the current and next ayah's words. Advances the
 *      cursor as the reciter progresses and handles backward jumps (reciters
 *      often repeat a phrase after a breath).
 *
 * All comparison is done on normalized Arabic — diacritics stripped, letter
 * variants unified — because ASR almost never gets tashkeel right, and the
 * consonantal skeleton is what distinguishes one verse from another.
 */

// ---------------------------------------------------------------------------
// Arabic normalization
// ---------------------------------------------------------------------------

/**
 * Unicode ranges and characters stripped or replaced during normalization.
 *
 * The goal is a consonantal skeleton: two strings that a human ear would
 * recognise as the same words should normalise to the same characters,
 * regardless of whether the source is Uthmani script with full tashkeel or
 * noisy ASR output with partial or missing diacritics.
 */

/** Tashkeel / harakat: fathatan (0x064B) through sukun (0x0652). */
const TASHKEEL_RE = /[\u064B-\u0652]/g;

/**
 * Extended Arabic diacritics used in Quranic orthography:
 * superscript alef (0x0670), small high seen/rounded zero/etc (0x06D6–0x06ED),
 * and the tatweel (kashida, 0x0640) which some ASR engines insert.
 */
const QURAN_MARKS_RE = /[\u0640\u0670\u06D6-\u06ED]/g;


/**
 * Normalise a piece of Arabic text to its consonantal skeleton.
 *
 * Idempotent — normalising an already-normalised string returns it unchanged.
 */
export function normalizeArabic(text: string): string {
  return (
    text
      // Strip all tashkeel (short vowels, shadda, sukun).
      .replace(TASHKEEL_RE, "")
      // Strip Quranic ornamental marks and tatweel.
      .replace(QURAN_MARKS_RE, "")
      // Alef variants → bare alef.
      .replace(/[إأآٱ]/g, "ا")
      // Taa marbuta → haa (they sound identical at a pause).
      .replace(/ة/g, "ه")
      // Alef maksura → yaa.
      .replace(/ى/g, "ي")
      // Hamza carriers → standalone hamza.
      .replace(/[ؤئ]/g, "ء")
      // Collapse whitespace.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Split normalised Arabic into words, filtering out empty tokens that
 * appear when the source has leading/trailing/double spaces.
 */
function splitWords(normalized: string): string[] {
  return normalized.split(" ").filter((w) => w.length > 0);
}

// ---------------------------------------------------------------------------
// N-gram inverted index
// ---------------------------------------------------------------------------

/**
 * Build an inverted index of word n-grams → verse indices.
 *
 * The key is a string of `n` consecutive normalised words joined by a space.
 * The value is the set of verse *array indices* (not database IDs) whose
 * normalised text contains that n-gram. Using array indices keeps the lookup
 * inside the matcher fast and avoids a second Map from ID → index.
 *
 * Memory: ~77,430 words across 6,236 verses. With n=2 and n=3 this produces
 * roughly 140k entries at ~2–4 MB, small enough to hold permanently.
 */
function buildNgramIndex(
  versesNorm: string[][],
  n: number,
): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (let vi = 0; vi < versesNorm.length; vi++) {
    const words = versesNorm[vi]!;
    for (let wi = 0; wi <= words.length - n; wi++) {
      const gram = words.slice(wi, wi + n).join(" ");
      let set = index.get(gram);
      if (!set) {
        set = new Set();
        index.set(gram, set);
      }
      set.add(vi);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Edit distance (Levenshtein on word arrays)
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance between two word arrays, capped at `maxDist`.
 *
 * Returns the number of word-level insertions, deletions, or substitutions
 * needed to turn `a` into `b`. Substitution cost is 1 if the words share
 * fewer than half their characters, 0.5 if they share more (partial credit
 * for ASR getting most of a word right).
 *
 * Bails out early when the running minimum exceeds `maxDist`, so comparing
 * a 5-word window against a 6-word target is fast even though the theoretical
 * matrix is small anyway.
 */
function wordEditDistance(
  a: string[],
  b: string[],
  maxDist: number,
): number {
  const m = a.length;
  const n = b.length;
  // Quick length-difference check.
  if (Math.abs(m - n) > maxDist) return maxDist + 1;

  // Single-row DP.
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0]!;
    for (let j = 1; j <= n; j++) {
      const substCost = a[i - 1] === b[j - 1] ? 0 : wordSimilarity(a[i - 1]!, b[j - 1]!) < 0.5 ? 1 : 0.5;
      curr[j] = Math.min(
        prev[j]! + 1,        // deletion
        curr[j - 1]! + 1,    // insertion
        prev[j - 1]! + substCost, // substitution
      );
      if (curr[j]! < rowMin) rowMin = curr[j]!;
    }
    if (rowMin > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Character-level similarity between two normalised Arabic words (0–1).
 * Uses the ratio of shared bigrams (Dice coefficient), which is fast and
 * tolerant of the single-character errors ASR typically produces.
 */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));
  let shared = 0;
  const totalB = b.length - 1;
  for (let i = 0; i < totalB; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) shared++;
  }
  return (2 * shared) / (bigramsA.size + totalB);
}

// ---------------------------------------------------------------------------
// QuranMatcher
// ---------------------------------------------------------------------------

export type MatcherState = "searching" | "following" | "lost";

export interface MatchResult {
  verseId: number;
  confidence: number;
}

interface VerseInput {
  id: number;
  surah_number: number;
  ayah_number: number;
  arabic_text: string;
}

/** How many consecutive high-confidence chunks before locking on. */
const LOCK_ON_CHUNKS = 2;
/** Confidence threshold to enter FOLLOWING. */
const FOLLOW_THRESHOLD = 0.5;
/** Consecutive low-confidence chunks before entering LOST. */
const LOST_CHUNKS = 3;
/** Confidence threshold below which a chunk counts as "missed". */
const LOST_THRESHOLD = 0.25;
/** How many ayahs around the last known position to search when LOST. */
const LOST_SEARCH_RADIUS = 5;
/** Seconds in LOST before falling back to full SEARCHING. */
const LOST_TIMEOUT_MS = 10_000;

export class QuranMatcher {
  // --- verse data ----------------------------------------------------------
  private readonly verses: VerseInput[];
  /** Normalised word arrays, parallel to `verses`. */
  private readonly versesNorm: string[][];
  /** verse database id → array index. */
  private readonly idToIndex: Map<number, number>;

  // --- indices -------------------------------------------------------------
  private readonly bigrams: Map<string, Set<number>>;
  private readonly trigrams: Map<string, Set<number>>;

  // --- state machine -------------------------------------------------------
  private _state: MatcherState = "searching";
  private lockedIndex: number | null = null;
  /** Approximate word offset inside the locked verse. */
  private wordCursor = 0;
  private consecutiveHigh = 0;
  private consecutiveMiss = 0;
  private lostSince: number | null = null;

  // --- rolling transcript --------------------------------------------------
  /** Accumulated normalised words from recent feed() calls. */
  private recentWords: string[] = [];
  /** Max words to keep in the rolling buffer. */
  private readonly maxRecentWords = 30;

  constructor(verses: VerseInput[]) {
    this.verses = verses;
    this.versesNorm = verses.map((v) => splitWords(normalizeArabic(v.arabic_text)));
    this.idToIndex = new Map(verses.map((v, i) => [v.id, i]));
    this.bigrams = buildNgramIndex(this.versesNorm, 2);
    this.trigrams = buildNgramIndex(this.versesNorm, 3);
  }

  get state(): MatcherState {
    return this._state;
  }

  /**
   * Feed a new chunk of recognised Arabic text and return the best match.
   *
   * Call this every time the speech recogniser returns a result (~every 3 s).
   * Returns `null` when no confident match exists yet.
   */
  feed(rawText: string): MatchResult | null {
    const norm = normalizeArabic(rawText);
    const words = splitWords(norm);
    if (words.length === 0) {
      // Silence or garbage — counts as a miss in FOLLOWING mode.
      if (this._state === "following") {
        this.consecutiveMiss++;
        if (this.consecutiveMiss >= LOST_CHUNKS) {
          this._state = "lost";
          this.lostSince = Date.now();
          this.consecutiveMiss = 0;
        }
      }
      return this.lockedIndex !== null
        ? { verseId: this.verses[this.lockedIndex]!.id, confidence: 0 }
        : null;
    }

    // Append to the rolling buffer (keep the last N words for context).
    this.recentWords.push(...words);
    if (this.recentWords.length > this.maxRecentWords) {
      this.recentWords = this.recentWords.slice(-this.maxRecentWords);
    }

    switch (this._state) {
      case "searching":
        return this.handleSearching(words);
      case "following":
        return this.handleFollowing(words);
      case "lost":
        return this.handleLost(words);
    }
  }

  /** Reset to SEARCHING, clearing all tracking state. */
  reset(): void {
    this._state = "searching";
    this.lockedIndex = null;
    this.wordCursor = 0;
    this.consecutiveHigh = 0;
    this.consecutiveMiss = 0;
    this.lostSince = null;
    this.recentWords = [];
  }

  /**
   * Hint that the user is near a specific verse (they opened a ruku, or
   * tapped an ayah). Narrows the initial search dramatically.
   */
  setHint(verseId: number): void {
    const idx = this.idToIndex.get(verseId);
    if (idx !== undefined) {
      this.lockedIndex = idx;
      this.wordCursor = 0;
      // Don't switch to FOLLOWING yet — wait for actual speech to confirm.
      // But the SEARCHING phase will heavily bias toward this region.
    }
  }

  // -----------------------------------------------------------------------
  // State handlers
  // -----------------------------------------------------------------------

  private handleSearching(words: string[]): MatchResult | null {
    const scored = this.scoreAllVerses(words);
    if (scored === null) return null;

    const { index, confidence } = scored;

    if (confidence >= FOLLOW_THRESHOLD) {
      this.consecutiveHigh++;
      this.lockedIndex = index;
      this.wordCursor = 0;

      if (this.consecutiveHigh >= LOCK_ON_CHUNKS) {
        this._state = "following";
        this.consecutiveHigh = 0;
        this.consecutiveMiss = 0;
      }
    } else {
      this.consecutiveHigh = 0;
    }

    return { verseId: this.verses[index]!.id, confidence };
  }

  private handleFollowing(words: string[]): MatchResult | null {
    if (this.lockedIndex === null) {
      this._state = "searching";
      return null;
    }

    // Try to match against the current verse and the next one, to handle
    // seamless transitions between ayahs.
    const result = this.trackInWindow(words, this.lockedIndex);

    if (result !== null && result.confidence >= LOST_THRESHOLD) {
      this.consecutiveMiss = 0;
      this.lockedIndex = result.index;
      this.wordCursor = result.wordOffset;
      return { verseId: this.verses[result.index]!.id, confidence: result.confidence };
    }

    // No match — count toward LOST.
    this.consecutiveMiss++;
    if (this.consecutiveMiss >= LOST_CHUNKS) {
      this._state = "lost";
      this.lostSince = Date.now();
      this.consecutiveMiss = 0;
    }

    // Still return the last known position at low confidence.
    return {
      verseId: this.verses[this.lockedIndex]!.id,
      confidence: Math.max(0, 0.3 - this.consecutiveMiss * 0.1),
    };
  }

  private handleLost(words: string[]): MatchResult | null {
    // Check timeout — fall back to full SEARCHING after 10 seconds.
    if (this.lostSince !== null && Date.now() - this.lostSince > LOST_TIMEOUT_MS) {
      this._state = "searching";
      this.lockedIndex = null;
      this.consecutiveHigh = 0;
      return this.handleSearching(words);
    }

    // Search nearby: ±LOST_SEARCH_RADIUS ayahs around the last known position.
    if (this.lockedIndex !== null) {
      const nearbyResult = this.searchNearby(words, this.lockedIndex, LOST_SEARCH_RADIUS);
      if (nearbyResult !== null && nearbyResult.confidence >= FOLLOW_THRESHOLD) {
        this._state = "following";
        this.lockedIndex = nearbyResult.index;
        this.wordCursor = 0;
        this.consecutiveMiss = 0;
        this.lostSince = null;
        return { verseId: this.verses[nearbyResult.index]!.id, confidence: nearbyResult.confidence };
      }
    }

    // Still lost — return last known at zero confidence.
    return this.lockedIndex !== null
      ? { verseId: this.verses[this.lockedIndex]!.id, confidence: 0.1 }
      : null;
  }

  // -----------------------------------------------------------------------
  // Scoring
  // -----------------------------------------------------------------------

  /**
   * Score all verses against the recognised words using the n-gram index.
   *
   * Returns the best-scoring verse index and a confidence 0–1, or null if
   * the input is too short to produce any candidates.
   */
  private scoreAllVerses(words: string[]): { index: number; confidence: number } | null {
    // Collect candidate verses from n-gram hits.
    const candidates = new Map<number, number>();

    // Use both bigrams and trigrams for robustness.
    const addHits = (index: Map<string, Set<number>>, n: number, weight: number) => {
      for (let i = 0; i <= words.length - n; i++) {
        const gram = words.slice(i, i + n).join(" ");
        const hits = index.get(gram);
        if (hits) {
          for (const vi of hits) {
            candidates.set(vi, (candidates.get(vi) ?? 0) + weight);
          }
        }
      }
    };

    addHits(this.bigrams, 2, 1);
    addHits(this.trigrams, 3, 2); // Trigrams get double weight — more specific.

    // Also check the rolling buffer for better context.
    if (this.recentWords.length > words.length) {
      const contextWords = this.recentWords.slice(-Math.min(15, this.recentWords.length));
      addHits(this.bigrams, 2, 0.5);

      for (let i = 0; i <= contextWords.length - 3; i++) {
        const gram = contextWords.slice(i, i + 3).join(" ");
        const hits = this.trigrams.get(gram);
        if (hits) {
          for (const vi of hits) {
            candidates.set(vi, (candidates.get(vi) ?? 0) + 1);
          }
        }
      }
    }

    if (candidates.size === 0) return null;

    // Apply locality bias: if we have a hint or last locked position,
    // nearby verses get a score bonus.
    if (this.lockedIndex !== null) {
      for (const [vi, score] of candidates) {
        const dist = Math.abs(vi - this.lockedIndex);
        if (dist <= 3) {
          candidates.set(vi, score + 3 - dist); // +3, +2, +1 for adjacent verses
        }
      }
    }

    // Find the best candidate.
    let bestIndex = -1;
    let bestScore = -1;
    let secondBest = -1;
    for (const [vi, score] of candidates) {
      if (score > bestScore) {
        secondBest = bestScore;
        bestScore = score;
        bestIndex = vi;
      } else if (score > secondBest) {
        secondBest = score;
      }
    }

    if (bestIndex < 0) return null;

    // Confidence is the ratio of the best score to what a perfect match of
    // this many words would produce, adjusted by how much the best stands
    // out from the second-best.
    const maxPossible = Math.max(1, (words.length - 1) * 1 + Math.max(0, words.length - 2) * 2);
    const rawConfidence = bestScore / maxPossible;
    const separation = secondBest > 0 ? (bestScore - secondBest) / bestScore : 1;
    const confidence = Math.min(1, rawConfidence * 0.6 + separation * 0.4);

    return { index: bestIndex, confidence };
  }

  /**
   * Track within a narrow window around the current verse.
   *
   * Checks the current verse, the next verse, and (for backward jumps) the
   * previous verse. Returns the best match with a word-level offset.
   */
  private trackInWindow(
    words: string[],
    centerIndex: number,
  ): { index: number; confidence: number; wordOffset: number } | null {
    let best: { index: number; confidence: number; wordOffset: number } | null = null;

    // Check current verse, next, and previous.
    const toCheck = [centerIndex];
    if (centerIndex + 1 < this.verses.length) toCheck.push(centerIndex + 1);
    if (centerIndex > 0) toCheck.push(centerIndex - 1);

    for (const vi of toCheck) {
      const verseWords = this.versesNorm[vi]!;
      if (verseWords.length === 0) continue;

      // Build a target window: from the current word cursor onward, plus
      // a few words of context before (for backward jumps).
      const windowStart = Math.max(0, vi === centerIndex ? this.wordCursor - 3 : 0);
      const windowEnd = Math.min(verseWords.length, windowStart + words.length + 4);
      const window = verseWords.slice(windowStart, windowEnd);

      if (window.length === 0) continue;

      const maxDist = Math.ceil(Math.max(words.length, window.length) * 0.6);
      const dist = wordEditDistance(words, window, maxDist);
      const maxLen = Math.max(words.length, window.length);
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;

      if (best === null || similarity > best.confidence) {
        // Estimate the word offset within the verse.
        const estimatedOffset = Math.min(
          windowStart + Math.max(0, words.length - 1),
          verseWords.length - 1,
        );
        best = { index: vi, confidence: similarity, wordOffset: estimatedOffset };
      }
    }

    return best;
  }

  /**
   * Search a narrow radius around a center verse for a match.
   * Used in the LOST state to re-acquire tracking without a full global scan.
   */
  private searchNearby(
    words: string[],
    centerIndex: number,
    radius: number,
  ): { index: number; confidence: number } | null {
    let best: { index: number; confidence: number } | null = null;

    const lo = Math.max(0, centerIndex - radius);
    const hi = Math.min(this.verses.length - 1, centerIndex + radius);

    for (let vi = lo; vi <= hi; vi++) {
      const verseWords = this.versesNorm[vi]!;
      if (verseWords.length === 0) continue;

      const maxDist = Math.ceil(Math.max(words.length, verseWords.length) * 0.5);
      const dist = wordEditDistance(words, verseWords, maxDist);
      const maxLen = Math.max(words.length, verseWords.length);
      const similarity = maxLen > 0 ? 1 - dist / maxLen : 0;

      if (best === null || similarity > best.confidence) {
        best = { index: vi, confidence: similarity };
      }
    }

    return best;
  }
}
