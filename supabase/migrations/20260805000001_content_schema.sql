-- ---------------------------------------------------------------------------
-- Shared Quran content.
--
-- These tables are global: identical for every user, populated once by the
-- seed pipeline (scripts/seed) using the service role. They are readable by
-- everyone and writable by nobody except the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

create table public.quran_surahs (
  number            smallint primary key check (number between 1 and 114),
  name_arabic       text     not null,
  name_english      text     not null,
  name_translation  text     not null,
  revelation_type   text     not null check (revelation_type in ('meccan', 'medinan')),
  ayah_count        smallint not null check (ayah_count > 0),
  ruku_count        smallint not null default 0
);

comment on table public.quran_surahs is 'The 114 surahs, used for the browser index.';

-- Canonical verse ids run 1..6236 in mushaf order, matching the source dataset
-- so re-running the seed is idempotent.
create table public.quran_verses (
  id              integer  primary key,
  surah_number    smallint not null references public.quran_surahs (number),
  ayah_number     smallint not null check (ayah_number > 0),
  ruku_number     smallint not null check (ruku_number > 0),
  juz_number      smallint not null check (juz_number between 1 and 30),
  page_number     smallint,
  arabic_text     text     not null,
  translation_en  text     not null,
  -- Reserved for a future recitation feature; intentionally always null in v1
  -- so that adding audio needs no schema migration.
  audio_url       text,
  unique (surah_number, ayah_number)
);

create index quran_verses_ruku_idx  on public.quran_verses (ruku_number, surah_number, ayah_number);
create index quran_verses_juz_idx   on public.quran_verses (juz_number);

comment on column public.quran_verses.audio_url is
  'Extension point for recitation audio. Always null in v1.';

-- Rukus are the app''s unit of study. Derived from verse ruku_number during
-- seeding and stored explicitly so navigation is a single indexed lookup.
create table public.quran_rukus (
  ruku_number    smallint primary key check (ruku_number between 1 and 600),
  surah_number   smallint not null references public.quran_surahs (number),
  ayah_start     smallint not null,
  ayah_end       smallint not null,
  verse_count    smallint not null check (verse_count > 0),
  -- Position of this ruku within its own surah (1-based), for display.
  ruku_in_surah  smallint not null check (ruku_in_surah > 0),
  check (ayah_end >= ayah_start)
);

create index quran_rukus_surah_idx on public.quran_rukus (surah_number, ruku_in_surah);

create table public.quran_words (
  id              integer  primary key,
  verse_id        integer  not null references public.quran_verses (id) on delete cascade,
  position        smallint not null check (position > 0),
  arabic          text     not null,
  transliteration text,
  gloss_en        text,
  unique (verse_id, position)
);

create index quran_words_verse_idx on public.quran_words (verse_id, position);

-- Ibn Kathir frequently comments on a run of ayahs at once. The seed pipeline
-- collapses consecutive identical entries into a single row covering the
-- range, so the UI can show "commentary on 2:1-5".
create table public.tafsir_ibn_kathir (
  id            integer generated always as identity primary key,
  surah_number  smallint not null references public.quran_surahs (number),
  ayah_start    smallint not null check (ayah_start > 0),
  ayah_end      smallint not null,
  content       text     not null,
  unique (surah_number, ayah_start),
  check (ayah_end >= ayah_start)
);

create index tafsir_lookup_idx on public.tafsir_ibn_kathir (surah_number, ayah_start, ayah_end);

-- --- AI caches -------------------------------------------------------------
-- Generated once, globally, then reused by every user. Written only by the
-- backend AI job (the Rust Tauri command, using the service role).

create table public.word_ai_context (
  word_id       integer primary key references public.quran_words (id) on delete cascade,
  explanation   text        not null,
  model_used    text        not null,
  generated_at  timestamptz not null default now()
);

create table public.ruku_ai_summary (
  ruku_number   smallint primary key references public.quran_rukus (ruku_number) on delete cascade,
  summary       text        not null,
  model_used    text        not null,
  generated_at  timestamptz not null default now()
);

-- --- RLS: public read, service-role write ----------------------------------

alter table public.quran_surahs      enable row level security;
alter table public.quran_verses      enable row level security;
alter table public.quran_rukus       enable row level security;
alter table public.quran_words       enable row level security;
alter table public.tafsir_ibn_kathir enable row level security;
alter table public.word_ai_context   enable row level security;
alter table public.ruku_ai_summary   enable row level security;

-- Read-only policies. The deliberate absence of insert/update/delete policies
-- means only the service role (which bypasses RLS) can write.
create policy "content is readable by everyone" on public.quran_surahs
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.quran_verses
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.quran_rukus
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.quran_words
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.tafsir_ibn_kathir
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.word_ai_context
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.ruku_ai_summary
  for select to anon, authenticated using (true);

revoke insert, update, delete on
  public.quran_surahs, public.quran_verses, public.quran_rukus,
  public.quran_words, public.tafsir_ibn_kathir,
  public.word_ai_context, public.ruku_ai_summary
  from anon, authenticated;
