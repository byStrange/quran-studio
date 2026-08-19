-- ---------------------------------------------------------------------------
-- Reading the tafsir as its own kind of progress.
--
-- Memorizing an ayah and understanding it are different achievements, and it
-- is entirely normal — common, even — to have done the first without the
-- second. Folding them into one marker hides exactly the gap worth seeing:
-- which of the ayahs I can recite do I not yet know the meaning of.
--
-- So this is a second, independent marker rather than a status on
-- `memorized_verses`. The two are orthogonal: either, neither, or both.
--
-- Deliberately not per-edition. The question being tracked is "have I studied
-- what this ayah means", which someone answers once — reading Ibn Kathir and
-- then the Mukhtasar on the same ayah is not two thirds of a task. Keying by
-- edition would also make the marker shift under a reader who changes their
-- default edition, which is a display preference, not a loss of understanding.
-- ---------------------------------------------------------------------------

create table public.tafsir_read_verses (
  user_id  uuid        not null references auth.users (id) on delete cascade,
  verse_id integer     not null references public.quran_verses (id) on delete cascade,
  read_at  timestamptz not null default now(),
  primary key (user_id, verse_id)
);

comment on table public.tafsir_read_verses is
  'Ayahs whose tafsir the user has read. Independent of memorized_verses.';

alter table public.tafsir_read_verses enable row level security;

create policy "own rows" on public.tafsir_read_verses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Per-ruku progress, for the ruku grid and the reader header.
--
-- A ruku is the app's unit of study, so "finished" is a property of the ruku,
-- not of the ayahs the reader happens to be looking at. Counting server-side
-- keeps that a single 558-row read instead of every marked verse id in the
-- Quran; the caller aggregates the same rows for per-surah totals rather than
-- asking twice.
-- ---------------------------------------------------------------------------
create or replace function public.ruku_progress()
returns table (
  ruku_number       smallint,
  surah_number      smallint,
  verse_count       bigint,
  memorized_count   bigint,
  tafsir_read_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select v.ruku_number,
         min(v.surah_number)::smallint,
         count(*),
         count(m.verse_id),
         count(t.verse_id)
    from public.quran_verses v
    left join public.memorized_verses m
           on m.verse_id = v.id and m.user_id = auth.uid()
    left join public.tafsir_read_verses t
           on t.verse_id = v.id and t.user_id = auth.uid()
   group by v.ruku_number
   order by v.ruku_number;
$$;

grant execute on function public.ruku_progress() to authenticated;
