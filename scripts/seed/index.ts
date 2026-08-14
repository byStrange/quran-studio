/**
 * One-time Quran content import.
 *
 * Fetches text, translation, word-by-word data, ruku boundaries, and every
 * tafsir edition in `TAFSIR_EDITIONS` from the upstream sources and writes
 * them into Supabase. The app itself never talks to those APIs — it only
 * reads these tables.
 *
 *   pnpm seed
 *
 * Safe to re-run: every write is an upsert keyed on a stable id, and all
 * downloads are cached under scripts/seed/.cache.
 */
import { upsertAll } from "./db.ts";
import {
  deriveRukus,
  fetchSurahs,
  fetchSurahContent,
  fetchTafsir,
  TAFSIR_EDITIONS,
  type TafsirEntry,
  type Verse,
  type Word,
} from "./sources.ts";
import {
  alignToCanonical,
  fetchTajweedMarkup,
  verifyAlignment,
  type TajweedSpan,
} from "./tajweed.ts";
import { log, mapLimit } from "./util.ts";
import { runValidation } from "./verify.ts";

async function main(): Promise<void> {
  const started = Date.now();

  log("surahs", "fetching chapter index…");
  const surahs = await fetchSurahs();
  log("surahs", `got ${surahs.length} surahs`);

  log("verses", "fetching verses + word-by-word for 114 surahs…");
  const content = await mapLimit(surahs, 4, async (surah) => {
    const result = await fetchSurahContent(surah.number);
    log("verses", `surah ${surah.number} (${surah.name_english}): ${result.verses.length} ayahs, ${result.words.length} words`);
    return result;
  });

  const verses: Verse[] = content.flatMap((c) => c.verses);
  const words: Word[] = content.flatMap((c) => c.words);
  log("verses", `total ${verses.length} verses, ${words.length} words`);

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

  const tajweedByVerse = new Map<number, TajweedSpan[]>(
    alignments.map((a) => [a.verseId, a.spans]),
  );

  log("rukus", "deriving ruku boundaries…");
  const rukus = deriveRukus(verses);
  log("rukus", `derived ${rukus.length} rukus`);

  const tafsir: TafsirEntry[] = [];
  for (const edition of TAFSIR_EDITIONS) {
    log("tafsir", `fetching ${edition.name} (${edition.language_name})…`);
    const perSurah = await mapLimit(surahs, 4, (surah) =>
      fetchTafsir(edition.slug, surah.number, surah.ayah_count),
    );
    const entries = perSurah.flat();
    log("tafsir", `${edition.slug}: ${entries.length} entries after range collapsing`);
    tafsir.push(...entries);
  }

  // Surah ruku counts are derived, not fetched.
  const rukuCounts = new Map<number, number>();
  for (const ruku of rukus) {
    rukuCounts.set(ruku.surah_number, (rukuCounts.get(ruku.surah_number) ?? 0) + 1);
  }

  log("db", "writing to Supabase…");
  // Order matters: foreign keys point back up this list.
  await upsertAll(
    "quran_surahs",
    surahs.map((s) => ({ ...s, ruku_count: rukuCounts.get(s.number) ?? 0 })),
    { onConflict: "number" },
  );
  await upsertAll(
    "quran_verses",
    verses.map((verse) => ({ ...verse, tajweed: tajweedByVerse.get(verse.id) ?? null })),
    { onConflict: "id", size: 500 },
  );
  await upsertAll("quran_rukus", rukus, { onConflict: "ruku_number" });
  await upsertAll("quran_words", words, { onConflict: "id", size: 1000 });
  // Editions first: the tafsir rows carry a foreign key to them.
  await upsertAll("tafsir_editions", [...TAFSIR_EDITIONS], { onConflict: "slug" });
  await upsertAll("tafsir", tafsir, { onConflict: "edition,surah_number,ayah_start" });

  log("verify", "running data integrity checks…");
  const ok = await runValidation();

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  log("done", `import finished in ${elapsed}s`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nSeed failed:\n", error);
  process.exit(1);
});
