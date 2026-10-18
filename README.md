# Quran Studio

A desktop app for learning and memorizing the Quran **ruku by ruku**. Each of
the Quran's 558 rukus is a lesson: Arabic text alongside tafsir, a word-by-word
breakdown with AI-generated context for each word, memorization tracking,
vocabulary quizzing, and reading streaks.

The whole app speaks **English, Russian or Uzbek** — one setting picks the
interface, the verse translation, the word-by-word glosses, the tafsir edition
and the language the AI writes its explanations in.

Words are learned on a spaced schedule. A card shows the Arabic, you turn it
over to the gloss and the ayah the word was used in, and you say how it went —
*again*, *hard*, *good* or *easy* — with the interval each answer would buy
printed on the button. A word counts as learned only once its interval reaches
three weeks, which no single lucky round can buy. A round covers whatever is
due, one ruku, one surah or everything you have memorized, and every ruku has a
quiz button beside it. The app opens with the next tafsir you haven't read for
an ayah you have memorized, and a whole surah can be read end to end in one
continuous scroll.

Recitation plays from the reciter's own continuous surah recording — the reader
follows the ayah, and the word, as it is sung — with 13 reciters, per-surah
offline downloads, and separate markers for what you have memorized and what
you have read the tafsir on.

Built with Tauri 2 + React 19 + TypeScript + Tailwind 4, on Supabase, with
Ollama Cloud for AI generation.

---

## Setup

### 1. Install dependencies

```bash
pnpm install
```

Requires Node 20+, pnpm, and a Rust toolchain. On Linux you also need the
standard Tauri system libraries (`webkit2gtk-4.1`, `libayatana-appindicator3`,
`librsvg`).

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your Supabase project URL, publishable key, and service-role key. The
service-role key is used **only** by the seed scripts — it is never prefixed
with `VITE_`, so it cannot end up in the frontend bundle.

### 3. Apply the schema

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 4. Import Quran content

```bash
pnpm seed
```

This downloads the full corpus once (~2 minutes) and writes it to Supabase:
114 surahs, 6,236 verses with English, Russian and Uzbek translations, 558 rukus,
77,429 words, tafsir entries across four editions, and 59,923 tajweed rule
spans. Downloads are cached under `scripts/seed/.cache`, so re-running
is cheap. The import finishes by running 17 integrity checks.

The running app never calls a third-party Quran API — it only reads Supabase.

### 5. Import the mushaf layout and fonts

```bash
pnpm seed:mushaf   # 604 pages of line layout, 83,665 glyph positions
pnpm fonts:qcf     # 604 page fonts + surah-name banners (~46MB, one-time)
```

Both are needed for the mushaf reader, which reproduces the printed Madani
mushaf page by page. The glyph codes only mean anything in their own page's
font, so importing one half without the other leaves the reader blank. Run
`pnpm test:mushaf-fonts` afterwards to confirm the two halves agree.

The fonts land in `public/fonts/qcf` and are tracked with git LFS. Skip this
step and everything else still works — the study reader is unaffected.

### 6. Import the recitations

```bash
pnpm seed:audio    # 13 reciters, ~81,000 ayah timings (~10 minutes)
```

This imports metadata only — the mp3s stay on quran.com's CDN and are streamed,
or downloaded per surah from inside the app. What it writes is what makes them
navigable: which continuous file holds which surah, how long it is, and where
every ayah and every word falls inside it.

Narrow it while trying things out: `--reciter=7` and `--surah=18` are both
repeatable, and one reciter is about a minute. Skip this step and everything
else still works — the reader simply shows no player.

### 7. Add your Ollama Cloud key

Either put `OLLAMA_API_KEY` in `.env`, or paste it into **Settings → Ollama
Cloud** once the app is running. The key is held by the Rust backend and is
never exposed to the interface. Without it everything except AI explanations
and ruku summaries works normally.

### 8. Run

```bash
pnpm app:dev     # desktop app (Tauri)
pnpm dev         # browser preview — no AI, since that needs the Rust backend
```

### 9. (Optional) Enable the Uzbek gloss contribution tool

A gated desktop tool where trusted volunteers photograph a page of a printed
Uzbek word-by-word Quran and the Ollama vision model transcribes the gloss under
each Arabic word, for review and approval into `quran_words.gloss_uz`. To turn
it on:

- Pin a vision-capable model in `.env` as `OLLAMA_VISION_MODEL` (the text models
  are not multimodal).
- Add contributors to the allowlist with the service role (Supabase SQL editor).
  `can_review` marks the few who may approve submissions into the live corpus:

  ```sql
  insert into gloss_uz_contributors (user_id, can_review)
  select id, true from auth.users where email = 'you@example.com';
  ```

The tool then appears in the sidebar for those accounts only, in the desktop app.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm app:dev` | Run the desktop app in development |
| `pnpm app:build` | Build a distributable bundle |
| `pnpm dev` | Frontend only, in a browser |
| `pnpm seed` | Import all Quran content into Supabase |
| `pnpm seed:tajweed` | Backfill only the tajweed spans on an existing database |
| `pnpm seed:tafsir` | Re-import just the tafsir editions |
| `pnpm seed:translation-ru` | Import the Russian verse translation (Kuliev) |
| `pnpm seed:translation-uz` | Import the Uzbek verse translation (Muhammad Sodiq, Latin) |
| `pnpm seed:translation-uz-mansur` | Import the Uzbek verse translation (Alouddin Mansur, Cyrillic) |
| `pnpm seed:wbw-ru` | Import the Russian word-by-word glosses |
| `pnpm seed:mushaf` | Import the 604-page Madani mushaf layout |
| `pnpm seed:audio` | Import reciters, surah recordings and ayah timings |
| `pnpm fonts:qcf` | Vendor the QCF page fonts into `public/fonts/qcf` |
| `pnpm seed:verify` | Re-run the 17 data integrity checks |
| `pnpm test` | Run both test suites |
| `pnpm test:streak` | Verify the streak/grace rules (8 scenarios) |
| `pnpm test:smoke` | Verify every query, RPC, and RLS policy (29 checks) |
| `pnpm test:mushaf` | Re-derive and verify the mushaf layout for all 604 pages |
| `pnpm test:mushaf-fonts` | Check every stored glyph resolves in its page font |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm changelog` | Preview the release notes for what has landed since the last tag |
| `pnpm release 0.2.0` | Bump the version, tag it, and push — CI builds and publishes |

Tests create and delete throwaway users in your Supabase project.

---

## Releases

A tag is the whole trigger.

```bash
pnpm release 0.2.0
```

That writes the version into `package.json`, `src-tauri/tauri.conf.json` and
`src-tauri/Cargo.toml`, commits it, and pushes the tag. `.github/workflows/release.yml`
then builds the Android APK, the Linux AppImage, the Windows installer and the
universal macOS DMG, writes the notes from the commits since the previous tag,
and publishes a GitHub Release with all four attached. Nothing is built locally.

To check one platform's build without releasing, run the workflow by hand:
`gh workflow run release.yml -f platforms=macos` (or `android`, `linux`,
`windows`, `all`).

Install instructions for each platform live in
[`.github/INSTALL.md`](.github/INSTALL.md) and are appended to every release's
notes. The macOS app is ad-hoc signed but not notarized, so it needs the one-time
*Open Anyway* step described there.

`pnpm release 0.2.0 --dry` prints the version change and the notes and stops.
`pnpm changelog` prints the notes alone, at any time.

The notes are grouped by conventional-commit prefix where a commit has one, and
collected under *Other changes* where it does not. Both kinds are in this
history, so a generator that only understood prefixes would quietly drop half
of it.

Running the workflow by hand (**Actions → Release → Run workflow**) builds the
same artifacts and publishes nothing — a way to find out whether a release
would build without spending a version number on the answer.

### Repository secrets

The builds read these from the `prod` environment, not from repository-level
secrets — environment-scoped secrets resolve to empty strings outside it, and
an app built that way cannot reach its database and does not say so.

| Secret | Needed for |
| --- | --- |
| `VITE_SUPABASE_URL` | Both builds |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Both builds |
| `ANDROID_KEYSTORE_BASE64` | A signed Android release (optional, see below) |
| `ANDROID_KEYSTORE_PASSWORD` | ” |
| `ANDROID_KEY_ALIAS` | ” |
| `ANDROID_KEY_PASSWORD` | ” |

### Signing Android releases

Without a keystore the workflow falls back to the debug-signed APK. It
installs, and it is what `pnpm app:android` produces locally — but it carries
its debug symbols (~170MB against ~25MB) and CI generates a fresh debug key on
every run, so two releases built that way **cannot upgrade each other in
place**. A user has to uninstall before installing the next one.

One keystore, made once and kept forever, fixes that:

```bash
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias quran-studio
base64 -w0 release.jks          # paste into ANDROID_KEYSTORE_BASE64
```

Keep `release.jks` somewhere safe and out of the repo. Losing it means every
future release is a different app as far as Android is concerned, and no
existing install can be upgraded.

The APK is signed with `apksigner` after the build rather than through Gradle,
because `src-tauri/gen/` is regenerated by `tauri android init` on every CI run
— a `signingConfig` written into it would have to be re-patched each time.

---

## How it fits together

```
src-tauri/          Rust backend — holds the Ollama key, proxies AI calls
  src/ollama.rs     Model discovery, chat, prompt construction

src/
  lib/              Supabase client, generated DB types, AI bridge, i18n core
  locales/          en / ru / uz dictionaries; en defines the key set
  hooks/            Data access, reading timer, progress mutations
  components/       UI kit (Radix + Tailwind), reader components
  routes/           Dashboard, Browse, Reader, SurahReader, Vocabulary,
                    Quiz, Memorization, Settings, About

scripts/seed/       One-time content import + validation
scripts/test/       Streak rules and data-layer smoke tests
supabase/migrations/ Schema, RLS policies, streak engine, RPCs
```

**Data model.** Quran content lives in public-read tables that only the service
role can write. Everything user-scoped (`memorized_verses`, `daily_reading`,
`user_word_progress`, …) is protected by RLS on `user_id = auth.uid()`, so
accounts are fully isolated.

**Streaks.** `daily_reading` is the source of truth. A trigger recomputes
`streak_state` from the full history on every change — the counter is derived,
never incremented. A missed day opens a 3-day grace window; one hour of reading
in a single day inside that window restores the streak where it left off.

**AI caching.** Word explanations and ruku summaries are generated once and
stored in shared tables, keyed by `(content, language)`, so the second person to
open a ruku — or the same person on another machine — gets them instantly.

**Languages.** One preference drives everything. `src/locales/en.ts` defines the
key set and the other two locales are typed against it, so a missing string is a
compile error. Where a language has no data for something — Uzbek verse
translations before `pnpm seed:translation-uz`, Uzbek word-by-word glosses,
which do not exist upstream at all — `src/lib/language.ts` falls back to English
per item and Settings says so under the picker.

See [DECISIONS.md](./DECISIONS.md) for the reasoning behind these choices, and
the in-app **About** screen for source attribution.

---

## Attribution

Quran text, translation, word-by-word data, tajweed annotations, and the Madani
mushaf page layout from the quran.com API (Saheeh International translation).
Tafsir Ibn Kathir (English, abridged), Al-Mukhtasar fi Tafsir al-Qur'an
al-Karim (Uzbek, Tafsir Center for Quranic Studies), and Tafsir Ibn Kathir and
Tafsir as-Sa'di (Russian) via the `tafsir_api` project. The Russian verse
translation is Elmir Kuliev's and the Uzbek is Shaykh Muhammad Sodiq Muhammad
Yusuf's, both from the quran.com API. The Russian word-by-word glosses are from
the Quranic Universal Library (QUL) by Tarteel. Amiri Quran
and Inter typefaces under the SIL Open Font License. The QCF V1 mushaf page
fonts and surah-name banners are from the King Fahd Glorious Quran Printing
Complex, mirrored by quran.com. Please respect each source's terms if you redistribute
this app.

AI-generated notes are a study aid, not a source of religious rulings.
