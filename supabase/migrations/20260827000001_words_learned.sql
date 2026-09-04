create table public.words_learned_verses (
  user_id  uuid        not null references auth.users (id) on delete cascade,
  verse_id integer     not null references public.quran_verses (id) on delete cascade,
  learned_at timestamptz not null default now(),
  primary key (user_id, verse_id)
);

comment on table public.words_learned_verses is
  'Ayahs whose words the user has learned. Independent of memorized_verses and tafsir_read_verses.';

alter table public.words_learned_verses enable row level security;

create policy "own rows" on public.words_learned_verses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop function if exists public.ruku_progress();

create or replace function public.ruku_progress()
returns table (
  ruku_number       smallint,
  surah_number      smallint,
  verse_count       bigint,
  memorized_count   bigint,
  tafsir_read_count bigint,
  words_learned_count bigint
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
         count(t.verse_id),
         count(w.verse_id)
    from public.quran_verses v
    left join public.memorized_verses m
           on m.verse_id = v.id and m.user_id = auth.uid()
    left join public.tafsir_read_verses t
           on t.verse_id = v.id and t.user_id = auth.uid()
    left join public.words_learned_verses w
           on w.verse_id = v.id and w.user_id = auth.uid()
   group by v.ruku_number
   order by v.ruku_number;
$$;

grant execute on function public.ruku_progress() to authenticated;
