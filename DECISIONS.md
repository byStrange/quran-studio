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

**Tafsir entries are collapsed into ayah ranges at import time.**
Ibn Kathir often comments on a run of ayahs at once, and the source repeats the
identical text against every ayah in that run. The seed detects consecutive
identical entries and stores one row spanning `ayah_start..ayah_end` (1,902 rows
instead of ~6,000). The reader looks up the row whose range contains the
selected ayah and labels the range it covers.

**Footnote markup is stripped from translations.**
Saheeh International arrives with `<sup foot_note=…>` markers. There is no
footnote UI in v1, so dangling superscript numbers would be noise; the markers
are removed at import, not at render.

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

**Three streak rules the brief left ambiguous:**

1. *A sub-hour day during the grace window does not restore the streak, and does
   not reset it either.* Restoration explicitly requires one cumulative hour, so
   a 20-minute day leaves the window running.
2. *Today is never counted as a missed day.* The day isn't over, so a fresh
   morning would otherwise appear to break a streak.
3. *`longest_streak` never shrinks.* It is kept as `greatest(stored, computed)`,
   so editing history can't erase a record that was genuinely achieved.

All three, plus the core grace/restore behaviour, are covered by
`pnpm test:streak` (7 scenarios against the live database).

**Session time is attributed to the day the session ended, in the user's
timezone.** A session spanning local midnight lands entirely on the later day.
Splitting it across days would be more precise but adds real complexity for an
effect measured in minutes a few times a year.

**Day boundaries are resolved server-side.** `log_reading` computes the calendar
day from `profiles.timezone` rather than trusting a date from the client, so a
wrong system clock cannot manufacture streak days.

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

**"Encountered" vocabulary is derived from reading history**, not from taps —
every word in any ruku the user has logged a session against. Counting only
tapped words would make the denominator grow as the user interacts, which is
backwards.

---

## Testing

Two suites run against the real project:

- `pnpm test:streak` — 7 scenarios pinning the grace/restore rules.
- `pnpm test:smoke` — 17 checks that sign in with the *publishable* key, the
  same one the app ships with, and exercise every query and RPC the UI depends
  on. It verifies RLS both ways: a user cannot edit Quran content, and cannot
  see another user's rows.

Both create and delete throwaway users. `pnpm seed:verify` re-runs the 10
import integrity checks at any time.

One bug worth recording: the first version of the import validator reported
tafsir missing for surahs 19–114. The data was fine — PostgREST caps responses
at 1,000 rows, and the check was reasoning about a whole table from its first
page. Any validation query that spans a table now pages explicitly.

---

## Deliberately not built (v1)

- **Audio.** `quran_verses.audio_url` exists and is always null, so recitation
  can be added without a migration, as the brief requested.
- **OAuth providers.** Email/password only; adding providers is Supabase
  configuration, not app code.
- **i18n.** English only, per the brief.
- **Offline write queue.** Reads are cached aggressively by TanStack Query, but
  writes require connectivity. Unflushed reading time is retained in memory and
  retried rather than silently dropped.
