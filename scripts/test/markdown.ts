/**
 * Tafsir Markdown parsing, on lines taken from the stored editions.
 *
 *   pnpm test:markdown
 *
 * Every case here is a shape that occurs in the `tafsir` table, and most are
 * ones a stock Markdown parser gets wrong for this text. No database needed.
 */
import { parseBlocks, parseInline, stripMarkdown, type InlineNode } from "../../src/lib/markdown.ts";

/** Inline nodes as `<strong>…</strong>` / `<em>…</em>` markup, for comparing. */
function show(nodes: InlineNode[]): string {
  return nodes
    .map((node) => (node.kind === "text" ? node.text : `<${node.kind}>${show(node.children)}</${node.kind}>`))
    .join("");
}

const INLINE: Array<[name: string, input: string, expected: string]> = [
  ["bold", "Ибн Аббос **дейди**.", "Ибн Аббос <strong>дейди</strong>."],
  // The Uzbek glues case endings onto the closing marker; CommonMark won't bold this.
  ["bold with suffix", "**«ғайбга ишонганлар»**дан мақсад", "<strong>«ғайбга ишонганлар»</strong>дан мақсад"],
  ["two bolds", "**«олдинги»**лар ва **«кейинги»**лар", "<strong>«олдинги»</strong>лар ва <strong>«кейинги»</strong>лар"],
  ["italic", "оятни *(Малики ёуми-д-дин)* деб", "оятни <em>(Малики ёуми-д-дин)</em> деб"],
  // `*` used as an apostrophe must not open or close an italic.
  ["apostrophe", "Абу*л-Олия ва Абу*л-Олия", "Абу*л-Олия ва Абу*л-Олия"],
  ["apostrophe at word end", "«таматту*» ҳажи", "«таматту*» ҳажи"],
  ["apostrophe after bold", "**таматту***дан", "<strong>таматту</strong>*дан"],
  ["italic then apostrophe", "*(Малики)* сўзи, Абу*л-Олия", "<em>(Малики)</em> сўзи, Абу*л-Олия"],
  ["bold inside italic", "*a **b** c*", "<em>a <strong>b</strong> c</em>"],
  // Half of a bold the source ran across paragraphs: dropped, not shown.
  ["unmatched bold opener", "**Шайхимиз шундай деган", "Шайхимиз шундай деган"],
  ["unmatched bold closer", "мажбур қилди.**", "мажбур қилди."],
  // Arabic ayah separators in the Russian edition.
  ["spaced asterisk", "عَجَباً * يَهْدِيۤ", "عَجَباً * يَهْدِيۤ"],
  ["footnote star", "Ахмад в Муснаде *1/420)", "Ахмад в Муснаде *1/420)"],
  // The English edition's brackets are prose, not links.
  ["not a link", "[of gold](each Wasaq approx. 3 kg)", "[of gold](each Wasaq approx. 3 kg)"],
];

const BLOCKS: Array<[name: string, input: string, expected: unknown]> = [
  [
    "heading, rule, bullet",
    "### Тўсиқнинг ясалиши\n\nМатн.\n\n---\n\n- \"Фотиха\" номи:",
    [
      { kind: "heading", text: "Тўсиқнинг ясалиши" },
      { kind: "paragraph", lines: ["Матн."] },
      { kind: "rule" },
      { kind: "list", items: ['"Фотиха" номи:'] },
    ],
  ],
  ["spaced rule", "Текст.\n\n* * *", [{ kind: "paragraph", lines: ["Текст."] }, { kind: "rule" }]],
  [
    // A gloss under a quoted word mid-paragraph is a line break, not a list.
    "line break, not list",
    "прокомментировал:﴾قِنْوَانٌ﴿\n- гроздья",
    [{ kind: "paragraph", lines: ["прокомментировал:﴾قِنْوَانٌ﴿", "- гроздья"] }],
  ],
  // Ayah lines stay as written rather than being renumbered by an <ol>.
  ["numbered ayah line", "41. – Матн", [{ kind: "paragraph", lines: ["41. – Матн"] }]],
];

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}\n      expected ${e}\n      got      ${a}`);
    failures.push(name);
  }
}

for (const [name, input, expected] of INLINE) check(name, show(parseInline(input)), expected);
for (const [name, input, expected] of BLOCKS) check(name, parseBlocks(input), expected);
check(
  "stripMarkdown",
  stripMarkdown("### Сарлавҳа\n\n**«ғайбга»**дан *(Малики)* Абу*л-Олия\n\n---\n\n- банд"),
  "Сарлавҳа\n\n«ғайбга»дан (Малики) Абу*л-Олия\n\nбанд",
);

const total = INLINE.length + BLOCKS.length + 1;
console.log(`\n${passed}/${total} cases passed`);
if (failures.length > 0) {
  console.log(`Failed: ${failures.join(", ")}`);
  process.exit(1);
}
