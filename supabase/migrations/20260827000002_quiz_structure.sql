drop function if exists public.quiz_pool(integer, text);

create or replace function public.quiz_pool(
  p_limit    integer default 10,
  p_language text    default 'en',
  p_status   public.word_status default null,
  p_surah    smallint default null,
  p_ruku     smallint default null
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
     and coalesce(
           nullif(case when p_language = 'ru'
                       then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
                       else w.gloss_en
                  end, ''),
           '') <> ''
     and (p_status is null or p.status = p_status)
     and (p_surah is null or v.surah_number = p_surah)
     and (p_ruku is null or v.ruku_number = p_ruku)
   order by
     -- If we didn't specify a status filter, prefer learning over learned
     case when p_status is null and p.status = 'learned' then 1 else 0 end,
     p.last_reviewed_at nulls first,
     random()
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

grant execute on function public.quiz_pool(integer, text, public.word_status, smallint, smallint) to authenticated;

create or replace function public.record_quiz_attempt(
  p_word_id integer,
  p_correct boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_status public.word_status;
  v_new_status public.word_status;
  v_review_count integer;
  v_correct_count integer;
begin
  insert into public.quiz_attempts (user_id, word_id, correct)
  values (auth.uid(), p_word_id, p_correct);

  select status, review_count, correct_count
    into v_current_status, v_review_count, v_correct_count
    from public.user_word_progress
   where user_id = auth.uid()
     and word_id = p_word_id;

  if not found then
    -- It shouldn't happen that a word is quizzed without being tracked, but fallback
    v_current_status := 'learning';
    v_review_count := 0;
    v_correct_count := 0;
  end if;

  v_new_status := v_current_status;
  if p_correct and v_current_status = 'learning' then
    v_new_status := 'learned';
  elsif not p_correct and v_current_status = 'learned' then
    v_new_status := 'learning';
  end if;

  insert into public.user_word_progress (
    user_id, word_id, status, review_count, correct_count, last_reviewed_at, updated_at
  ) values (
    auth.uid(), p_word_id, v_new_status, v_review_count + 1, v_correct_count + (case when p_correct then 1 else 0 end), now(), now()
  )
  on conflict (user_id, word_id) do update set
    status = excluded.status,
    review_count = excluded.review_count,
    correct_count = excluded.correct_count,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at;
end;
$$;

grant execute on function public.record_quiz_attempt(integer, boolean) to authenticated;

