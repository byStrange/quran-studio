/**
 * Checks that every stored glyph exists in the page font that must draw it.
 *
 *   pnpm test:mushaf-fonts
 *
 * Mushaf mode stores Private Use Area codepoints and renders them in a
 * per-page font. Nothing about that pairing is self-checking: a glyph code
 * absent from the font draws tofu, and — worse — a code present in a *different*
 * font's encoding draws a real but wrong word, silently. This caught exactly
 * that during development, when the V4 colour fonts were vendored against V1
 * glyph codes.
 *
 * Reads the woff2 files directly rather than through a browser, so it needs no
 * display and runs in CI. Requires Supabase credentials, since the glyphs come
 * from the imported layout.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admin } from "../seed/db.ts";
import { log } from "../seed/util.ts";

const TOTAL_PAGES = 604;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fontDir = path.join(root, "public/fonts/qcf");

/**
 * The set of codepoints a woff2 file can draw.
 *
 * woff2 stores its tables Brotli-compressed, so the cmap cannot be read
 * without decompressing. Node ships Brotli, and the woff2 table directory is
 * simple enough to walk directly, which avoids a font-parsing dependency for
 * one lookup.
 */
async function readCmap(file: string): Promise<Set<number>> {
  const { brotliDecompressSync } = await import("node:zlib");
  const buf = await readFile(file);
  if (buf.toString("ascii", 0, 4) !== "wOF2") throw new Error(`${file} is not woff2`);

  const numTables = buf.readUInt16BE(12);
  let offset = 48;
  let cmapOffset = -1;
  let cmapLength = -1;
  let running = 0;

  // Known-table tags, indexed by the low 6 bits of each entry's flag byte.
  const TAGS = [
    "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
    "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
    "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
    "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
    "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
    "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
    "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
    "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
  ];

  const readBase128 = (): number => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf.readUInt8(offset++);
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("malformed UIntBase128");
  };

  for (let i = 0; i < numTables; i++) {
    const flags = buf.readUInt8(offset++);
    const index = flags & 0x3f;
    let tag: string;
    if (index === 0x3f) {
      tag = buf.toString("ascii", offset, offset + 4);
      offset += 4;
    } else {
      tag = TAGS[index] ?? "????";
    }
    const originalLength = readBase128();
    const transformVersion = (flags >> 6) & 0x03;
    // glyf/loca use transform 0 to mean "transformed"; everything else uses 3.
    const transformed = tag === "glyf" || tag === "loca" ? transformVersion === 0 : transformVersion !== 0;
    const length = transformed ? readBase128() : originalLength;

    if (tag === "cmap") {
      cmapOffset = running;
      cmapLength = originalLength;
    }
    running += length;
  }
  if (cmapOffset < 0) throw new Error(`${file} has no cmap table`);

  const font = Buffer.from(brotliDecompressSync(buf.subarray(offset)));
  const cmap = font.subarray(cmapOffset, cmapOffset + cmapLength);

  // Walk the encoding records for a format 4 or format 12 subtable.
  const codepoints = new Set<number>();
  const numSubtables = cmap.readUInt16BE(2);
  for (let i = 0; i < numSubtables; i++) {
    const sub = cmap.readUInt32BE(8 + i * 8);
    const format = cmap.readUInt16BE(sub);

    if (format === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6);
      const ends = sub + 14;
      const starts = ends + segX2 + 2;
      const deltas = starts + segX2;
      const ranges = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const end = cmap.readUInt16BE(ends + s * 2);
        const start = cmap.readUInt16BE(starts + s * 2);
        if (start === 0xffff) continue;
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangeOffset = cmap.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end; c++) {
          let glyph: number;
          if (rangeOffset === 0) {
            glyph = (c + delta) & 0xffff;
          } else {
            const at = ranges + s * 2 + rangeOffset + (c - start) * 2;
            if (at + 1 >= cmap.length) continue;
            glyph = cmap.readUInt16BE(at);
            if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph !== 0) codepoints.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const start = cmap.readUInt32BE(at);
        const end = cmap.readUInt32BE(at + 4);
        for (let c = start; c <= end; c++) codepoints.add(c);
      }
    }
  }
  return codepoints;
}

async function main(): Promise<void> {
  log("fonts", "loading stored glyphs…");
  const byPage = new Map<number, Set<string>>();
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await admin
      .from("quran_mushaf_glyphs")
      .select("page_number,glyph")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const page = row.page_number as number;
      let set = byPage.get(page);
      if (!set) byPage.set(page, (set = new Set()));
      for (const char of row.glyph as string) set.add(char);
    }
    if (!data || data.length < size) break;
  }
  log("fonts", `${byPage.size} pages of glyphs`);

  const problems: string[] = [];
  let checked = 0;
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const wanted = byPage.get(page);
    if (!wanted) {
      problems.push(`page ${page}: no glyphs stored`);
      continue;
    }
    const cmap = await readCmap(path.join(fontDir, `p${page}.woff2`));
    const missing = [...wanted].filter((char) => !cmap.has(char.codePointAt(0)!));
    if (missing.length > 0) {
      const sample = missing.slice(0, 5).map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`);
      problems.push(
        `page ${page}: ${missing.length}/${wanted.size} glyphs missing from p${page}.woff2 (${sample.join(" ")})`,
      );
    }
    checked += wanted.size;
    if (page % 100 === 0) log("fonts", `checked ${page}/${TOTAL_PAGES} pages`);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} pages failed:\n` + problems.slice(0, 15).join("\n"));
    process.exit(1);
  }
  log("fonts", `all ${TOTAL_PAGES} pages OK — ${checked} glyph references all resolve`);
}

main().catch((error) => {
  console.error("\nFont check failed:\n", error);
  process.exit(1);
});
