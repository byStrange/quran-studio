/**
 * Vendors the QCF page fonts that mushaf mode renders with.
 *
 *   pnpm fonts:qcf
 *
 * The Madani mushaf is reproduced glyph for glyph rather than re-typeset, which
 * means one font file per page: each carries only that page's words, drawn as
 * single Private Use Area glyphs with the printed line's justification already
 * in the outlines. `quran_mushaf_glyphs` stores the codes; without these files
 * they render as tofu.
 *
 * The V1 set is what is fetched, because V1 is the glyph encoding
 * `quran_mushaf_glyphs` holds — the `code_v1` field quran.com serves. The V4
 * fonts look more attractive on paper: they carry COLRv1 colour layers with
 * tajweed-coloured and monochrome palettes, which would have made the tajweed
 * toggle a `font-palette` swap. They are not used because they do not share
 * V1's encoding. A V4 page font contains exactly one glyph per word packed
 * sequentially from U+FC41, and neither reading order nor codepoint order
 * reproduces the mapping; quran.com's public API exposes no `code_v4` field to
 * recover it from. Rendering V1 codes in a V4 font silently draws the wrong
 * words, so mushaf mode is monochrome — which is what the printed page is.
 *
 * `pnpm test:mushaf-fonts` checks every stored glyph against the font that has
 * to draw it, which is how the mismatch was caught.
 *
 * Fonts are from the King Fahd Glorious Quran Printing Complex, mirrored by
 * quran.com. Safe to re-run: files already on disk at the expected size are
 * left alone.
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, mapLimit, sleep } from "./util.ts";

const SOURCE =
  "https://raw.githubusercontent.com/quran/quran.com-frontend-next/master/public/fonts/quran";

/** V1 page fonts — the encoding `quran_mushaf_glyphs.glyph` is written in. */
const PAGE_FONT = `${SOURCE}/hafs/v1/woff2`;
/** Ornamental surah-name banners, one glyph per surah. */
const SURAH_NAMES = `${SOURCE}/surah-names/v1/sura_names.woff2`;

const TOTAL_PAGES = 604;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "public/fonts/qcf");

/** Anything smaller than this is a truncated download or an error page. */
const MIN_FONT_BYTES = 4_096;

async function download(url: string, file: string, attempts = 4): Promise<number> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "quran-studio-seed/0.1 (personal study app)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());

      // woff2 files start with the wOF2 signature; anything else means the
      // mirror served us HTML, which would fail silently as a broken @font-face.
      const signature = String.fromCharCode(...bytes.subarray(0, 4));
      if (signature !== "wOF2") {
        throw new Error(`not a woff2 file (starts with ${JSON.stringify(signature)})`);
      }
      if (bytes.byteLength < MIN_FONT_BYTES) {
        throw new Error(`only ${bytes.byteLength} bytes`);
      }

      await writeFile(file, bytes);
      return bytes.byteLength;
    } catch (error) {
      if (attempt === attempts) throw new Error(`${url}: ${String(error)}`);
      await sleep(Math.min(500 * 2 ** (attempt - 1), 8_000));
    }
  }
  throw new Error("unreachable");
}

/** True when the file is already on disk and plausibly complete. */
async function present(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size >= MIN_FONT_BYTES;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  await mkdir(outDir, { recursive: true });

  const pages = Array.from({ length: TOTAL_PAGES }, (_, i) => i + 1);
  let fetched = 0;
  let skipped = 0;

  // Six at a time: enough to finish in a minute or two, gentle enough not to
  // get throttled partway through 604 requests.
  await mapLimit(pages, 6, async (page) => {
    const file = path.join(outDir, `p${page}.woff2`);
    if (await present(file)) {
      skipped++;
      return;
    }
    await download(`${PAGE_FONT}/p${page}.woff2`, file);
    fetched++;
    if (fetched % 50 === 0) log("fonts", `downloaded ${fetched} page fonts…`);
  });

  const namesFile = path.join(outDir, "sura-names.woff2");
  if (await present(namesFile)) {
    skipped++;
  } else {
    await download(SURAH_NAMES, namesFile);
    fetched++;
  }

  const files = await readdir(outDir);
  const sizes = await Promise.all(
    files.map(async (f) => (await stat(path.join(outDir, f))).size),
  );
  const total = sizes.reduce((a, b) => a + b, 0);

  const missing = pages.filter((p) => !files.includes(`p${p}.woff2`));
  if (missing.length > 0) {
    throw new Error(`missing page fonts: ${missing.slice(0, 10).join(", ")}`);
  }

  log("fonts", `${fetched} downloaded, ${skipped} already present`);
  log(
    "fonts",
    `${files.length} files, ${(total / 1024 / 1024).toFixed(1)}MB in public/fonts/qcf`,
  );
  log("done", `fonts ready in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

main().catch((error) => {
  console.error("\nFont download failed:\n", error);
  process.exit(1);
});
