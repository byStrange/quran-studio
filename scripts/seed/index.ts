/**
 * One-time Quran content import.
 *
 * Fetches text, translation, word-by-word data, ruku boundaries, and Ibn
 * Kathir tafsir from the upstream sources and writes them into Supabase. The
 * app itself never talks to those APIs — it only reads these tables.
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
  type TafsirEntry,
  type Verse,
  type Word,
} from "./sources.ts";
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

  log("rukus", "deriving ruku boundaries…");
  const rukus = deriveRukus(verses);
  log("rukus", `derived ${rukus.length} rukus`);

  log("tafsir", "fetching Ibn Kathir…");
  const tafsirPerSurah = await mapLimit(surahs, 4, async (surah) => {
    const entries = await fetchTafsir(surah.number, surah.ayah_count);
    log("tafsir", `surah ${surah.number}: ${entries.length} entries`);
    return entries;
  });
  const tafsir: TafsirEntry[] = tafsirPerSurah.flat();
  log("tafsir", `total ${tafsir.length} entries after range collapsing`);

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
  await upsertAll("quran_verses", verses, { onConflict: "id", size: 500 });
  await upsertAll("quran_rukus", rukus, { onConflict: "ruku_number" });
  await upsertAll("quran_words", words, { onConflict: "id", size: 1000 });
  await upsertAll("tafsir_ibn_kathir", tafsir, { onConflict: "surah_number,ayah_start" });

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
