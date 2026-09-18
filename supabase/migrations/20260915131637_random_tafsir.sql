create or replace function public.next_unread_tafsir(
  p_edition text default 'en-tafisr-ibn-kathir'
)
returns table (
  verse_id       integer,
  surah_number   smallint,
  ayah_number    smallint,
  ruku_number    smallint,
  surah_name     text,
  arabic_text    text,
  translation_en text,
  translation_ru text,
  ayah_start     smallint,
  ayah_end       smallint,
  content        text,
  edition        text,
  verse_ids      integer[]
)
language sql
security definer
set search_path = public
volatile
as $$
  select v.id,
         v.surah_number,
         v.ayah_number,
         v.ruku_number,
         s.name_english,
         v.arabic_text,
         v.translation_en,
         v.translation_ru,
         t.ayah_start,
         t.ayah_end,
         t.content,
         t.edition,
         array(
           select rv.id
             from public.quran_verses rv
            where rv.surah_number = t.surah_number
              and rv.ayah_number between t.ayah_start and t.ayah_end
            order by rv.ayah_number
         ) as verse_ids
    from public.memorized_verses m
    join public.quran_verses v on v.id = m.verse_id
    join public.quran_surahs s on s.number = v.surah_number
    join public.tafsir t
      on t.surah_number = v.surah_number
     and t.edition = p_edition
     and v.ayah_number between t.ayah_start and t.ayah_end
   where m.user_id = auth.uid()
     and coalesce(t.content, '') <> ''
     and not exists (
       select 1
         from public.tafsir_read_verses r
         join public.quran_verses rv on rv.id = r.verse_id
        where r.user_id = m.user_id
          and rv.surah_number = t.surah_number
          and rv.ayah_number between t.ayah_start and t.ayah_end
     )
   order by random()
   limit 1;
$$;

grant execute on function public.next_unread_tafsir(text) to authenticated;
