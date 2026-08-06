/**
 * Verifies the Madani layout derivation against all 604 pages.
 *
 *   pnpm test:mushaf
 *
 * Talks to quran.com (cached under scripts/seed/.cache) but never to Supabase,
 * so it can be run before the layout has been imported.
 */
import { buildMushafLayout, LINES_PER_PAGE, TOTAL_PAGES } from "../seed/mushaf.ts";
import { log } from "../seed/util.ts";

async function main() {
  const { lines, glyphs } = await buildMushafLayout();

  const byType = new Map<string, number>();
  for (const line of lines) byType.set(line.line_type, (byType.get(line.line_type) ?? 0) + 1);

  log("check", `${lines.length} lines over ${TOTAL_PAGES} pages, ${glyphs.length} glyphs`);
  for (const [type, count] of [...byType].sort()) log("check", `  ${type}: ${count}`);

  // Every page must be complete, and every ayah line must actually carry glyphs.
  const glyphLines = new Set(glyphs.map((g) => `${g.page_number}:${g.line_number}`));
  const problems: string[] = [];
  for (const line of lines) {
    const key = `${line.page_number}:${line.line_number}`;
    const hasGlyphs = glyphLines.has(key);
    if (line.line_type === "ayah" && !hasGlyphs) problems.push(`${key} is an ayah line with no glyphs`);
    if (line.line_type !== "ayah" && hasGlyphs) problems.push(`${key} is ${line.line_type} but carries glyphs`);
  }
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    const n = lines.filter((l) => l.page_number === p).length;
    if (n !== LINES_PER_PAGE) problems.push(`page ${p} has ${n} lines`);
  }

  if (problems.length) {
    console.error(`\n${problems.length} problems:\n` + problems.slice(0, 20).join("\n"));
    process.exit(1);
  }
  log("check", "layout is consistent");
}

main().catch((e) => { console.error("\nMushaf check failed:\n", e); process.exit(1); });
