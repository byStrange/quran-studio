/**
 * The small slice of Markdown that tafsir text actually uses.
 *
 * The Uzbek Ibn Kathir is stored with `### headings`, `**bold**`, `*italic*`,
 * `- ` bullets and `---` rules; the Russian editions use `* * *` between
 * sections and single line breaks to set a quoted ayah on its own line; the
 * rest is plain prose. One parser covers all of them, so no edition has to be
 * flagged as "Markdown".
 *
 * It is deliberately not CommonMark. The Uzbek text glues suffixes straight
 * onto bold words — `**«кейинги»**лардан` — which CommonMark refuses to treat
 * as bold, and it uses `*` as an apostrophe in names like `Абу*л-Олия`, which
 * a looser reading would turn into italics. Links are not parsed either: the
 * English edition has `[of gold](each Wasaq approx. 3 kg)`, which is prose.
 *
 * Blocks are split on blank lines exactly like `toParagraphs`, one block per
 * chunk, so a block's index still identifies the same stretch of text.
 */

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: InlineNode[] }
  | { kind: "em"; children: InlineNode[] };

export type MarkdownBlock =
  | { kind: "heading"; text: string }
  | { kind: "rule" }
  | { kind: "list"; items: string[] }
  /** Lines kept apart: a break inside a paragraph is meant as one. */
  | { kind: "paragraph"; lines: string[] };

const HEADING = /^#{1,6}\s+(.*)$/;
/** `---`, `***`, `* * *`, `___`: three or more of one mark and nothing else. */
const RULE = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const BULLET = /^[-*•]\s+(.*)$/;

export function parseBlocks(text: string): MarkdownBlock[] {
  return text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(parseBlock);
}

function parseBlock(chunk: string): MarkdownBlock {
  if (RULE.test(chunk)) return { kind: "rule" };

  const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines.length === 1 ? HEADING.exec(lines[0]!) : null;
  if (heading) return { kind: "heading", text: heading[1]!.replace(/\s+#+$/, "") };

  // Only a chunk that is bullets throughout is a list. The Russian Ibn Kathir
  // has a `- ` gloss under a quoted word mid-paragraph, which is not one.
  const bullets = lines.map((line) => BULLET.exec(line));
  if (bullets.every(Boolean)) return { kind: "list", items: bullets.map((match) => match![1]!) };

  return { kind: "paragraph", lines };
}

/** Is `char` a letter or digit, in any script? */
function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/.test(char);
}

/**
 * Where the emphasis opened at `open` closes, or -1.
 *
 * Bold is permissive about what follows its closing `**`, because the Uzbek
 * text attaches case endings there. A single `*` is held to more: it may not
 * open after a letter (`Абу*л`), and may close before one only after
 * punctuation, so an apostrophe later in the line can't close an italic.
 */
function findClose(text: string, open: number, marker: "**" | "*"): number {
  const start = open + marker.length;
  if (isSpace(text[start])) return -1;
  if (marker === "*" && isWordChar(text[open - 1])) return -1;

  for (let at = text.indexOf(marker, start + 1); at !== -1; at = text.indexOf(marker, at + 1)) {
    if (isSpace(text[at - 1])) continue;
    if (marker === "*") {
      // `**` inside an italic is bold, not the end of the italic.
      if (text[at + 1] === "*" || text[at - 1] === "*") continue;
      if (isWordChar(text[at + 1]) && isWordChar(text[at - 1])) continue;
    }
    return at;
  }
  return -1;
}

export function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let plain = "";
  let at = 0;

  while (at < text.length) {
    if (text[at] === "*") {
      const marker = text[at + 1] === "*" ? "**" : "*";
      const close = findClose(text, at, marker);
      if (close !== -1) {
        if (plain) nodes.push({ kind: "text", text: plain });
        plain = "";
        const children = parseInline(text.slice(at + marker.length, close));
        nodes.push({ kind: marker === "**" ? "strong" : "em", children });
        at = close + marker.length;
        continue;
      }
      // A lone `*` is an apostrophe (`таматту*`) and stays. A lone `**` is
      // half of a bold the source ran over several paragraphs; it is dropped
      // rather than carried over, since one stray `**` would otherwise bold
      // dozens of paragraphs after it.
      if (marker === "*") plain += marker;
      at += marker.length;
      continue;
    }
    plain += text[at];
    at++;
  }

  if (plain) nodes.push({ kind: "text", text: plain });
  return nodes;
}

function inlineText(nodes: InlineNode[]): string {
  return nodes.map((node) => (node.kind === "text" ? node.text : inlineText(node.children))).join("");
}

/** A block's words without the markup, for searching it. */
export function blockText(block: MarkdownBlock): string {
  switch (block.kind) {
    case "heading":
      return inlineText(parseInline(block.text));
    case "rule":
      return "";
    case "list":
      return block.items.map((item) => inlineText(parseInline(item))).join("\n");
    case "paragraph":
      return block.lines.map((line) => inlineText(parseInline(line))).join("\n");
  }
}

/**
 * The text with the markup taken out and the paragraphs kept, for where it is
 * shown or quoted as plain prose. Rules are dropped; headings and bullets
 * become ordinary paragraphs.
 */
export function stripMarkdown(text: string): string {
  return parseBlocks(text)
    .map(blockText)
    .filter(Boolean)
    .join("\n\n");
}
