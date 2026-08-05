-- Per-surah memorization counts. Doing this as a grouped aggregate server-side
-- avoids pulling every memorized verse id to the client just to count them.
create or replace function public.memorized_by_surah()
returns table (
  surah_number    smallint,
  memorized_count bigint,
  ayah_count      smallint
)
language sql
security definer
set search_path = public
stable
as $$
  select s.number,
         count(m.verse_id),
         s.ayah_count
    from public.quran_surahs s
    left join public.quran_verses v on v.surah_number = s.number
    left join public.memorized_verses m
           on m.verse_id = v.id and m.user_id = auth.uid()
   group by s.number, s.ayah_count
   order by s.number;
$$;

grant execute on function public.memorized_by_surah() to authenticated;
