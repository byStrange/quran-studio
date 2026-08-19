-- ---------------------------------------------------------------------------
-- The vocabulary quiz learns a second language.
--
-- `quiz_pool` and `quiz_distractors` both reached for `gloss_en` directly, so
-- a reader studying in Russian would be shown Russian words everywhere in the
-- app and then quizzed in English. Both now take a language and resolve the
-- gloss the same way the reader does.
--
-- The returned column is renamed `gloss_en` -> `gloss`, because it is no
-- longer necessarily English. That is a change of signature rather than of
-- body, so both functions are dropped and recreated rather than replaced.
-- ---------------------------------------------------------------------------

drop function if exists public.quiz_pool(integer);
drop function if exists public.quiz_distractors(text[], integer);

/**
 * One round of vocabulary questions, drawn from the caller's own tracked words.
 *
 * Ordering is unchanged: words never reviewed first, then least recently
 * reviewed, with "learning" ahead of "learned" and randomness breaking ties.
 *
 * `p_language` selects which gloss column answers the question. Russian falls
 * back to the English gloss for the ~1.5% of words the Russian corpus does not
 * cover, matching `lib/language.ts` — a word with no Russian gloss should
 * still be quizzable, just in English.
 */
create or replace function public.quiz_pool(
  p_limit    integer default 10,
  p_language text    default 'en'
)
returns table (
  word_id         integer,
  arabic          text,
  transliteration text,
  gloss           text,
  status          public.word_status,
  surah_number    smallint,
  ayah_number     smallint
)
language sql
security definer
set search_path = public
stable
as $$
  select w.id, w.arabic, w.transliteration,
         case when p_language = 'ru'
              then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
              else w.gloss_en
         end as gloss,
         p.status, v.surah_number, v.ayah_number
    from public.user_word_progress p
    join public.quran_words w  on w.id = p.word_id
    join public.quran_verses v on v.id = w.verse_id
   where p.user_id = auth.uid()
     -- Filters on the resolved gloss, not on gloss_en: the question is
     -- unanswerable if whichever column it will actually show is empty.
     and coalesce(
           nullif(case when p_language = 'ru'
                       then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
                       else w.gloss_en
                  end, ''),
           '') <> ''
   order by
     case when p.status = 'learned' then 1 else 0 end,
     p.last_reviewed_at nulls first,
     random()
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

/** Plausible wrong answers: real glosses from elsewhere in the Quran. */
create or replace function public.quiz_distractors(
  p_exclude  text[],
  p_limit    integer default 3,
  p_language text    default 'en'
)
returns table (gloss text)
language sql
security definer
set search_path = public
stable
as $$
  -- The distinct pass has to finish before randomising: Postgres rejects an
  -- ORDER BY expression that isn't in a SELECT DISTINCT list.
  select g.gloss
    from (
      select distinct
             case when p_language = 'ru'
                  then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
                  else w.gloss_en
             end as gloss
        from public.quran_words w
       where case when p_language = 'ru'
                  then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
                  else w.gloss_en
             end is not null
    ) g
   where g.gloss <> ''
     and length(g.gloss) < 40
     and not (g.gloss = any(coalesce(p_exclude, array[]::text[])))
   order by random()
   limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;

grant execute on function public.quiz_pool(integer, text) to authenticated;
grant execute on function public.quiz_distractors(text[], integer, text) to authenticated;
