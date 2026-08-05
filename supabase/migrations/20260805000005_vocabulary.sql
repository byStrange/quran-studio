-- ---------------------------------------------------------------------------
-- Vocabulary aggregates and quiz selection.
-- ---------------------------------------------------------------------------

/**
 * "Encountered" is derived from where the user has actually read: every word
 * in any ruku they have logged a reading session for. That is more honest than
 * counting only words they happened to tap, which would make the denominator
 * grow only when they interact.
 */
create or replace function public.vocabulary_overview()
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  return json_build_object(
    'encountered', (
      select count(*)
        from public.quran_words w
        join public.quran_verses v on v.id = w.verse_id
       where v.ruku_number in (
         select distinct ruku_number
           from public.reading_sessions
          where user_id = v_user and ruku_number is not null
       )
    ),
    'learned', (
      select count(*) from public.user_word_progress
       where user_id = v_user and status = 'learned'
    ),
    'learning', (
      select count(*) from public.user_word_progress
       where user_id = v_user and status = 'learning'
    ),
    'rukus_read', (
      select count(distinct ruku_number)
        from public.reading_sessions
       where user_id = v_user and ruku_number is not null
    )
  );
end;
$$;

/**
 * Quiz pool.
 *
 * Deliberately not a full spaced-repetition implementation. The ordering
 * prioritises, in this order: words never reviewed, words reviewed longest
 * ago, and words still marked "learning" over ones already marked "learned".
 * Randomness breaks ties so repeat sessions aren't identical.
 */
create or replace function public.quiz_pool(p_limit integer default 10)
returns table (
  word_id         integer,
  arabic          text,
  transliteration text,
  gloss_en        text,
  status          public.word_status,
  surah_number    smallint,
  ayah_number     smallint
)
language sql
security definer
set search_path = public
stable
as $$
  select w.id, w.arabic, w.transliteration, w.gloss_en,
         p.status, v.surah_number, v.ayah_number
    from public.user_word_progress p
    join public.quran_words w  on w.id = p.word_id
    join public.quran_verses v on v.id = w.verse_id
   where p.user_id = auth.uid()
     and w.gloss_en is not null
     and w.gloss_en <> ''
   order by
     case when p.status = 'learned' then 1 else 0 end,
     p.last_reviewed_at nulls first,
     random()
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

/** Plausible wrong answers: real glosses from elsewhere in the Quran. */
create or replace function public.quiz_distractors(
  p_exclude text[],
  p_limit   integer default 3
)
returns table (gloss_en text)
language sql
security definer
set search_path = public
stable
as $$
  -- The distinct pass has to finish before randomising: Postgres rejects an
  -- ORDER BY expression that isn't in a SELECT DISTINCT list.
  select g.gloss_en
    from (
      select distinct w.gloss_en
        from public.quran_words w
       where w.gloss_en is not null
         and w.gloss_en <> ''
         and length(w.gloss_en) < 40
         and not (w.gloss_en = any(coalesce(p_exclude, array[]::text[])))
    ) g
   order by random()
   limit greatest(1, least(coalesce(p_limit, 3), 10));
$$;

grant execute on function public.vocabulary_overview() to authenticated;
grant execute on function public.quiz_pool(integer) to authenticated;
grant execute on function public.quiz_distractors(text[], integer) to authenticated;
