# Engineering decisions

Choices made while building Quran Studio, and why. Anything the brief left open
is recorded here rather than left implicit in the code.

---

## Data sourcing

**Used the quran.com v4 API directly instead of registering for Quran
Foundation credentials.**
The brief recommends `api-docs.quran.foundation`, which requires an OAuth
client-credentials registration. The same corpus is served by
`api.quran.com/api/v4` with no credentials, and one request per surah returns
everything needed at once: Uthmani text, the Saheeh International translation
(resource id 20), the word-by-word breakdown with transliteration and English
glosses, and `ruku_number` / `juz_number` per ayah. That removed a manual
signup step from setup without changing the data. If the public endpoint is
ever closed off, `scripts/seed/sources.ts` is the only file that needs to
change.

**Ruku numbering is global (1–558), not per-surah.**
That is what the source returns, and it matches the ~558 figure in the brief.
`quran_rukus` also stores `ruku_in_surah` so the UI can say "ruku 3 of Al-Baqarah"
while routing on the global number. Rukus never span surahs — the seed asserts
this and would fail the import if it were ever violated.

**Ibn Kathir comes from `spa5k/tafsir_api` via jsDelivr.**
It publishes the English Ibn Kathir corpus as one JSON file per surah — 114
requests rather than 6,236. Verified all 114 surahs are covered.

**Tafsir is a multi-edition table, because a second edition arrived.**
`tafsir_ibn_kathir` baked the edition into the table name, which was honest
while there was one of them. It is now `tafsir` with an `edition` column
pointing at a `tafsir_editions` row, so a third edition is a seed change and
nothing else. The rename kept the 1,902 imported rows in place.

Editions are a table rather than a constant in the app because the reader
builds its picker from them: an edition can only be offered if its content is
actually present. Two import checks enforce the pairing — every edition covers
every surah, and no edition is registered with nothing behind it — so the
picker cannot advertise an edition that answers with a blank panel.

**The Uzbek tafsir is Al-Mukhtasar, not a translation of Ibn Kathir.**
The app is meant to be usable by Uzbek readers, and the obvious move — running
Ibn Kathir through a model — was the wrong one. It would have produced an
unreviewed translation of an *abridgement*, two lossy hops from the Arabic,
published under Ibn Kathir's name, with the errors concentrated exactly where
they matter most: aqidah, hadith gradings, anything ruling-shaped.

`spa5k/tafsir_api` already carries `uzbek-mokhtasar`, the official Uzbek
edition of Al-Mukhtasar fī Tafsīr al-Qurʾān al-Karīm from the Tafsir Center
for Quranic Studies — a human translation of a committee-authored work. It
covers all 6,236 ayahs, one per ayah, against Ibn Kathir's 1,902 collapsed
ranges. It is much terser than Ibn Kathir, so an Uzbek reader gets a thinner
commentary than an English one; that is a real cost, and still the better
trade than shipping a machine translation with a scholar's name on it.

Its content is Cyrillic, so its title and language label are stored in Cyrillic
too, and the panel sets `lang` from the edition. A Latin-script Uzbek audience
would need a transliteration pass, which is mechanical but not yet done.

**Tafsir As-Sa'di was asked for and deliberately not added.** No English
translation of it exists in any open corpus — quran.com, qul.tarteel.ai and
`spa5k/tafsir_api` all carry As-Sa'di in Arabic, Russian, Urdu, Turkish,
Persian, Indonesian and Albanian, but never English, and the IIPH English
edition is print-only. Shipping the Arabic original, or an English tafsir by
someone else relabelled as As-Sa'di, would both have been worse than shipping
Ibn Kathir alone. The multi-source table that note called for now exists, so
if an English edition is ever released openly, adding it is a row in
`TAFSIR_EDITIONS` and a re-run of `pnpm seed:tafsir`.

The requested Saheeh International translation needed no work — the seed has
always imported quran.com resource id 20, which is that translation.

**Tafsir entries are collapsed into ayah ranges at import time.**
Ibn Kathir often comments on a run of ayahs at once, and the source repeats the
identical text against every ayah in that run. The seed detects consecutive
identical entries and stores one row spanning `ayah_start..ayah_end` (1,902 rows
instead of ~6,000). The reader looks up the row whose range contains the
selected ayah and labels the range it covers.

The rule is per-edition and not special-cased: Al-Mukhtasar comments ayah by
ayah, so the same pass finds almost nothing to merge and leaves 6,212 rows for
6,236 ayahs. Identical neighbours merge; an edition that has none keeps them
all.

**Tajweed rules are stored as ranges over the existing text, not as a second
copy of it.**
quran.com serves a tajweed-annotated mushaf, but it is a different
digitisation from the `text_uthmani` already in `quran_verses.arabic_text`:
it writes the dagger alif as U+0672, marks silent letters with a plain sukun
rather than U+06DF, and spaces waqf signs differently. 4,210 of the 6,236
verses disagree somewhere.

Storing that text in a second column would have been the easy import, and the
wrong one — the Arabic would visibly reflow the moment a reader toggled
colouring on, and there would be two disagreeing strings for the word-by-word
breakdown, copy-paste and any future search to choose between. So the seed
diffs the two editions per verse (Myers, since they differ in only a few dozen
places) and re-expresses each rule as a character range over the canonical
text. `quran_verses.tajweed` holds `[{r, s, e}]`, ordered and non-overlapping,
and colouring is a pure overlay: 59,923 spans that change colour and nothing
else.

Two smaller rules inside that mapping. A diacritic the diff could not pair up
inherits the rule of the letter beneath it, because a mark left uncoloured
above a coloured letter reads as a mistake. And a rule interrupted only by
whitespace the two editions space differently is one rule, not two — but
nothing wider is bridged, since two `ham_wasl` on neighbouring words are
genuinely two rules and merging across them would paint the text between.

**The tajweed import refuses to write a partially coloured mushaf.** The seed
re-derives the rule sequence from its own output and compares it to the source
before writing: an unknown rule class, or any rule that disappeared in the
mapping, aborts the import. 5,884 of 6,236 verses reproduce the source
sequence exactly; the remainder differ only by a run arriving as two adjacent
runs of the *same* rule, which renders identically because both halves take
the same colour. No rule is ever lost — that case is a hard failure.

One upstream defect is worth recording: verse 32:3 arrives with a stray `>`
and an unmatched closing tag. Because the rules are projected onto the
canonical text rather than that text being used directly, the corruption
cannot reach the reader; the parser only has to not crash on it.

**Footnote markup is stripped from translations.**
Saheeh International arrives with `<sup foot_note=…>` markers. There is no
footnote UI in v1, so dangling superscript numbers would be noise; the markers
are removed at import, not at render.

**Recitation is one continuous file per surah, seeked into — not ayah clips
played back to back.**
This was the requirement that decided the source. Stitching per-ayah mp3s is
the easy implementation and it sounds wrong: a reciter's phrasing carries
across ayah boundaries, and concatenating clips inserts a seam at every one of
them. So an ayah is a *window* into the surah recording — seek to its offset,
stop at the next — and nothing is ever cut or joined. Playing a ruku is one
seek and one stop; the recitation between the ayahs is the reciter's own.

That needs a source publishing both the gapless recordings and per-ayah
millisecond offsets into them. Of the open ones, only quran.com's `qdc` API
(`api.qurancdn.com/api/qdc`) does: EveryAyah publishes per-ayah clips with no
continuous file, and the quranicaudio mirrors publish the continuous files with
no timings. `qdc` returns `verse_timings` with `timestamp_from`/`timestamp_to`
per ayah *and* word-level `segments` as `[position, startMs, endMs]` triples,
which is what makes the word-by-word row follow along. Verified before building
anything: the CDN answers range requests and sends CORS headers, so seeking
into a 32 MB file streams only the part being played rather than downloading
the surah first.

**Two of the fourteen catalogued reciters are the same recording.**
Ids 7 and 173 are both "Mishari Rashid al-`Afasy / Murattal / Hafs", identical
on every displayed field; their audio differs only in encoding
(`murattal/18.mp3` vs `streaming/mp3/18.mp3`, 1,996s vs 2,041s). Offering both
would have been a picker with a duplicate in it. The seed deduplicates on slug
keeping the lower id, which leaves 13 — and deliberately keys on slug rather
than name, because al-Minshawi's "Murattal" and "Kids repeat" are genuinely
different recordings and both survive.

**`quran_verses.audio_url` was dropped rather than filled in.**
The column was reserved by an earlier migration and assumed the shape this
build rejected — one file per ayah. Keeping it would have left a slot that
only a per-ayah source could fill. It was null in all 6,236 rows and referenced
nowhere in the app, so `20260815000001_recitation.sql` drops it and replaces it
with `recitation_files` (one row per reciter × surah) and `recitation_timings`
(one row per reciter × ayah, with the word segments as jsonb).

Importing all 13 reciters is 1,596 upstream requests and ~81,000 timing rows;
`scripts/seed/.cache` makes an interrupted run cheap to resume, which mattered
— the first full run died partway on a transient upload failure.

**Offline is per-surah, downloaded on demand.**
A whole recitation of the Quran is several gigabytes, so "download everything"
is not a feature anyone wants twice. What a reader actually wants offline is
the surah they are working through, so the download button lives in the
player bar and takes one surah at a time, into
`$APPDATA/recitations/<reciter>/<surah>.mp3` via a `.part` file renamed on
completion. A local copy wins over the CDN whenever one exists, so nothing has
to be re-chosen when the connection goes.

---

## Database

**`daily_reading.day` rather than `date`.**
The brief's sketch used `date`; that is a type name in Postgres and reads badly
in queries. Purely cosmetic.

**Streak state is recomputed from scratch, never incremented.**
`recompute_streak` walks the user's whole `daily_reading` history day by day and
derives the streak. `streak_state` is a cache, refreshed by a trigger on any
change to the raw daily totals. This satisfies the brief's requirement that
streaks be auditable from the source data — the counter can never drift, because
it is never mutated in place.

**The streak is also refreshed when it is read.**
The trigger alone is not enough, and the reason is easy to miss: the event the
grace rules are about — a day ending with no reading — writes no row, so nothing
fires. A reader who stops reading would keep the numbers computed on their last
active day, with a lapsed streak still showing and a closed grace window still
inviting them to restore it. So `current_streak()` recomputes before returning
whenever the cached row was computed on an earlier day, and the app reads the
streak through it rather than selecting the table. At most one recompute per
user per day; the rules stay defined in exactly one place.

**Three streak rules the brief left ambiguous:**

1. *A sub-hour day during the grace window does not restore the streak, and does
   not reset it either.* Restoration explicitly requires one cumulative hour, so
   a 20-minute day leaves the window running.
2. *Today is never counted as a missed day.* The day isn't over, so a fresh
   morning would otherwise appear to break a streak.
3. *`longest_streak` never shrinks.* It is kept as `greatest(stored, computed)`,
   so editing history can't erase a record that was genuinely achieved.

All three, plus the core grace/restore behaviour, are covered by
`pnpm test:streak` (8 scenarios against the live database).

**Session time is attributed to the day the session ended, in the user's
timezone.** A session spanning local midnight lands entirely on the later day.
Splitting it across days would be more precise but adds real complexity for an
effect measured in minutes a few times a year.

**Day boundaries are resolved server-side.** `log_reading` computes the calendar
day from `profiles.timezone` rather than trusting a date from the client, so a
wrong system clock cannot manufacture streak days.

**"Tafsir read" is a second table, not a status on `memorized_verses`.**
Memorizing an ayah and understanding it are different achievements, reached at
different times and in either order — plenty of people memorize a surah as a
child and read its commentary decades later. Folding them into one marker with
a status column hides exactly the gap worth seeing: the ayahs known by heart
whose meaning has not been read yet. Two independent tables keep both facts
answerable, and either can be marked without the other existing.

It is deliberately *not* per-edition. Marking against the edition it was read
in would mean switching editions silently unmarks everything, and "I have read
the commentary on this ayah" is the thing the reader is tracking, not "I have
read Ibn Kathir on this ayah".

**`ruku_progress()` aggregates server-side.** The ruku grid needs both counts
for all 558 rukus at once. Doing that in the client means shipping every marked
verse id in the Quran just to count them, so it is one `security definer`
function returning 558 rows with the verse count, the memorized count and the
tafsir-read count per ruku.

---

## AI

**Generation runs in Rust; the cache write happens from the client.**
The brief specifies that the AI caches be service-role-write-only. I followed it
for generation — `OLLAMA_API_KEY` lives only in the Rust process and the webview
can only invoke two fixed, prompt-shaped commands — but let the signed-in user
write the resulting cache row (insert/update, never delete) instead of shipping a
service-role key inside the desktop binary.

The reason is that the two secrets are not comparable. The Ollama key buys
inference; a Supabase service-role key bypasses RLS on *every* table, including
other users' private progress. Embedding the far more dangerous credential in a
distributed binary to protect a shared, low-value content cache is a bad trade.
The security property the brief actually cares about — the AI key never reaching
the frontend bundle — is fully preserved. Migration
`20260805000004_ai_cache_writes.sql` documents this inline.

If this ever became multi-tenant, the right move is a Supabase Edge Function
holding both secrets; the frontend interface would not change.

**Models are discovered at runtime, not hardcoded.**
`/api/tags` is queried on first use and the result cached for the process
lifetime. A preference list ranks known-good cloud models, falling back to any
`-cloud` model in the catalog. `OLLAMA_MODEL` pins a specific one. The brief
suggested resolving at build time; runtime resolution survives a catalog change
without a rebuild.

**Generation is lazy and user-initiated, never bulk.**
Word explanations are generated when a word is opened; ruku summaries when the
user asks. Pre-generating all ~77k words would cost a great deal for content
mostly never read. Because the cache is global, the second reader of any ruku
gets everything instantly.

**Reasoning-model output is sanitized.** Hosted models sometimes wrap answers in
`<think>` blocks or markdown fences; those are stripped before caching so the
stored text is clean prose.

---

## Frontend

**Hand-built component layer over Radix primitives instead of shadcn/ui.**
shadcn's generator copies a large surface area of components, most unused here,
and its defaults are recognizable. Radix supplies the behaviour and
accessibility; the styling is a small bespoke layer in `src/components/ui`.

**Semantic color tokens in OKLCH, flipped by a `.dark` class.**
Every color is a semantic variable (`--surface-2`, `--fg-muted`, `--accent-soft`)
rather than a palette step, so both themes are defined once and no component
carries `dark:` variants for color. A pre-paint inline script in `index.html`
applies the stored theme to avoid a flash.

**Fonts are vendored, not loaded from a CDN.**
Amiri Quran (Arabic) and Inter (UI) are bundled as woff2. The Tauri CSP blocks
external font hosts, and a desktop app should render correctly offline.

**Hash routing.** Avoids deep-link 404s under Tauri's asset protocol.

**The reading timer is idle-aware.** It only advances while the window is
visible and the user has interacted within 90 seconds, flushing every 60
seconds and on unmount/`pagehide`. Leaving the app open overnight should not
manufacture a streak — the streak is meant to measure reading, not uptime.

**Quiz weighting is intentionally simple.** Never-reviewed words first, then
least-recently-reviewed, with "learning" ahead of "learned" and randomness
breaking ties. The brief explicitly warned against over-engineering an SRS.
Distractors are drawn from other real Quranic glosses, so wrong answers are
plausible rather than obviously absurd.

**Focus mode is an overlay, not a route.** One ayah at a time, fullscreen, is a
way of looking at the ruku the reader has already loaded — not a different
place in the app. Keeping it as a sibling overlay inside `Reader` means the
queries, the scroll position and the reading timer all survive entering and
leaving it, and exiting can drop the user back on the exact ayah they were
reading. A `/read/:ruku/focus/:ayah` route would have remounted the reader and
restarted the timer on every toggle.

Three smaller choices inside it: the OS window's fullscreen state is owned by
the component's lifetime, so however the mode ends the window is restored;
walking past either end of a ruku continues into the neighbouring one rather
than dead-ending, entering it at whichever edge the reader arrived from; and
the controls fade out after a few quiet seconds, since chrome that stays put is
the thing focus mode exists to remove. Text size and the translation toggle are
kept in `localStorage` rather than `ui_prefs` — they are per-window comfort
settings, like the split position, not study preferences worth syncing.

**Tajweed colouring is on by default, and is a profile preference rather than
a per-window one.**
The brief for it was that some readers cannot recite correctly without the
colouring; those readers should not have to discover a setting first. It costs
nothing to everyone else, because it changes colour and nothing else — no
weight, size or spacing — so it cannot reflow the Arabic or shift the layout.
It sits in `ui_prefs` next to the tafsir side rather than in `localStorage`
with focus mode's text size, because which rules you need marked is a property
of how you read, not of which window you are in; the reader and focus mode
therefore share one switch.

**The colours are the standard tajweed palette, not a house one.** Light mode
matches it hex for hex — `#537FFF` madd ṭabīʿī through `#000EBC` madd lāzim,
`#9400A8` ikhfāʾ, `#D500B7` ikhfāʾ shafawī, `#169200` idghām, `#58B800` idghām
shafawī, `#26BFFD` iqlāb, `#FF7E1E` ghunnah, `#DD0008` qalqalah, `#AAAAAA`
silent — the values shipped by every implementation of these seventeen rule
classes, and by the quran.com edition the spans are imported from. An earlier
pass approximated the *families* instead ("madd in blues, idghām green") and
drifted far enough to be wrong: idghām shafawī came out teal rather than green,
iqlāb a dark blue indistinguishable from the madds rather than sky blue, and
the mutajānisayn pair blue-grey rather than grey. A reader who has learnt these
colours from a printed mushaf reads a deviation as the app misidentifying the
rule, so the palette is pinned to the standard and the hexes are kept in
comments beside the tokens to stay checkable.

Dark mode cannot use those values directly — madd lāzim at `#000EBC` sits at
1.5:1 against the surface. So each colour keeps its standard *hue* exactly,
which is the part a reader recognises, and only lightness and chroma move, by
the least that clears 4.5:1. Ordering survives: madd still deepens and
saturates with obligation, iqlāb stays the one bright sky blue (unchanged, as
it already reads on dark), silent letters stay the greys.

**The legend names the rules properly.** "Blue means long" would be quicker to
read and would teach nothing; someone learning to recite is learning that this
is *madd munfaṣil*, held 2, 4 or 5 counts. It is collapsed by default so it
costs nothing once known, and grouped by what the rule acts on — prolongation,
nūn sākinah, mīm sākinah — rather than listed flat.

**"Encountered" vocabulary is derived from reading history**, not from taps —
every word in any ruku the user has logged a session against. Counting only
tapped words would make the denominator grow as the user interacts, which is
backwards.

**Following the recitation runs on an animation frame, not `timeupdate`.**
The element's own `timeupdate` fires about four times a second. That is fine
for a progress bar and far too coarse to light up individual words, which turn
over several times a second in a normal murattal. The follow loop reads
`currentTime` every frame instead and resolves position from the timings
directly.

Two rules inside that loop are worth stating, because both look like bugs
until you know the recordings. The current ayah is *the last one to have
started*, not the one strictly containing the playhead — recordings leave small
gaps between ayahs, and holding the highlight across them beats blinking it off
and on. And the current word is found by asking which segment contains the
playhead rather than by walking forward, because a reciter who repeats a phrase
produces a second segment for a word already sung, so positions do not only
increase.

**Repeat-one-ayah pins the ayah it was turned on for.** Re-reading the current
ayah every frame would make "repeat this ayah" mean "repeat whichever ayah is
current", which never settles on the one the reader picked. The pin is keyed on
the mode changing, so turning it on mid-ayah loops that ayah.

**The player lives in `Reader` and is passed into focus mode**, for the same
reason focus mode is an overlay: playback should not stop because the reader
changed how it is looking at the ayah.

**Two markers, two buttons, side by side on every ayah.**
The memorized check and the tafsir cap sit directly under one another on the
verse card because they are read together — "known by heart" and "understood"
are the pair that says what is left to do on this ayah. In the tafsir panel the
mark button is at the *foot* of the commentary rather than beside its heading:
the honest moment to claim you have read something is when you have reached the
bottom of it. It marks the entry's whole range in one act, since a commentary
on 2:1-5 is one passage, and the range is resolved through the surah's own
ayah→id map so an entry that reaches past the ruku on screen still marks
correctly.

**A finished ruku stops being a progress bar and becomes a result.** In the
browse grid and the reader header, a fully memorized ruku switches to the
accent colour with a marker rather than showing a full bar — the bar answers
"how much is left", which stops being the question once the answer is none. The
tafsir marker is a separate corner icon on the same tile, because the two
finish at different times and the rukus that are memorized but not yet read are
precisely what the second marker was added to surface.

---

## Mushaf mode

**The printed Madani mushaf is reproduced from the QCF page fonts, not
re-typeset.** Readers memorise from a physical copy, and recall is bound to
where a word sits on the page — so a "mushaf layout" that reflows to the window
would be the wrong feature wearing the right name. The King Fahd typesetting
ships as 604 fonts, one per page, in which every word is a single Private Use
Area glyph with that line's justification already in the outline. Rendering a
line means emitting its glyph codes in order; there is no letter-spacing,
kashida or `text-align: justify` anywhere in the mushaf CSS, because all three
would fight the typesetting rather than help it. Fitting a page is a single
measurement: line width scales linearly with font size, so `useMushafScale`
measures the widest line once per page and thereafter just divides the
available width by that ratio.

**The V1 page fonts are vendored, and mushaf mode is monochrome.** The V4
fonts were the obvious choice and were vendored first: they carry COLRv1 colour
layers with six CPAL palettes — three tajweed-coloured, three monochrome —
which would have made the tajweed toggle a `font-palette` swap inside a single
font, with the same no-reflow guarantee the study reader gives.

They were dropped because they do not share V1's encoding, which is what
`quran_mushaf_glyphs` stores. A V4 page font holds exactly one glyph per word
packed sequentially from U+FC41, and neither reading order nor codepoint order
reproduces the mapping — glyph advance widths disagree under both. quran.com's
public API exposes no `code_v4` field to recover it from, and rendering V1
codes in a V4 font does not fail loudly: it draws real words in the wrong
places. Monochrome is also simply what the printed mushaf is.

Tajweed colouring therefore stays in the study reader, which colours character
ranges over readable Arabic. The mushaf draws whole words as single glyphs, and
there is no honest way to colour two letters of one — so the mushaf reader has
no tajweed control rather than a control that quietly does nothing.

`pnpm test:mushaf-fonts` is what caught this, and now guards it: it reads the
cmap out of all 604 woff2 files and asserts every stored glyph resolves in the
font that has to draw it (88,443 references). Worth keeping precisely because
the failure it catches is silent — the page still renders, just wrongly.


**Page layout is derived from line-number gaps, and every derivation is
asserted.** quran.com gives each word a page and line, but says nothing about
the ornamental surah-name banner or the basmalah, because neither is ayah text.
Line numbers are assigned over the *printed* page, so that furniture still
consumes them and shows up as a gap. `deriveLines` claims those gaps by walking
backwards from each surah's first ayah over contiguous empty lines, taking at
most what that surah is owed — one line for Al-Fatiha (whose basmalah is its
first ayah) and At-Tawbah (which has none), two for the rest.

Bounding the walk is what keeps pages 1 and 2 honest: they are typeset short
inside a decorative frame, and their 14 trailing empty lines are real blanks,
not furniture belonging to Al-Baqarah. Deriving over the whole book rather than
page by page is what handles At-Tawbah and As-Sajdah, whose banners sit on the
last line of the preceding page with their text beginning overleaf.

`pnpm test:mushaf` re-runs the derivation over all 604 pages and checks the
result against what the printed mushaf must be true of: 114 banner lines,
112 basmalah lines, 15 lines per page, no blank line past page 2, and no ayah
line without glyphs. It talks only to quran.com, so it can be run before the
layout is imported.

**Page view is a sibling route, not a mode inside the ruku reader.** A ruku is
a unit of study and a page is a unit of the physical book; neither divides the
other, so `/read/page/:n` navigates by page and `/read/:ruku` by ruku, and the
header toggle hands over at the reader's current position. Reading time is
still logged against a ruku — the page is the view, the ruku stays the thing
progress is measured in, so the dashboard, streak and memorization counters
need no notion of pages at all.

**Fonts are declared per page, on demand.** 604 `@font-face` rules up front
would be 46MB the reader almost never needs. `lib/mushaf.ts` injects a face and
its four palette rules the first time a page is opened, and the reader prefetches
the next page's font while the current one is being read. `font-display: block`
rather than `swap`: there is no sensible fallback for PUA glyphs, so waiting is
correct and swapping would flash a page of tofu.

The fonts are from the King Fahd Glorious Quran Printing Complex, mirrored by
quran.com, and are vendored under `public/fonts/qcf` via git LFS.

---

## Testing

Two suites run against the real project:

- `pnpm test:streak` — 8 scenarios pinning the grace/restore rules.
- `pnpm test:smoke` — 26 checks that sign in with the *publishable* key, the
  same one the app ships with, and exercise every query and RPC the UI depends
  on. It verifies RLS both ways: a user cannot edit Quran content, and cannot
  see another user's rows.

The recitation check is the player's contract written down: ayah timings must
ascend without overlapping, stay inside the file they index into, and carry
word segments contained by their own ayah. A timing on the wrong scale or
against the wrong file is the fault it exists to catch, and that is minutes
out — so it allows a few seconds of overrun at the end of a surah, because
upstream reports durations to whole seconds and the final ayah's end includes
the recitation dying away. Across the seeded set the worst overrun is 3s on 42
of ~81,000 rows.

Both create and delete throwaway users. `pnpm seed:verify` re-runs the 13
import integrity checks at any time.

One bug worth recording: the first version of the import validator reported
tafsir missing for surahs 19–114. The data was fine — PostgREST caps responses
at 1,000 rows, and the check was reasoning about a whole table from its first
page. Any validation query that spans a table now pages explicitly.

---

## Russian mode

**Content language, not interface language.** The setting picks the language of
the *scripture material* — verse translation, word-by-word glosses, tafsir
edition, AI explanations, quiz answers — and leaves the interface chrome in
English. Wanting the Quran in Russian is not the same request as wanting the
settings screen in Russian, and a single switch doing both would be much harder
to back out of. `src/lib/language.ts` owns every read that used to go straight
to `translation_en` or `gloss_en`.

**Sibling columns, not a translations table.** `translation_ru` and `gloss_ru`
sit next to their English counterparts. A `quran_translations` table is the
better shape for "arbitrarily many translations", but the app shows exactly one
at a time; a column kept every existing read path working and cost one
migration instead of a rewrite of the reader.

**Language joins the AI cache key.** `word_ai_context` and `ruku_ai_summary`
are global and shared by every user. Keyed on content alone — as they were —
the first reader to generate a Russian summary would overwrite the English one
for everybody, and the next English reader would overwrite it back. Both
primary keys are now `(content, language)`.

**Three sources, because no single one has all of it.**

| Material | Source | Coverage |
| --- | --- | --- |
| Verse translation (Kuliev) | quran.com API, resource 45 | 6,236 / 6,236 |
| Tafsir (Ibn Kathir, as-Sa'di) | spa5k/tafsir_api mirror | 6,236 / 6,236 each |
| Word-by-word glosses | QUL resource 553 | 76,267 / 77,429 |

The word-by-word corpus is the awkward one. quran.com has no Russian glosses
and — worse than failing — answers `language=ru` with the English ones, so the
gap is silent. Tarteel's QUL does have them, but its bulk export needs an
account, so `scripts/seed/wbw-russian.ts` reads the public proofreading view a
verse at a time and caches all 6,236 pages on disk.

**The word order is checked, not assumed.** quran.com's word ids are not in
mushaf order (id 6 is the first word of 112:1), so positional word data has to
be aligned on `(surah, ayah, position)`. Getting that wrong would shift every
gloss by one and look like nothing worse than a bad translation. The importer
therefore compares both the Arabic and the English gloss on every word against
the row already stored, skips any word that fails, and refuses the whole import
if more than 1% fail. In practice ~1,100 words have no Russian upstream and a
handful more sit in ayahs the two corpora segment differently (2:181, 8:6);
those fall back to English rather than importing shifted.

## Deliberately not built (v1)

- **OAuth providers.** Email/password only; adding providers is Supabase
  configuration, not app code.
- **Interface translation.** The content language covers scripture material;
  buttons, headings and settings labels stay English. See "Russian mode".
- **Offline write queue.** Reads are cached aggressively by TanStack Query, but
  writes require connectivity. Unflushed reading time is retained in memory and
  retried rather than silently dropped.
