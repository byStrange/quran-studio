-- ---------------------------------------------------------------------------
-- The knowledge round in Uzbek.
--
-- 20260918000001_uzbek_mode.sql added quran_verses.translation_uz and taught
-- quiz_pool and next_unread_tafsir about it, but quiz_verse_pool landed in the
-- same window and was not in that migration's reach. Without this an Uzbek
-- reader gets a generated round whose ayahs are drawn against the English
-- translation and rendered from a column the row does not carry.
--
-- The eligibility test is the same shape as quiz_pool's: a verse qualifies
-- when the translation the reader actually reads is non-empty, falling back
-- the way lib/language.ts falls back. Uzbek has no verse translation imported
-- yet, so today that fallback is what every Uzbek round runs on — the column
-- is selected regardless, so the round starts working the day the import
-- lands rather than needing another migration.
-- ---------------------------------------------------------------------------

drop function if exists public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint);

create or replace function public.quiz_verse_pool(
  p_scope    public.quiz_scope default 'global',
  p_limit    integer default 10,
  p_language text    default 'en',
  p_surah    smallint default null,
  p_ruku     smallint default null
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
  translation_uz text,
  pool_size      integer
)
language sql
security definer
set search_path = public
stable
as $$
  with scope_verses as (
    select v.id, v.surah_number, v.ayah_number, v.ruku_number, v.arabic_text,
           v.translation_en, v.translation_ru, v.translation_uz, s.name_english
      from public.quran_verses v
      join public.quran_surahs s on s.number = v.surah_number
     where case p_scope
             when 'ruku' then
               v.ruku_number = p_ruku
             when 'surah' then
               v.surah_number = p_surah
               and exists (
                 select 1 from public.memorized_verses m
                  where m.user_id = auth.uid() and m.verse_id = v.id
               )
             else
               exists (
                 select 1 from public.memorized_verses m
                  where m.user_id = auth.uid() and m.verse_id = v.id
               )
           end
       and coalesce(
             nullif(case p_language
                      when 'ru' then coalesce(nullif(v.translation_ru, ''), v.translation_en)
                      when 'uz' then coalesce(nullif(v.translation_uz, ''), v.translation_en)
                      else v.translation_en
                    end, ''),
             '') <> ''
  )
  select id, surah_number, ayah_number, ruku_number, name_english,
         arabic_text, translation_en, translation_ru, translation_uz,
         (count(*) over ())::integer as pool_size
    from scope_verses
   order by random()
   limit greatest(1, least(coalesce(p_limit, 10), 30));
$$;

comment on function public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint) is
  'Random verses from a scope, as the source material for a generated knowledge round.';

grant execute on function public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;
