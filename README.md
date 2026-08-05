# Quran Studio

A desktop app for learning and memorizing the Quran **ruku by ruku**. Each of
the Quran's 558 rukus is a lesson: Arabic text alongside Ibn Kathir's tafsir,
a word-by-word breakdown with AI-generated context for each word, memorization
tracking, vocabulary quizzing, and reading streaks.

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
114 surahs, 6,236 verses with translation, 558 rukus, 77,429 words, 1,902
tafsir entries, and 59,923 tajweed rule spans. Downloads are cached under `scripts/seed/.cache`, so re-running
is cheap. The import finishes by running 10 integrity checks.

The running app never calls a third-party Quran API — it only reads Supabase.

### 5. Add your Ollama Cloud key

Either put `OLLAMA_API_KEY` in `.env`, or paste it into **Settings → Ollama
Cloud** once the app is running. The key is held by the Rust backend and is
never exposed to the interface. Without it everything except AI explanations
and ruku summaries works normally.

### 6. Run

```bash
pnpm app:dev     # desktop app (Tauri)
pnpm dev         # browser preview — no AI, since that needs the Rust backend
```

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm app:dev` | Run the desktop app in development |
| `pnpm app:build` | Build a distributable bundle |
| `pnpm dev` | Frontend only, in a browser |
| `pnpm seed` | Import all Quran content into Supabase |
| `pnpm seed:tajweed` | Backfill only the tajweed spans on an existing database |
| `pnpm seed:verify` | Re-run the 13 data integrity checks |
| `pnpm test` | Run both test suites |
| `pnpm test:streak` | Verify the streak/grace rules (7 scenarios) |
| `pnpm test:smoke` | Verify every query, RPC, and RLS policy (18 checks) |
| `pnpm typecheck` | `tsc --noEmit` |

Tests create and delete throwaway users in your Supabase project.

---

## How it fits together

```
src-tauri/          Rust backend — holds the Ollama key, proxies AI calls
  src/ollama.rs     Model discovery, chat, prompt construction

src/
  lib/              Supabase client, generated DB types, AI bridge
  hooks/            Data access, reading timer, progress mutations
  components/       UI kit (Radix + Tailwind), reader components
  routes/           Dashboard, Browse, Reader, Vocabulary, Quiz,
                    Memorization, Settings, About

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
stored in shared tables, so the second person to open a ruku — or the same
person on another machine — gets them instantly.

See [DECISIONS.md](./DECISIONS.md) for the reasoning behind these choices, and
the in-app **About** screen for source attribution.

---

## Attribution

Quran text, translation, word-by-word data, and tajweed annotations from the
quran.com API (Saheeh International translation). Tafsir Ibn Kathir (English,
abridged) via
the `tafsir_api` project. Amiri Quran and Inter typefaces under the SIL Open
Font License. Please respect each source's terms if you redistribute this app.

AI-generated notes are a study aid, not a source of religious rulings.
