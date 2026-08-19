/**
 * Imports recitation audio metadata and ayah timings.
 *
 *   pnpm seed:audio                 every reciter
 *   pnpm seed:audio --reciter=7     just one (repeatable)
 *   pnpm seed:audio --surah=18      just one surah, across the chosen reciters
 *
 * No audio is downloaded here — the mp3s stay on quran.com's CDN and are
 * streamed (or downloaded on demand from the app). What this writes is the
 * metadata that makes them navigable: which file holds which surah, how long
 * it is, and where every ayah falls inside it.
 *
 * Volume is worth knowing before running it: all 14 reciters is 1,596 upstream
 * requests and roughly 87,000 timing rows, most of the weight being word-level
 * segments. A single reciter is ~6,236 rows and a couple of minutes. Downloads
 * are cached under scripts/seed/.cache, so an interrupted run resumes cheaply.
 *
 * Safe to re-run: every write is an upsert keyed on the natural key.
 */
import { admin, upsertAll } from "./db.ts";
import {
  fetchReciters,
  fetchSurahAudio,
  type RecitationFileRow,
  type RecitationTimingRow,
} from "./audio.ts";
import { log, mapLimit } from "./util.ts";

/** Collects a repeatable numeric flag: `--reciter=7 --reciter=9`. */
function numericFlag(name: string): number[] {
  return process.argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .map((arg) => Number(arg.slice(name.length + 3)))
    .filter((value) => Number.isFinite(value));
}

/**
 * `surah:ayah` → canonical verse id, read from the database rather than
 * computed.
 *
 * The ids happen to run 1..6236 in mushaf order, so this could be arithmetic
 * over the surah ayah counts. Reading the real mapping instead means a timing
 * can never be attached to the wrong ayah because an assumption about the
 * numbering drifted — and it makes the "unknown verse" error in audio.ts a
 * genuine signal.
 */
async function verseIdIndex(): Promise<Map<string, number>> {
  const page = 1000;
  const index = new Map<string, number>();
  for (let offset = 0; ; offset += page) {
    const { data, error } = await admin
      .from("quran_verses")
      .select("id, surah_number, ayah_number")
      .order("id")
      .range(offset, offset + page - 1);
    if (error) throw new Error(`reading quran_verses: ${error.message}`);
    const rows = data ?? [];
    for (const row of rows) index.set(`${row.surah_number}:${row.ayah_number}`, row.id);
    if (rows.length < page) return index;
  }
}

async function main(): Promise<void> {
  const started = Date.now();

  const onlyReciters = new Set(numericFlag("reciter"));
  const onlySurahs = numericFlag("surah");
  const surahs =
    onlySurahs.length > 0 ? onlySurahs : Array.from({ length: 114 }, (_, i) => i + 1);

  log("verses", "indexing canonical verse ids…");
  const verseIds = await verseIdIndex();
  log("verses", `indexed ${verseIds.size} verses`);
  const resolveVerseId = (surah: number, ayah: number) => verseIds.get(`${surah}:${ayah}`);

  log("reciters", "fetching the reciter catalogue…");
  const allReciters = await fetchReciters();
  const reciters =
    onlyReciters.size > 0 ? allReciters.filter((r) => onlyReciters.has(r.id)) : allReciters;

  if (reciters.length === 0) {
    throw new Error(
      `no reciters matched --reciter. Available ids: ${allReciters.map((r) => r.id).join(", ")}`,
    );
  }
  log("reciters", `importing ${reciters.length} of ${allReciters.length} reciters`);

  // Reciters first: the file and timing rows carry a foreign key to them. The
  // whole catalogue is written even when only some are imported, so the
  // picker's ids stay stable if the filter changes between runs.
  await upsertAll("reciters", allReciters, { onConflict: "id" });

  for (const reciter of reciters) {
    const label = `${reciter.name}${reciter.style ? ` (${reciter.style})` : ""}`;
    log("audio", `${label}: fetching ${surahs.length} surahs…`);

    // Four at a time is what the rest of the seed uses against quran.com and
    // has never been rate-limited.
    const results = await mapLimit(surahs, 4, (surah) =>
      fetchSurahAudio(reciter.id, surah, resolveVerseId),
    );

    const files: RecitationFileRow[] = results.map((r) => r.file);
    const timings: RecitationTimingRow[] = results.flatMap((r) => r.timings);
    const withSegments = timings.filter((t) => t.segments !== null).length;
    const hours = files.reduce((n, f) => n + f.duration_ms, 0) / 3_600_000;

    log(
      "audio",
      `${label}: ${files.length} files, ${hours.toFixed(1)}h, ` +
        `${timings.length} ayah timings (${withSegments} with word segments)`,
    );

    await upsertAll("recitation_files", files, { onConflict: "reciter_id,surah_number" });
    await upsertAll("recitation_timings", timings, {
      onConflict: "reciter_id,verse_id",
      // Segment arrays make these rows much heavier than the other seeds', so
      // the batch is smaller to keep each request a sane size.
      size: 250,
    });
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  log("done", `audio import finished in ${elapsed}s`);
}

main().catch((error) => {
  console.error("\nAudio import failed:\n", error);
  process.exit(1);
});
