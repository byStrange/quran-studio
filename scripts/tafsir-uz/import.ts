/**
 * Writes the parsed segments into the `tafsir` table as a new edition.
 *
 *   pnpm tafsir:uz:parse && pnpm tafsir:uz:import
 *   pnpm tafsir:uz:import --dry            # counts only, no writes
 *   pnpm tafsir:uz:import --allow-gaps     # import surahs that are incomplete
 *
 * Safe to re-run: every row is an upsert keyed on
 * (edition, surah_number, ayah_start), matching the table's unique
 * constraint, so a corrected surah overwrites its old rows rather than
 * doubling them.
 *
 * By default a surah whose segments do not cover all of its ayahs is skipped
 * and named, because a half-imported surah reads in the app as though the
 * missing ayahs simply have no commentary. Finish it in the review desk, or
 * pass --allow-gaps if partial is what you want for now.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { admin, upsertAll } from "../seed/db.ts";
import { log } from "../seed/util.ts";
import { AYAH_COUNTS } from "./ayah-counts.ts";
import type { ParsedSurah } from "./parse.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export const UZ_IBN_KATHIR = {
  slug: "uz-tafsir-ibn-kathir",
  name: "Ибн Касир",
  author_name: "Ҳофиз Ибн Касир",
  language_code: "uz",
  language_name: "Ўзбекча",
  sort_order: 4,
} as const;

interface Row {
  edition: string;
  surah_number: number;
  ayah_start: number;
  ayah_end: number;
  content: string;
}

/**
 * One segment becomes one row: the commentary as the book prints it, with the
 * section titles it uses kept in place as headings. They are how a reader
 * finds their bearings in a passage that can run twenty paragraphs.
 */
function render(segment: ParsedSurah["segments"][number]): string {
  return segment.body
    .map((b) => (b.kind === "heading" ? `### ${b.text}` : b.text))
    .join("\n\n")
    .trim();
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const allowGaps = process.argv.includes("--allow-gaps");

  const rows: Row[] = [];
  const skipped: string[] = [];
  const partial: string[] = [];
  let surahs = 0;

  for (let n = 1; n <= 114; n++) {
    const file = join(HERE, "out", `${String(n).padStart(3, "0")}.json`);
    if (!existsSync(file)) {
      skipped.push(`${n}: not parsed`);
      continue;
    }
    const parsed: ParsedSurah = JSON.parse(readFileSync(file, "utf8"));

    // Coverage is measured on the rows this actually produces, not on the
    // segments it started from. A segment that renders to nothing writes no
    // row, and counting segments would call the surah complete while an ayah
    // quietly had nothing behind it.
    const ours: Row[] = [];
    const covered = new Set<number>();
    for (const s of parsed.segments) {
      const content = render(s);
      if (!content) continue;
      ours.push({
        edition: UZ_IBN_KATHIR.slug,
        surah_number: n,
        ayah_start: s.ayah_start,
        ayah_end: s.ayah_end,
        content,
      });
      for (let a = s.ayah_start; a <= s.ayah_end; a++) covered.add(a);
    }

    if (covered.size !== AYAH_COUNTS[n] && !allowGaps) {
      skipped.push(`${n}: ${covered.size}/${AYAH_COUNTS[n]} ayahs covered`);
      continue;
    }
    // A surah with nothing behind it is not a surah imported, whatever
    // --allow-gaps was willing to let through.
    if (!ours.length) {
      skipped.push(`${n}: nothing parsed for it`);
      continue;
    }
    if (covered.size !== AYAH_COUNTS[n])
      partial.push(`${n}: ${covered.size}/${AYAH_COUNTS[n]} ayahs`);
    surahs++;
    rows.push(...ours);
  }

  const ayahs = rows.reduce((n, r) => n + (r.ayah_end - r.ayah_start + 1), 0);
  console.log(`${rows.length} rows from ${surahs} surahs, covering ${ayahs} ayahs`);
  if (partial.length) {
    console.log(`\n${partial.length} surah(s) going in incomplete:`);
    for (const p of partial) console.log(`  ${p}`);
  }
  if (skipped.length) {
    console.log(`\nskipped ${skipped.length} surah(s) — finish them in the review desk:`);
    for (const s of skipped) console.log(`  ${s}`);
  }
  // Overlapping ranges would give the reader two rows for one ayah, and its
  // lookup expects at most one. Cheaper to catch here than in the app.
  const overlaps: string[] = [];
  const bySurah = new Map<number, Row[]>();
  for (const r of rows) bySurah.set(r.surah_number, [...(bySurah.get(r.surah_number) ?? []), r]);
  for (const [n, group] of bySurah) {
    const sorted = [...group].sort((a, b) => a.ayah_start - b.ayah_start);
    for (const [i, r] of sorted.entries()) {
      const prev = sorted[i - 1];
      if (prev && r.ayah_start <= prev.ayah_end)
        overlaps.push(`${n}:${prev.ayah_start}-${prev.ayah_end} and ${n}:${r.ayah_start}-${r.ayah_end}`);
    }
  }
  if (overlaps.length) {
    throw new Error(`overlapping ayah ranges, nothing written:\n  ${overlaps.join("\n  ")}`);
  }

  if (dry) return console.log("\n--dry: nothing written");
  if (!rows.length) return;

  await upsertAll("tafsir_editions", [UZ_IBN_KATHIR], { onConflict: "slug" });

  // Replace each surah rather than upserting over it. Re-segmenting a surah
  // moves its boundaries — an ayah that opened its own row can end up inside
  // its neighbour's — and an upsert keyed on ayah_start would write the new
  // row while leaving the old one behind, so the reader would find two rows
  // covering one ayah. Only surahs being rewritten are touched; a surah
  // skipped for gaps keeps whatever it already has.
  const writing = [...bySurah.keys()].sort((a, b) => a - b);
  const { error: clearError } = await admin
    .from("tafsir")
    .delete()
    .eq("edition", UZ_IBN_KATHIR.slug)
    .in("surah_number", writing);
  if (clearError) throw new Error(`clearing old rows failed: ${clearError.message}`);
  log("db", `cleared previous rows for ${writing.length} surah(s)`);

  await upsertAll("tafsir", rows, {
    onConflict: "edition,surah_number,ayah_start",
    size: 200,
  });
  console.log("\ndone");
}

main().catch((error) => {
  console.error("\nUzbek tafsir import failed:\n", error);
  process.exit(1);
});
