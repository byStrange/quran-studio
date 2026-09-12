-- ---------------------------------------------------------------------------
-- Quiz scopes, blind recall, and the tafsir nudge.
--
-- Two changes to how words are quizzed.
--
-- First, the pool is no longer "words the reader remembered to mark". That
-- made the vocabulary deck a side effect of tapping, and made the natural
-- thing — finish a ruku, learn its words — take a dozen taps before the quiz
-- could even be started. A quiz now names a scope: a ruku, a surah's
-- memorized ayahs, or every memorized ayah in the Quran. The words come from
-- the verses in that scope; `user_word_progress` is where the answers are
-- *recorded*, not where the questions are chosen from.
--
-- Second, the multiple-choice round is gone from the app. Four options off a
-- shared gloss pool can be narrowed down without knowing the word — it tested
-- elimination, not vocabulary. The round is now a blind recall: the word is
-- shown, the reader says whether they know it, and a miss opens the ayah it
-- came from with its translation. So the RPCs below hand back the verse, not
-- a set of wrong answers. `quiz_distractors` is dropped with the format it
-- served.
-- ---------------------------------------------------------------------------

create type public.quiz_scope as enum ('ruku', 'surah', 'global');

-- Replaced rather than overloaded: the old pools are "the user's tracked
-- words" filtered any way you like, and a caller asking for `p_limit` with no
-- `p_scope` would silently resolve to one of them.
drop function if exists public.quiz_pool(integer);
drop function if exists public.quiz_pool(integer, text);
drop function if exists public.quiz_pool(integer, text, public.word_status, smallint, smallint);
drop function if exists public.quiz_distractors(text[], integer, text);

/**
 * One round of vocabulary questions, drawn from the verses in a scope.
 *
 *   ruku   — every word in the ruku. This is the "learn this ruku's words"
 *            round, and deliberately does not require the ruku to be marked
 *            memorized: reciting a ruku and knowing its words are separate
 *            steps, and the second usually follows the first.
 *   surah  — words in the ayahs of one surah that the reader has memorized.
 *   global — words in every memorized ayah.
 *
 * A word with no gloss in the requested language is skipped rather than
 * returned blank: it cannot be answered, so it must not be asked. Russian
 * falls back to English for the small share of words the Russian corpus does
 * not cover, matching `lib/language.ts`.
 *
 * `status` is coalesced to 'new' and paired with `tracked`, so the caller never
 * has to distinguish "row absent" from "row with a null status"; 'new' means
 * exactly "never answered", which is when the enum's own default applies.
 *
 * `pool_size` is the number of words the scope holds, independent of the
 * page `p_limit` asks for — the round shows "10 of 43" without a second call.
 *
 * Ordering: words being learned first, then never-asked ones, then ones
 * already known; longest-unseen before recently-seen; randomness breaks ties
 * so two rounds in a row are not the same ten words.
 */
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
  pool_size       integer
)
language sql
security definer
set search_path = public
stable
as $$
  with scope_verses as (
    select v.id, v.surah_number, v.ayah_number, v.ruku_number, v.arabic_text,
           v.translation_en, v.translation_ru
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
         arabic_text, translation_en, translation_ru,
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

/**
 * Records one recall.
 *
 * The rule is the one the reader asked for and the one that makes the word
 * list mean something: saying you know a word makes it *learned*; saying you
 * don't drops it to *learning* — including from *learned*, which is the whole
 * point of coming back to a word you once knew. Words that were never tracked
 * enter the list at the answer they were given, so a ruku-scope round is also
 * how words get onto the list in the first place, with no marking step first.
 */
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
  v_review_count  integer := 0;
  v_correct_count integer := 0;
  v_new_status    public.word_status;
begin
  insert into public.quiz_attempts (user_id, word_id, correct)
  values (auth.uid(), p_word_id, p_correct);

  select review_count, correct_count
    into v_review_count, v_correct_count
    from public.user_word_progress
   where user_id = auth.uid()
     and word_id = p_word_id;

  if not found then
    v_review_count := 0;
    v_correct_count := 0;
  end if;

  -- Through a typed variable rather than inline: a CASE yields text, and a
  -- text expression does not implicitly cast to an enum in an INSERT.
  v_new_status := case when p_correct then 'learned' else 'learning' end;

  insert into public.user_word_progress (
    user_id, word_id, status, review_count, correct_count, last_reviewed_at, updated_at
  ) values (
    auth.uid(),
    p_word_id,
    v_new_status,
    v_review_count + 1,
    v_correct_count + (case when p_correct then 1 else 0 end),
    now(),
    now()
  )
  on conflict (user_id, word_id) do update set
    status = excluded.status,
    review_count = excluded.review_count,
    correct_count = excluded.correct_count,
    last_reviewed_at = excluded.last_reviewed_at,
    updated_at = excluded.updated_at;
end;
$$;

/**
 * Per-ruku word totals, for the quiz buttons in the browser.
 *
 * Counts only words that can be quizzed at all — the same gloss filter
 * `quiz_pool` applies — so "43 words · 12 to learn" is a promise the round can
 * keep: the pool really is 43, and 12 of them are still learning.
 */
create or replace function public.word_progress_by_ruku()
returns table (
  ruku_number     smallint,
  word_count      bigint,
  learned_count   bigint,
  learning_count  bigint,
  untouched_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select v.ruku_number,
         count(*),
         count(*) filter (where p.status = 'learned'),
         count(*) filter (where p.status = 'learning'),
         count(*) filter (where p.word_id is null)
    from public.quran_words w
    join public.quran_verses v on v.id = w.verse_id
    left join public.user_word_progress p
           on p.word_id = w.id and p.user_id = auth.uid()
   where coalesce(w.gloss_en, '') <> ''
   group by v.ruku_number
   order by v.ruku_number;
$$;

/**
 * The next tafsir to read, in mushaf order.
 *
 * Memorizing an ayah and reading its commentary are separate progress, and the
 * second is the one that quietly never happens. So the app opens by offering
 * exactly one thing: the first memorized ayah, in surah-then-ayah order, whose
 * commentary has not been read. Positional rather than random because the
 * point is to get through them, and a random pick of 6,236 would finish
 * nowhere.
 *
 * "Not read" is judged over the whole tafsir entry, not the single ayah: an
 * entry covering 2:1-5 counts as read once any of those ayahs has been marked
 * read, so the reader is never offered the same passage again under a
 * different ayah number. The entry's full ayah range comes back as
 * `verse_ids`, so the caller can mark the whole thing read in one write.
 */
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

grant execute on function public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;
grant execute on function public.record_quiz_attempt(integer, boolean) to authenticated;
grant execute on function public.word_progress_by_ruku() to authenticated;
grant execute on function public.next_unread_tafsir(text) to authenticated;
