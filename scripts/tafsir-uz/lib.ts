/**
 * Shared decoding and block-splitting for the shomila.islomiy.info pages.
 *
 * Two things about the source shape drive everything here:
 *
 *  1. The pages are declared and served as windows-1251, but Uzbek Cyrillic
 *     uses letters cp1251 has no code point for (ҳ қ ғ ў and their capitals).
 *     The site emits exactly those as numeric character references, so a
 *     correct read is cp1251 *then* entity decoding — either step alone gives
 *     mojibake or holes.
 *
 *  2. The body is Word-pasted HTML: a flat run of <p>/<h2>/<h3> with no
 *     nesting, wrapped in MSO conditional comments. Flat means a regex split
 *     is not a shortcut here, it is the shape of the data.
 */
import { readFileSync } from "node:fs";

// Every named reference that actually occurs in these pages. The Latin
// accented ones are here because the Uzbek text was translated from the
// Turkish edition and keeps its bibliography — "Çağrı Yayınları" and the
// like — in the original spelling.
const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", deg: "°",
  middot: "·", bull: "•", shy: "", ensp: " ", emsp: " ", thinsp: " ",
  times: "×", minus: "−", not: "¬", sup1: "¹", sup2: "²", sup3: "³",
  Ccedil: "Ç", ccedil: "ç", acirc: "â", Acirc: "Â", icirc: "î", Icirc: "Î",
  ucirc: "û", uuml: "ü", Uuml: "Ü", ouml: "ö", Ouml: "Ö", auml: "ä",
  aacute: "á", eacute: "é", kappa: "κ", euml: "ë", agrave: "à",
  yacute: "ý", trade: "™", infin: "∞", zwnj: "",
};

/** Numeric and named references to text. Run only after tags are gone. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

export function readPage(path: string): string {
  const bytes = readFileSync(path);
  return new TextDecoder("windows-1251").decode(bytes);
}

/**
 * The commentary only. Everything before the surah title row and from the
 * "previous / next section" footer onwards is site chrome.
 */
export function contentSlice(html: string): string {
  let body = html;
  // Past the "002. Бақара сураси" heading, not up to it: left in, that
  // zero-padded number reads as an ayah line for ayah 2.
  const title = /<b>\s*\d{1,3}\.[^<]*<\/b>/i.exec(body);
  if (title) body = body.slice(title.index + title[0].length);
  const end = body.search(/<table[^>]*bgcolor="#F3F2F2"/i);
  if (end >= 0) body = body.slice(0, end);
  return body
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|xml)\b[\s\S]*?<\/\1>/gi, "");
}

export interface Block {
  /** `p`, `h2`, `h3`, … as it appeared in the source. */
  tag: string;
  /** Inner HTML, untouched, so the review UI can show the real formatting. */
  html: string;
  /** Plain text: tags stripped, entities decoded, whitespace collapsed. */
  text: string;
  /** The whole block sits inside <strong>/<b> — how ayah lines are marked. */
  emphasised: boolean;
}

export function toText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    // A few paragraphs carry markup that was escaped twice on its way in —
    // "&amp;lt;/b>" in the source — so it only turns back into a tag after
    // the entities are decoded, and the tag it turns into has to be swept up
    // afterwards. Two rounds covers every case in this book.
    .replace(/&(lt|gt|amp);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/<\/?[a-z][a-z0-9]{0,9}\s*\/?>/gi, "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function blocksOf(content: string): Block[] {
  const out: Block[] = [];
  const re = /<(p|h[1-6]|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of content.matchAll(re)) {
    const tag = (m[1] ?? "p").toLowerCase();
    const html = m[2] ?? "";
    const text = toText(html);
    if (!text) continue;
    // "Emphasised" means the emphasis wraps the block, not a phrase inside it:
    // commentary is full of inline <strong> quotes, ayah lines are bold whole.
    const stripped = toText(html.replace(/<(strong|b)\b[^>]*>[\s\S]*?<\/\1>/gi, ""));
    out.push({ tag, html, text, emphasised: stripped === "" });
  }
  return out;
}
