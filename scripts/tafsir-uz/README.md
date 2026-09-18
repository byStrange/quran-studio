# Ibn Kathir in Uzbek — from shomila.islomiy.info into `tafsir`

The complete Uzbek translation of Ibn Kathir's tafsir is published at
[shomila.islomiy.info](https://shomila.islomiy.info/index.php?act=book&sec=81&b_id=178)
as book 178 of the Shomil library. This directory turns it into rows of the
`tafsir` table, keyed by ayah range, so the reader can answer "what does Ibn
Kathir say about this ayah" in Uzbek the way it already can in English and
Russian.

## What the source is

    index.php?act=book&sec=81&b_id=178            the book, 116 sections
    index.php?act=book&sec=81&b_id=178&s_id=NNNN  one section

The 116 sections are an introduction, one section per surah in order, and a
closing note about the edition; `sections.tsv` is that index, scraped once.
**A surah is a single page** — Baqara is a 6 MB one — and the pages carry no
per-ayah URLs, anchors or ids. Nothing in the markup says which ayah a
paragraph belongs to. Everything below is about recovering that.

Three properties of the pages matter:

- **Encoding.** Served as windows-1251, but Uzbek Cyrillic needs ҳ қ ғ ў,
  which cp1251 cannot encode, so those letters arrive as `&#1203;`-style
  references. Reading the page is cp1251 *then* entity decoding; either step
  alone gives mojibake or holes.
- **Markup.** Word-pasted HTML — a flat run of `<p>` and `<h2>`/`<h3>`, no
  nesting, no classes, wrapped in MSO conditional comments.
- **Provenance.** The Uzbek was translated from the Turkish edition (Çağrı
  Yayınları) and keeps its footnotes: `[12]` markers in the prose and blocks
  of Turkish citations at the end of each uploaded part. `parse.ts` drops
  both.

## The pattern that makes it work

The book prints each ayah as its own paragraph, the translation prefixed with
its number, and then comments on it until the next such line:

    2- Мана бу китоб, унда ҳеч қандай шубҳа йўқ, тақводорлар учун ҳидоятдир.
    Ибн Журайж, Ибн Аббоснинг «Мана бу китоб» ифодаси «шу китоб» деган…
    Араблар бу икки ишора исмини бир-бирининг ўрнига ишлатадилар…

So a segment is: one or more consecutive numbered lines, then everything up
to the next numbered line. Consecutive lines group because the book prints,
say, 8 and 9 together and comments on both at once; where the numbering jumps,
the segment's range stretches over the skipped ayahs, because that commentary
is all the reader has for them.

The typesetting is not consistent between surahs — `1-`, `8 —`, `1.` and
`41. –` all occur, sometimes two of them in one surah, and only some surahs
set the ayah line in bold — so the parser measures each surah's own house
style rather than assuming one.

A bare number is not enough on its own: the commentary quotes numbered lists
too. The anchors are chosen as the **longest chain of candidates whose ayah
numbers only ever move forward**, weighted towards lines typeset like the rest
of that surah's ayah lines. Picking the chain rather than taking candidates
greedily is what stops one stray number early in a page from swallowing the
surah below it.

**This recovers 6,096 of 6,236 ayahs unattended, in 106 of 114 surahs.** The
eight it cannot do are surahs where the book never numbers the ayahs at all
and instead quotes each one inside the commentary — 44, 51, 71, 75, 83, 94,
106, 110. Those are hand-anchored in the review desk.

## Working through it

```sh
pnpm tafsir:uz:fetch     # download the 116 pages into raw/ (~76 MB, resumable)
pnpm tafsir:uz:parse     # raw/ → out/NNN.json + out/report.txt
pnpm tafsir:uz:review    # http://localhost:5178 — fix what the parse flagged
pnpm tafsir:uz:import    # out/ → the tafsir table, as edition uz-tafsir-ibn-kathir
```

### What a passage is

A **passage** (a *segment* in the code) is one row of the `tafsir` table: a
stretch of commentary plus the ayah range it belongs to. "Commentary on 2:255"
is one; "commentary on 18:1–5" is another. The whole job is making sure every
ayah is inside one.

### What the review desk asks of you

It sorts the surahs into three groups, and only the first two want anything.

**Needs anchoring** — 44, 51, 71, 75, 83, 94, 106, 110. These never print ayah
numbers, so nothing could be matched automatically and every ayah in them is
unattached. Read down the commentary; it quotes each ayah as it reaches it,
usually in «guillemets». Where the commentary on an ayah begins, click `＋` in
that paragraph's gutter and type the number (or `12-15` for a run). A passage
runs until the next anchor, so you only ever mark the starts.

**Worth a look** — a line here starts with a number but is typeset unlike the
rest of that surah's ayah lines, so it might be a numbered list inside the
commentary rather than an ayah. Those lines are highlighted, with the reason
under them, and "Jump to next flag" walks them. Read each: if it is the ayah's
translation, leave it; if not, `×` drops it and the passage above extends over
it. As of the first pass all fifteen of these are genuine ayah lines — the
flag is deliberately quick to raise.

**Done** — nothing to do.

Saving writes `overrides/NNN.json`, which `parse.ts` reads on its next run, so
re-parsing never costs you the work. The overrides are committed; `raw/` and
`out/` are not, both being reproducible from the two commands above.
`out/report.txt` is the same worklist as plain text, if you would rather read
it than click through it.

### Importing

`import.ts` skips any surah whose rows do not cover all of its ayahs and names
it, because a half-imported surah reads in the app as though the missing ayahs
simply have no commentary. `--allow-gaps` overrides that; `--dry` counts
without writing.

Coverage is measured on the rows it produces, not on the segments it started
from — a segment that renders to nothing writes no row, and counting segments
would call a surah complete while an ayah quietly had nothing behind it.
It also refuses to write at all if any two rows of a surah overlap, since the
reader's lookup expects at most one row per ayah.

A surah being written is **replaced**, not upserted over. Re-segmenting moves
boundaries — an ayah that had its own row can end up inside its neighbour's —
and an upsert keyed on `ayah_start` would add the new row while leaving the
old one behind, giving the reader two rows for one ayah. Surahs not being
written are untouched.

Surahs that produce no rows at all are skipped whatever the flag says, and
any going in incomplete are named, so `--allow-gaps` never hides what it let
through.

Currently imported with `--allow-gaps`: **1,814 rows across 109 surahs, 6,096
of 6,236 ayahs.** 106 of those surahs are complete; 44, 51 and 83 hold the
part the book numbered (22/59, 46/60 and 30/36 ayahs) and nothing for the
rest; 71, 75, 94, 106 and 110 are absent entirely. Those 140 ayahs are the
remaining work, and it is all in the review desk.

Note that `pnpm seed:verify` checks that every registered edition covers all
114 surahs, so it will report this edition as incomplete until the last eight
are anchored. That is the check doing its job.

The edition is deliberately **not** listed in `scripts/seed/sources.ts`:
`TAFSIR_EDITIONS` is the set of editions fetched from the upstream API, and
this one has no upstream. `import.ts` writes its own `tafsir_editions` row.

## Files

    sections.tsv     the book index: s_id, surah, title
    fetch.sh         downloads the pages, skipping what is already on disk
    lib.ts           decoding and block-splitting
    ayah-counts.ts   ayahs per surah, to bound and check the ranges
    parse.ts         anchoring and segmentation → out/
    review.ts        the review desk's server
    review.html      the review desk
    import.ts        out/ → Supabase
    overrides/       hand-placed anchors (committed)
    raw/, out/       working files (gitignored, regenerable)
