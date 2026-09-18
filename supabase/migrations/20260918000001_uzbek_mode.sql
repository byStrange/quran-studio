-- ---------------------------------------------------------------------------
-- Uzbek.
--
-- The app now speaks one language everywhere — interface, scripture and AI —
-- and Uzbek is the third. Two of the three need nothing from the database:
-- the interface strings ship in the bundle, and the AI caches have been keyed
-- by language since the Russian migration, so an Uzbek explanation is simply
-- another row. The tafsir needs nothing either — Al-Mukhtasar has been seeded
-- in Uzbek from the start, and `tafsir_editions` already made the edition a
-- value rather than a schema decision.
--
-- What is missing is the verse translation, which this adds, and the plumbing
-- that carries it out of the two RPCs that hand verses to the client.
--
-- The word-by-word gloss is deliberately *not* added. There is no Uzbek
-- word-by-word corpus upstream to fill it with, and a `gloss_uz` column that
-- is null for all 77,429 rows would be a promise the data cannot keep; Uzbek
-- reads the English glosses, which `lib/language.ts` states plainly rather
-- than hides.
-- ---------------------------------------------------------------------------

-- --- verse translation -----------------------------------------------------
-- A sibling column, for the same reason `translation_ru` is one: the app shows
-- exactly one translation at a time and picks it from a preference, so a third
-- column costs one migration where a `quran_translations` table would cost a
-- rewrite of every read path.
--
-- Nullable, and null for every row until `pnpm seed:translation-uz` runs. That
-- is the intended state at this migration's commit, not a half-finished one:
-- the reader falls back to English per verse, so the app is correct before the
-- import and better after it.
alter table public.quran_verses add column translation_uz text;

comment on column public.quran_verses.translation_uz is
  'Uzbek verse translation. Null until the seed imports it; the reader falls '
  'back to translation_en per verse while it is.';

-- --- quiz pool -------------------------------------------------------------
-- The round shows the ayah a missed word came from, in the reader's language,
-- so the Uzbek column has to travel with it. That is a change of return
-- signature, so the function is dropped and recreated rather than replaced.
--
-- The gloss expression is unchanged and already correct for Uzbek: there is no
-- `gloss_uz`, so anything that is not Russian resolves to the English gloss.
drop function if exists public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint);

create or replace function public.quiz_pool(
  p_scope    public.quiz_scope default 'global',
  p_limit    integer default 10,
  p_language text    default 'en',
  p_surah    smallint default null,
  p_ruku     smallint default null
)
returns table (
  word_id         integer,
  arabic          text,
  transliteration text,
  gloss           text,
  status          public.word_status,
  tracked         boolean,
  surah_number    smallint,
  ayah_number     smallint,
  ruku_number     smallint,
  verse_id        integer,
  verse_arabic    text,
  translation_en  text,
  translation_ru  text,
  translation_uz  text,
  pool_size       integer
)
language sql
security definer
set search_path = public
stable
as $$
  with scope_verses as (
    select v.id, v.surah_number, v.ayah_number, v.ruku_number, v.arabic_text,
           v.translation_en, v.translation_ru, v.translation_uz
      from public.quran_verses v
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
  ),
  quizzable as (
    select w.id as word_id,
           w.arabic,
           w.transliteration,
           case when p_language = 'ru'
                then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
                else w.gloss_en
           end as gloss,
           sv.id as verse_id,
           sv.surah_number,
           sv.ayah_number,
           sv.ruku_number,
           sv.arabic_text,
           sv.translation_en,
           sv.translation_ru,
           sv.translation_uz,
           p.status,
           (p.word_id is not null) as tracked,
           p.last_reviewed_at
      from scope_verses sv
      join public.quran_words w on w.verse_id = sv.id
      left join public.user_word_progress p
             on p.word_id = w.id and p.user_id = auth.uid()
  )
  select word_id, arabic, transliteration, gloss,
         coalesce(status, 'new'::public.word_status) as status,
         tracked, surah_number, ayah_number, ruku_number, verse_id,
         arabic_text, translation_en, translation_ru, translation_uz,
         (count(*) over ())::integer as pool_size
    from quizzable q
   where coalesce(q.gloss, '') <> ''
   order by
     case coalesce(q.status, 'new')
       when 'learning' then 0
       when 'new'      then 1
       else                 2
     end,
     q.last_reviewed_at nulls first,
     random()
   limit greatest(1, least(coalesce(p_limit, 10), 100));
$$;

comment on function public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) is
  'A round of blind-recall questions for a ruku, a surah''s memorized ayahs, or every memorized ayah.';

grant execute on function
  public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;

-- --- tafsir nudge ----------------------------------------------------------
-- The prompt shows the ayah alongside the commentary, so it carries the same
-- third column for the same reason.
drop function if exists public.next_unread_tafsir(text);

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
  translation_uz text,
  ayah_start     smallint,
  ayah_end       smallint,
  content        text,
  edition        text,
  verse_ids      integer[]
)
language sql
security definer
set search_path = public
stable
as $$
  select v.id,
         v.surah_number,
         v.ayah_number,
         v.ruku_number,
         s.name_english,
         v.arabic_text,
         v.translation_en,
         v.translation_ru,
         v.translation_uz,
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
   order by v.surah_number, v.ayah_number
   limit 1;
$$;

comment on function public.next_unread_tafsir(text) is
  'The first memorized ayah, in mushaf order, whose tafsir entry has not been marked read.';

grant execute on function public.next_unread_tafsir(text) to authenticated;
