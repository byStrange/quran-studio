-- ---------------------------------------------------------------------------
-- Ayahs flagged as recited wrongly.
--
-- When someone listens to a recitation, they catch slips the reciter does not:
-- a swapped word, a missed letter, a stumble on a join. The flag is the
-- hand-off — "come back to this one" — so it is a plain per-ayah marker the
-- reader can raise and later clear, independent of every other progress
-- marker. An ayah can be memorized and flagged at once; that is the common
-- case, and the point.
--
-- Cleared by deleting the row rather than kept as a resolved state: the
-- question being answered is "what is still wrong", and a history of past
-- mistakes would need its own design to be anything but clutter.
-- ---------------------------------------------------------------------------

create table public.mistake_verses (
  user_id   uuid        not null references auth.users (id) on delete cascade,
  verse_id  integer     not null references public.quran_verses (id) on delete cascade,
  marked_at timestamptz not null default now(),
  primary key (user_id, verse_id)
);

comment on table public.mistake_verses is
  'Ayahs the user was heard to recite with a mistake, awaiting review. Independent of memorized_verses.';

alter table public.mistake_verses enable row level security;

create policy "own rows" on public.mistake_verses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deleting a verse cascades here; the primary key leads with user_id, so give
-- the cascade its own way in.
create index mistake_verses_verse_id_idx on public.mistake_verses (verse_id);
