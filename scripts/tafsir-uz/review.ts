/**
 * A local review desk for the parse.
 *
 *   pnpm tafsir:uz:review        # then open http://localhost:5178
 *
 * Most surahs number their ayahs and the parser handles them unattended. A
 * handful comment on ayahs without ever numbering them — there the anchors
 * have to be placed by eye, and this is where that is done: the page shows
 * every paragraph of the surah as the parser sees it, and clicking one says
 * "an ayah starts here". Corrections are saved to overrides/NNN.json, which
 * parse.ts reads on its next run, so re-parsing never undoes this work.
 *
 * No dependencies and no build step: node's own http server, one HTML file.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AYAH_COUNTS } from "./ayah-counts.ts";
import { blocksOf, contentSlice, readPage } from "./lib.ts";
import { parseSurah, type Overrides } from "./parse.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5178);

function sections() {
  return readFileSync(join(HERE, "sections.tsv"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [sId = "", slug = "", title = ""] = l.split("\t");
      return { sId, slug, title, surah: Number(slug) };
    })
    .filter((s) => s.surah >= 1 && s.surah <= 114 && existsSync(join(HERE, "raw", `${s.slug}.html`)));
}

function overridesFor(slug: string): Overrides {
  const file = join(HERE, "overrides", `${slug}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** Blocks, plus which ayah range each one ended up in. */
function surahView(slug: string) {
  const meta = sections().find((s) => s.slug === slug);
  if (!meta) throw new Error(`no downloaded page for surah ${slug}`);
  const html = readPage(join(HERE, "raw", `${slug}.html`));
  const overrides = overridesFor(slug);
  const parsed = parseSurah(html, meta.surah, meta.title, meta.sId, overrides);
  const blocks = blocksOf(contentSlice(html)).map((b, i) => ({
    i,
    tag: b.tag,
    emphasised: b.emphasised,
    text: b.text,
  }));
  return { meta, overrides, parsed, blocks, ayah_count: AYAH_COUNTS[meta.surah] ?? 0 };
}

function index() {
  return sections().map((s) => {
    const { parsed } = surahView(s.slug);
    const seen = new Set<number>();
    for (const seg of parsed.segments)
      for (let a = seg.ayah_start; a <= seg.ayah_end; a++) seen.add(a);
    return {
      slug: s.slug,
      surah: s.surah,
      title: s.title,
      segments: parsed.segments.length,
      covered: seen.size,
      ayah_count: parsed.ayah_count,
      low: parsed.segments.filter((x) => x.confidence === "low").length,
      issues: parsed.issues,
      edited: Object.keys(overridesFor(s.slug)).length > 0,
    };
  });
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const send = (code: number, body: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": `${type}; charset=utf-8` });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  if (url.pathname === "/") return send(200, readFileSync(join(HERE, "review.html"), "utf8"), "text/html");
  if (url.pathname === "/api/index") return send(200, index());

  const match = /^\/api\/surah\/(\d{3})$/.exec(url.pathname);
  if (match?.[1]) {
    const slug = match[1];
    if (req.method === "GET") return send(200, surahView(slug));
    if (req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        mkdirSync(join(HERE, "overrides"), { recursive: true });
        writeFileSync(join(HERE, "overrides", `${slug}.json`), JSON.stringify(JSON.parse(body), null, 2) + "\n");
        send(200, surahView(slug));
      });
      return;
    }
  }
  send(404, { error: "not found" });
}).listen(PORT, () => {
  console.log(`tafsir review desk → http://localhost:${PORT}`);
});
