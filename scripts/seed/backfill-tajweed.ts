/**
 * Fills `quran_verses.tajweed` without touching anything else.
 *
 *   pnpm seed:tajweed
 *
 * `pnpm seed` would do this too, but it also re-upserts ~77k word rows and the
 * tafsir corpus that the tajweed import does not change. This writes the 6,236
 * verse rows and stops, so adding colouring to an existing database is a short
 * job rather than a full re-import.
 *
 * Verse rows are upserted whole rather than patched: PostgREST sends an
 * `insert … on conflict do update`, so a payload of just `id` and `tajweed`
 * would fail the not-null columns on the insert branch. Everything else in the
 * payload comes from the same cached download the original import used, so the
 * other columns are rewritten with the values they already hold.
 *
 * Safe to re-run, and safe to run before or after `pnpm seed`.
 */
import { upsertAll } from "./db.ts";
import { fetchSurahs, fetchSurahContent, type Verse } from "./sources.ts";
import { alignToCanonical, fetchTajweedMarkup, verifyAlignment } from "./tajweed.ts";
import { log, mapLimit } from "./util.ts";
import { runValidation } from "./verify.ts";

async function main(): Promise<void> {
  const started = Date.now();

  log("surahs", "fetching chapter index…");
  const surahs = await fetchSurahs();

  log("verses", "loading verse text (from cache where available)…");
  const content = await mapLimit(surahs, 4, (surah) => fetchSurahContent(surah.number));
  const verses: Verse[] = content.flatMap((c) => c.verses);
  log("verses", `${verses.length} verses`);

  log("tajweed", "fetching the tajweed-annotated mushaf…");
  const markup = await fetchTajweedMarkup();
  log("tajweed", `got markup for ${markup.size} verses; aligning onto the Uthmani text…`);

  const alignments = verses.map((verse) => {
    const source = markup.get(verse.id);
    if (!source) throw new Error(`no tajweed markup for verse ${verse.id}`);
    return {
      verseId: verse.id,
      markup: source,
      canonical: verse.arabic_text,
      spans: alignToCanonical(source, verse.arabic_text),
    };
  });

  const report = verifyAlignment(alignments);
  log(
    "tajweed",
    `${report.spans} rule spans; ${report.exact}/${report.verses} verses aligned exactly`,
  );
  if (report.unknown.size > 0) {
    throw new Error(
      `upstream emitted unknown tajweed classes: ${[...report.unknown].join(", ")}. ` +
        `Add them to TAJWEED_RULES and give them a colour before importing.`,
    );
  }
  if (report.dropped.length > 0) {
    const sample = report.dropped
      .slice(0, 5)
      .map((d) => `verse ${d.verseId}: ${d.rule}`)
      .join("; ");
    throw new Error(
      `${report.dropped.length} tajweed rules were lost in alignment (${sample}). ` +
        `Refusing to import a partially coloured mushaf.`,
    );
  }

  const spansByVerse = new Map(alignments.map((a) => [a.verseId, a.spans]));

  log("db", "writing tajweed spans…");
  await upsertAll(
    "quran_verses",
    verses.map((verse) => ({ ...verse, tajweed: spansByVerse.get(verse.id) ?? null })),
    { onConflict: "id", size: 500 },
  );

  log("verify", "running data integrity checks…");
  const ok = await runValidation();

  log("done", `backfill finished in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nTajweed backfill failed:\n", error);
  process.exit(1);
});
