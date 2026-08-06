/**
 * Imports the Madani mushaf page layout.
 *
 *   pnpm seed:mushaf
 *
 * Separate from `pnpm seed` for the same reason the tajweed backfill is: this
 * writes two new tables and three columns, and re-running the full import to
 * get them would also rewrite the tafsir corpus and ~77k word rows that the
 * layout does not touch.
 *
 * Run `pnpm fonts:qcf` alongside this — the glyph codes it stores are only
 * legible in the QCF page fonts, and neither half is much use without the
 * other. Safe to re-run; every write is an upsert on a stable key.
 */
import { admin, upsertAll } from "./db.ts";
import { buildMushafLayout, deriveRukuPages } from "./mushaf.ts";
import { log } from "./util.ts";

/**
 * Reads a whole table in pages. PostgREST caps a response at 1,000 rows, which
 * both of these tables exceed.
 */
async function selectAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(from, from + size - 1);
    if (error) throw new Error(`select from ${table} failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < size) return rows;
  }
}

async function main(): Promise<void> {
  const started = Date.now();

  log("mushaf", "fetching page layout for 604 pages…");
  const { lines, glyphs } = await buildMushafLayout();
  log("mushaf", `${lines.length} lines, ${glyphs.length} glyphs`);

  const headings = lines.filter((l) => l.line_type !== "ayah").length;
  log("mushaf", `${headings} surah-name and basmalah lines derived from line gaps`);

  // Glyphs reference verses; a verse missing here means the content import has
  // not run, and the foreign key would fail halfway through a long write.
  log("verify", "checking every glyph's verse exists…");
  const verses = await selectAll<{ id: number; ruku_number: number }>(
    "quran_verses",
    "id,ruku_number",
    "id",
  );
  const verseRuku = new Map(verses.map((v) => [v.id, v.ruku_number]));
  const orphans = glyphs.filter((g) => !verseRuku.has(g.verse_id));
  if (orphans.length > 0) {
    throw new Error(
      `${orphans.length} glyphs reference verses that are not in the database ` +
        `(first: verse ${orphans[0]!.verse_id}). Run \`pnpm seed\` first.`,
    );
  }

  log("mushaf", "deriving ruku page ranges…");
  const rukuPages = deriveRukuPages(glyphs, verseRuku);
  log("mushaf", `${rukuPages.length} rukus mapped onto pages`);

  // Lines first: the glyph table's foreign key points at them.
  log("db", "writing mushaf lines…");
  await upsertAll("quran_mushaf_lines", lines, {
    onConflict: "page_number,line_number",
    size: 1000,
  });

  log("db", "writing mushaf glyphs…");
  await upsertAll("quran_mushaf_glyphs", glyphs, { onConflict: "id", size: 1000 });

  // Ruku rows are upserted whole: a payload of just the page columns would
  // fail the not-null columns on the insert branch of PostgREST's upsert.
  log("db", "writing ruku page ranges…");
  const rukus = await selectAll<Record<string, unknown>>(
    "quran_rukus",
    "*",
    "ruku_number",
  );
  const pagesByRuku = new Map(rukuPages.map((r) => [r.ruku_number, r]));
  const merged = rukus.map((ruku) => {
    const span = pagesByRuku.get(ruku.ruku_number as number);
    if (!span) throw new Error(`ruku ${ruku.ruku_number} has no glyphs on any page`);
    return { ...ruku, page_start: span.page_start, page_end: span.page_end };
  });
  await upsertAll("quran_rukus", merged, { onConflict: "ruku_number", size: 500 });

  log("done", `mushaf layout imported in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((error) => {
  console.error("\nMushaf layout import failed:\n", error);
  process.exit(1);
});
