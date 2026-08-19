/**
 * Russian word-by-word gloss import.
 *
 *   pnpm seed:wbw-ru
 *
 * The quran.com API — which supplies every other field in `quran_words` —
 * has no Russian word-by-word data. Asking it for `language=ru` does not
 * fail; it silently serves the English glosses, which is worse, and is why
 * this cannot simply be another field on the main verse fetch.
 *
 * The corpus does exist in Tarteel's Quranic Universal Library, as resource
 * 553 ("Russian wbw translation", ~98.5% complete). QUL's bulk export needs a
 * signed-in account, so this reads the public proofreading view instead, one
 * page per verse. That is 6,236 requests, so every page is cached on disk and
 * the crawl is resumable: a re-run after a failure re-parses from the cache
 * and fetches nothing.
 *
 * Alignment is the whole risk in an import like this, so it is checked rather
 * than assumed — see `parseVerse`. Each page carries the Arabic and the
 * English gloss next to the Russian, and both are compared against the row
 * already in the database before the Russian is accepted.
 */
import { admin } from "./db.ts";
import { cachedText, chunk, log, mapLimit, sleep, stripHtml } from "./util.ts";

/** QUL's word-translation resource id for Russian. */
const RESOURCE_ID = 553;

const pageUrl = (verseId: number) =>
  `https://qul.tarteel.ai/word_translations/${verseId}?resource_id=${RESOURCE_ID}`;

/**
 * QUL writes this in the Russian column for a word nobody has glossed yet.
 * It is a UI string, not data, and must not be imported as one.
 */
const MISSING = "Missing translation";

interface ParsedWord {
  position: number;
  arabic: string;
  glossEn: string;
  russian: string | null;
}

/**
 * Pulls the word table out of one proofreading page.
 *
 * The page has exactly one table, under a "Word list with translation"
 * heading, with columns: Word#, Text Uthmani, En translation, Russian
 * Translation. Its last row is the ayah-number glyph rather than a word —
 * the same `end` entry the main seed drops — and is filtered out here by the
 * absence of a position in `quran_words`, not by guessing at its text.
 */
function parseVerse(html: string): ParsedWord[] {
  const start = html.indexOf("Word list with translation");
  if (start === -1) {
    throw new Error("no word table on the page (resource not selected?)");
  }
  const table = html.slice(start);

  const words: ParsedWord[] = [];
  for (const match of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = match[1] ?? "";
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      stripHtml(m[1]!),
    );
    if (cells.length < 4) continue;
    const position = Number(cells[0]);
    if (!Number.isInteger(position) || position < 1) continue; // header row

    const russian = cells[3]!.trim();
    words.push({
      position,
      arabic: cells[1]!.trim(),
      glossEn: cells[2]!.trim(),
      russian: russian === MISSING || russian === "" ? null : russian,
    });
  }
  if (words.length === 0) throw new Error("word table parsed to zero rows");
  return words;
}

/** Arabic here comes from two different scripts (QPC Hafs vs Uthmani), so the
 *  comparison is on letters only: diacritics, and the presentation forms that
 *  differ between them, are stripped before matching. */
function bareArabic(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[ً-ٰٟۖ-ۭـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ى]/g, "ي")
    .replace(/\s+/g, "");
}

const bareEnglish = (input: string) => input.toLowerCase().replace(/[^a-z]/g, "");

async function main(): Promise<void> {
  const started = Date.now();

  log("db", "loading verses and words…");

  const verses = new Map<number, { surah: number; ayah: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("quran_verses")
      .select("id,surah_number,ayah_number")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`reading quran_verses: ${error.message}`);
    if (!data?.length) break;
    for (const v of data) verses.set(v.id, { surah: v.surah_number, ayah: v.ayah_number });
    if (data.length < 1000) break;
  }

  /** (verse_id, position) -> the word row we are going to update. */
  const words = new Map<string, { id: number; arabic: string; glossEn: string | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("quran_words")
      .select("id,verse_id,position,arabic,gloss_en")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`reading quran_words: ${error.message}`);
    if (!data?.length) break;
    for (const w of data) {
      words.set(`${w.verse_id}:${w.position}`, {
        id: w.id,
        arabic: w.arabic,
        glossEn: w.gloss_en,
      });
    }
    if (data.length < 1000) break;
  }
  log("db", `${verses.size} verses, ${words.size} words`);

  let verseIds = [...verses.keys()].sort((a, b) => a - b);

  // `--limit N` runs the whole pipeline over the first N verses, including the
  // alignment check and the write. Used to prove the parse against real rows
  // before committing to the full 6,236-page crawl.
  const limitArg = process.argv.indexOf("--limit");
  if (limitArg !== -1) {
    const n = Number(process.argv[limitArg + 1]);
    if (!Number.isInteger(n) || n < 1) throw new Error("--limit needs a positive integer");
    verseIds = verseIds.slice(0, n);
    log("limit", `restricted to the first ${verseIds.length} verses`);
  }

  // Concurrency is deliberately low. This is a free community service being
  // asked for 6,236 pages it did not intend to serve in bulk; the crawl is
  // cached and resumable precisely so it only ever has to happen once.
  let fetched = 0;
  const rows: Array<{ id: number; gloss_ru: string }> = [];
  const mismatches: string[] = [];
  let missing = 0;
  let unmatched = 0;

  await mapLimit(verseIds, 6, async (verseId) => {
    const html = await cachedText(`wbw-ru-${verseId}`, pageUrl(verseId));
    const parsed = parseVerse(html);

    for (const word of parsed) {
      const key = `${verseId}:${word.position}`;
      const target = words.get(key);
      // No row at this position means the ayah-number glyph, which the main
      // seed correctly skipped. Anything else would be a real misalignment.
      if (!target) continue;

      // Alignment check. The Arabic is the strong signal; the English gloss
      // is a second opinion for the handful of words whose script normalises
      // differently between the two corpora.
      const arabicOk = bareArabic(target.arabic) === bareArabic(word.arabic);
      const englishOk = bareEnglish(target.glossEn ?? "") === bareEnglish(word.glossEn);
      if (!arabicOk && !englishOk) {
        unmatched++;
        if (mismatches.length < 10) {
          const v = verses.get(verseId)!;
          mismatches.push(
            `${v.surah}:${v.ayah} pos ${word.position} — ` +
              `db "${target.arabic}" / "${target.glossEn}" vs ` +
              `qul "${word.arabic}" / "${word.glossEn}"`,
          );
        }
        continue;
      }

      if (word.russian === null) {
        missing++;
        continue;
      }
      rows.push({ id: target.id, gloss_ru: word.russian });
    }

    fetched++;
    if (fetched % 250 === 0) {
      log("fetch", `${fetched}/${verseIds.length} verses — ${rows.length} glosses so far`);
    }
  });

  log("parse", `${rows.length} Russian glosses, ${missing} words with none upstream`);

  if (unmatched > 0) {
    log("parse", `${unmatched} words failed the alignment check:`);
    for (const m of mismatches) log("parse", `  ${m}`);
  }
  // A handful of script mismatches is expected; wholesale failure means the
  // two corpora are not the same word order and nothing should be written.
  const rate = unmatched / words.size;
  if (rate > 0.01) {
    throw new Error(
      `${(rate * 100).toFixed(1)}% of words failed the alignment check. ` +
        `Refusing to import a misaligned word-by-word corpus.`,
    );
  }

  log("db", `writing ${rows.length} glosses…`);
  // Only `gloss_ru` is in the payload, so this must be an update rather than
  // an upsert: an upsert would null out arabic/transliteration/gloss_en on
  // every row it touched.
  await updateGlosses(rows);

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  const coverage = ((rows.length / words.size) * 100).toFixed(1);
  log("done", `imported in ${elapsed}s — ${coverage}% of words now have a Russian gloss`);
}

/**
 * Retries a write through a transient network failure.
 *
 * Tens of thousands of small updates over one connection will occasionally
 * see a dropped socket, and losing a 40-minute import to one of them — as
 * this script did before the retry existed — is not an acceptable failure
 * mode. Every write here is idempotent, so replaying one is always safe.
 */
async function withRetry(what: string, fn: () => Promise<void>, attempts = 5): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8_000));
    }
  }
  throw new Error(`updating ${what} failed after ${attempts} attempts: ${String(lastError)}`);
}

/**
 * Applies the glosses through the `set_word_glosses_ru` bulk writer.
 *
 * One request per 5,000 words rather than one per distinct gloss. The first
 * version of this grouped words by shared gloss and sent an `in` filter for
 * each, which is 32,000 requests — slow enough that the write outlasted the
 * crawl that produced the data, and slow enough that one socket hanging with
 * no timeout stalled the entire run.
 *
 * The function updates only rows whose value actually changes, so re-running
 * after a partial import writes just the remainder.
 */
async function updateGlosses(rows: readonly { id: number; gloss_ru: string }[]): Promise<void> {
  const batches = chunk(rows, 5_000);
  log("db", `${batches.length} batches of up to 5,000 words`);

  let sent = 0;
  let changed = 0;
  for (const batch of batches) {
    await withRetry(`gloss_ru for ${batch.length} words`, async () => {
      const { data, error } = await admin.rpc("set_word_glosses_ru", {
        p_rows: batch.map((r) => ({ id: r.id, gloss: r.gloss_ru })),
      });
      if (error) throw new Error(error.message);
      changed += data ?? 0;
    });
    sent += batch.length;
    log("db", `${sent}/${rows.length} words sent — ${changed} rows changed`);
  }
}

main().catch((error) => {
  console.error("\nRussian word-by-word import failed:\n", error);
  process.exit(1);
});
