-- ---------------------------------------------------------------------------
-- One tafsir table becomes many editions.
--
-- `tafsir_ibn_kathir` baked its edition into the table name, which was fine
-- while there was exactly one. Adding the Uzbek Mukhtasar makes the edition a
-- value rather than a schema decision: the table is renamed to `tafsir` and
-- gains an `edition` column, so a third edition is a seed change and nothing
-- else.
--
-- The rename preserves the rows already imported — this is not a drop and
-- recreate, and re-running the seed afterwards is still a no-op upsert.
-- ---------------------------------------------------------------------------

-- Editions are content, not configuration: the seed pipeline populates this
-- from the upstream catalogue, and the reader builds its picker from whatever
-- is actually present. A row here with no tafsir rows behind it would show an
-- empty edition, so the seed always writes the two together.
create table public.tafsir_editions (
  slug           text     primary key,
  name           text     not null,
  author_name    text     not null,
  -- ISO 639-1, matching the upstream catalogue's `language_name`.
  language_code  text     not null,
  language_name  text     not null,
  -- Display order in the reader's edition picker; ties break on name.
  sort_order     smallint not null default 0
);

comment on table public.tafsir_editions is
  'Available tafsir editions, written by the seed pipeline alongside their content.';

-- Seeded here rather than left to the pipeline because the backfill below
-- needs it to satisfy the foreign key on an already-populated database.
insert into public.tafsir_editions
  (slug, name, author_name, language_code, language_name, sort_order)
values
  ('en-tafisr-ibn-kathir', 'Ibn Kathir', 'Hafiz Ibn Kathir', 'en', 'English', 0)
on conflict (slug) do nothing;

alter table public.tafsir_ibn_kathir rename to tafsir;

-- Added nullable, backfilled, then constrained: the existing rows are all
-- Ibn Kathir by construction, since it was the only edition the table could
-- hold.
alter table public.tafsir add column edition text;
update public.tafsir set edition = 'en-tafisr-ibn-kathir' where edition is null;
alter table public.tafsir alter column edition set not null;
alter table public.tafsir
  add constraint tafsir_edition_fkey
  foreign key (edition) references public.tafsir_editions (slug) on delete cascade;

-- `unique (surah_number, ayah_start)` would now collide across editions: both
-- Ibn Kathir and the Mukhtasar comment on 2:1. The edition joins the key.
alter table public.tafsir drop constraint tafsir_ibn_kathir_surah_number_ayah_start_key;
alter table public.tafsir
  add constraint tafsir_edition_surah_ayah_key unique (edition, surah_number, ayah_start);

-- The reader's lookup is "the row of this edition whose range covers this
-- ayah", so edition leads the index.
drop index if exists tafsir_lookup_idx;
create index tafsir_lookup_idx
  on public.tafsir (edition, surah_number, ayah_start, ayah_end);

-- --- RLS -------------------------------------------------------------------
-- The renamed table keeps the policy it already had. The new one repeats the
-- content pattern: readable by everyone, writable only by the service role.

alter table public.tafsir_editions enable row level security;

create policy "content is readable by everyone" on public.tafsir_editions
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.tafsir_editions from anon, authenticated;
