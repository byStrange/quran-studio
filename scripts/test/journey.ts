/**
 * Journey planner and progress — offline checks.
 *
 * Everything under test is pure (verses in, a plan out), so this needs no
 * database and no network: `pnpm test:journey`.
 */
import assert from "node:assert/strict";
import {
  STOP_MAX_AYAHS,
  STOP_WORD_BUDGET,
  planLesson,
  planStops,
  seededRng,
  starsFor,
  stopKey,
  teachableWords,
  type JourneyVerse,
} from "../../src/lib/journey/plan";
import {
  EMPTY_JOURNEY,
  JOURNEY_PATH,
  mergeJourney,
  nextSurah,
  parseJourney,
  totalStars,
  withStopFinished,
  withSurahDone,
} from "../../src/lib/journey/progress";

let wordId = 0;
/** A surah whose ayahs have the given word counts. */
function surah(number: number, sizes: number[], gloss = true): JourneyVerse[] {
  return sizes.map((size, i) => ({
    id: number * 1000 + i + 1,
    surah: number,
    ayah: i + 1,
    ruku: 1,
    arabic: `آية${i + 1} ` + "كلمة ".repeat(size),
    tajweed: null,
    translation: `meaning of ayah ${i + 1}`,
    translationTag: "en",
    words: Array.from({ length: size }, (_, w) => {
      wordId += 1;
      return {
        id: wordId,
        position: w + 1,
        arabic: `كلمة${wordId}`,
        text: `كلمة${wordId}`,
        tajweed: null,
        transliteration: null,
        meaning: gloss ? `meaning ${wordId}` : null,
      };
    }),
  }));
}

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

check("a short surah is one stop", () => {
  const stops = planStops(surah(112, [4, 2, 4, 5]));
  assert.equal(stops.length, 1);
  assert.equal(stopKey(stops[0]!), "112:1");
});

check("stops cover every ayah once, in order, within the budget", () => {
  const verses = surah(78, [3, 4, 6, 5, 9, 2, 30, 4, 4, 4, 4, 7, 1, 12, 3]);
  const stops = planStops(verses);
  assert.deepEqual(
    stops.flatMap((s) => s.verses.map((v) => v.ayah)),
    verses.map((v) => v.ayah),
  );
  for (const stop of stops) {
    assert.ok(stop.verses.length >= 1);
    assert.ok(stop.verses.length <= STOP_MAX_AYAHS + 1, "at most one absorbed tail");
    const words = stop.verses.reduce((n, v) => n + v.words.length, 0);
    // Only a single over-long ayah, or an absorbed tail, may exceed the budget.
    if (stop.verses.length > 1) assert.ok(words <= STOP_WORD_BUDGET + 7);
    assert.equal(stop.ayahStart, stop.verses[0]!.ayah);
    assert.equal(stop.ayahEnd, stop.verses.at(-1)!.ayah);
  }
});

check("a dangling short last ayah joins the stop before it", () => {
  const stops = planStops(surah(2, [5, 5, 5, 5, 3]));
  assert.equal(stops.length, 1);
  assert.equal(stops[0]!.ayahEnd, 5);
});

check("a lesson opens by listening and closes by reciting", () => {
  const verses = surah(1, [4, 4, 2, 3, 4, 3, 9]);
  for (const stop of planStops(verses)) {
    const scenes = planLesson(stop, verses, seededRng(7));
    assert.equal(scenes[0]!.kind, "listen");
    assert.equal(scenes.at(-1)!.kind, "recite");
  }
});

check("the tafsir scene is planned only when asked for, just before reciting", () => {
  const verses = surah(105, [5, 5, 4, 4, 3]);
  const stop = planStops(verses)[0]!;
  const without = planLesson(stop, verses, seededRng(3)).map((s) => s.kind);
  const withTafsir = planLesson(stop, verses, seededRng(3), { tafsir: true }).map((s) => s.kind);
  assert.ok(!without.includes("understand"));
  assert.equal(withTafsir.at(-2), "understand");
  assert.equal(withTafsir.at(-1), "recite");
});

check("the same seed gives the same lesson; scenes only reference the surah", () => {
  const verses = surah(93, [2, 3, 5, 6, 4, 4, 4, 4, 5, 5, 5]);
  const stop = planStops(verses)[1]!;
  const a = planLesson(stop, verses, seededRng(42));
  const b = planLesson(stop, verses, seededRng(42));
  assert.deepEqual(a, b);
  const verseIds = new Set(verses.map((v) => v.id));
  const wordIds = new Set(verses.flatMap((v) => v.words.map((w) => w.id)));
  for (const scene of a) {
    if (scene.kind === "hear") {
      for (const round of scene.rounds) {
        assert.ok(round.choices.some((c) => c.wordId === round.answer.wordId));
        assert.equal(new Set(round.choices.map((c) => c.wordId)).size, round.choices.length);
        for (const c of round.choices) assert.ok(wordIds.has(c.wordId));
      }
    }
    if (scene.kind === "which") {
      for (const round of scene.rounds) {
        assert.ok(round.choiceVerseIds.includes(round.verseId));
        assert.ok(round.choiceVerseIds.length >= 2);
        for (const id of round.choiceVerseIds) assert.ok(verseIds.has(id));
      }
    }
    if (scene.kind === "order") {
      assert.deepEqual([...scene.verseIds].sort(), stop.verses.map((v) => v.id).sort());
      assert.notDeepEqual(scene.verseIds, stop.verses.map((v) => v.id));
    }
    if (scene.kind === "match") assert.ok(scene.words.length >= 3);
  }
});

check("words without a gloss are never asked about", () => {
  const verses = surah(108, [4, 3, 3], false);
  const stop = planStops(verses)[0]!;
  assert.equal(teachableWords(stop).length, 0);
  const kinds = planLesson(stop, verses, seededRng(1)).map((s) => s.kind);
  assert.ok(!kinds.includes("meet") && !kinds.includes("match") && !kinds.includes("hear"));
  assert.ok(!kinds.includes("build"));
});

check("a repeated word is taught once", () => {
  const verses = surah(109, [3, 3]);
  verses[1]!.words[0]!.arabic = verses[0]!.words[0]!.arabic;
  assert.equal(teachableWords(planStops(verses)[0]!).length, 5);
});

check("stars: finishing always earns one", () => {
  assert.equal(starsFor(0), 3);
  assert.equal(starsFor(1), 3);
  assert.equal(starsFor(2), 2);
  assert.equal(starsFor(4), 2);
  assert.equal(starsFor(50), 1);
});

check("progress never loses a better result, and merging is order-free", () => {
  const now = new Date("2026-11-11T10:00:00Z");
  let a = withStopFinished(EMPTY_JOURNEY, "112:1", 3, now);
  a = withStopFinished(a, "112:1", 1, new Date("2026-11-12T10:00:00Z"));
  assert.equal(a.stops["112:1"]!.stars, 3);
  assert.equal(a.stops["112:1"]!.times, 2);
  const b = withSurahDone(withStopFinished(EMPTY_JOURNEY, "114:1", 2, now), 114);
  const ab = mergeJourney(a, b);
  const ba = mergeJourney(b, a);
  assert.deepEqual(ab.stops, ba.stops);
  assert.deepEqual(ab.surahsDone, [114]);
  assert.equal(totalStars(ab), 5);
});

check("stored progress of the wrong shape is dropped, not trusted", () => {
  const parsed = parseJourney({
    stops: { "112:1": { stars: 3, times: 2, at: "x" }, bad: { stars: 9 }, "1:1": { stars: 0 } },
    surahsDone: [112, "x", 112],
    glossLanguage: "fr",
  });
  assert.deepEqual(Object.keys(parsed.stops), ["112:1"]);
  assert.deepEqual(parsed.surahsDone, [112]);
  assert.equal(parsed.glossLanguage, undefined);
  assert.deepEqual(parseJourney(null), EMPTY_JOURNEY);
});

check("the path visits every surah once, Al-Fatiha then An-Nas backwards", () => {
  assert.equal(JOURNEY_PATH.length, 114);
  assert.equal(new Set(JOURNEY_PATH).size, 114);
  assert.deepEqual(JOURNEY_PATH.slice(0, 3), [1, 114, 113]);
  assert.equal(nextSurah(withSurahDone(EMPTY_JOURNEY, 1)), 114);
});

console.log(`\n${passed} journey checks passed`);
