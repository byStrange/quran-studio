/**
 * Imports the tafsir editions without touching anything else.
 *
 *   pnpm seed:tafsir
 *
 * `pnpm seed` would do this too, but it also re-upserts 6,236 verses and ~77k
 * word rows that no tafsir edition changes. This writes the editions and their
 * commentary and stops, so adding an edition to an existing database is a
 * short job rather than a full re-import.
 *
 * Safe to re-run: every write is an upsert keyed on
 * (edition, surah_number, ayah_start), and downloads are cached under
 * scripts/seed/.cache.
 */
import { upsertAll } from "./db.ts";
import { fetchSurahs, fetchTafsir, TAFSIR_EDITIONS, type TafsirEntry } from "./sources.ts";
import { log, mapLimit } from "./util.ts";
import { runValidation } from "./verify.ts";

async function main(): Promise<void> {
  const started = Date.now();

  log("surahs", "fetching chapter index…");
  const surahs = await fetchSurahs();

  const tafsir: TafsirEntry[] = [];
  for (const edition of TAFSIR_EDITIONS) {
    log("tafsir", `fetching ${edition.name} (${edition.language_name})…`);
    const perSurah = await mapLimit(surahs, 4, (surah) =>
      fetchTafsir(edition.slug, surah.number, surah.ayah_count),
    );
    const entries = perSurah.flat();
    const ayahs = entries.reduce((n, e) => n + (e.ayah_end - e.ayah_start + 1), 0);
    log(
      "tafsir",
      `${edition.slug}: ${entries.length} entries covering ${ayahs} ayahs`,
    );
    tafsir.push(...entries);
  }

  log("db", "writing to Supabase…");
  // Editions first: the tafsir rows carry a foreign key to them.
  await upsertAll("tafsir_editions", [...TAFSIR_EDITIONS], { onConflict: "slug" });
  await upsertAll("tafsir", tafsir, { onConflict: "edition,surah_number,ayah_start", size: 500 });

  log("verify", "running data integrity checks…");
  const ok = await runValidation();

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  log("done", `tafsir import finished in ${elapsed}s`);
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nTafsir import failed:\n", error);
  process.exit(1);
});
