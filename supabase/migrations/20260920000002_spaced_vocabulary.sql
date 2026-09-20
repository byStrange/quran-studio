-- ---------------------------------------------------------------------------
-- Spaced repetition for vocabulary, and two things it makes obsolete.
--
-- Three changes, and they are one change.
--
-- 1. A word's answer stops being a boolean. "Did you know it" has exactly two
--    outcomes, so a word could only ever be on or off, and the schedule that
--    followed was "missed words come back first" — which in a ten-word round
--    means the four you just failed are the first four you see next, while you
--    still remember failing them. That is not review, it is an echo. An answer
--    is now one of four grades (again / hard / good / easy) and it buys the
--    word an interval: minutes after a lapse, then a day, then a few days,
--    then weeks. `srs_next` is the whole scheduler, and it is the only place
--    the arithmetic lives — `quiz_pool` calls it to label the four buttons
--    with the interval each one would buy, so the reader is choosing between
--    consequences rather than adjectives.
--
-- 2. "Learned" gets a bar it has to clear. It used to mean "the last answer
--    was yes", which a single lucky round could buy and a single bad one could
--    take away. It now means the word's interval has reached 21 days — the
--    Anki maturity line — which cannot be reached without having answered it
--    correctly across weeks. One 'again' drops the interval to zero, so the
--    status is not a claim about the last answer but about the spacing the
--    word has actually survived.
--
-- 3. `words_learned_verses` is deleted. It was a second, disagreeing answer to
--    a question `user_word_progress` already answered: an ayah could have all
--    of its words marked learned and not be marked "words learned", or the
--    reverse. The marker is now derived — an ayah's words are learned when
--    every glossed word in it is — and the button that used to write that row
--    now does what it always said it did, which is mark the words. Existing
--    rows are migrated into the word list before the table is dropped, so a
--    reader who marked ayahs keeps every green marker they had.
-- ---------------------------------------------------------------------------

-- --- the scheduler ---------------------------------------------------------

create type public.review_grade as enum ('again', 'hard', 'good', 'easy');

comment on type public.review_grade is
  'How a vocabulary card was answered, once the gloss was showing. '
  '`again` is the only failing grade; the other three all pass, at different '
  'confidence, and buy different intervals.';

/**
 * Where "learned" starts, in days of interval.
 *
 * A function rather than a literal repeated in five places: the threshold is a
 * judgement call that is worth being able to move in one edit, and every
 * status decision in this file reads it.
 */
create or replace function public.srs_mature_days()
returns integer
language sql
immutable
as $$ select 21 $$;

create type public.srs_step as (
  ease          real,
  interval_days real,
  reps          integer,
  /** How far ahead the card is scheduled, in minutes from the answer. */
  due_minutes   double precision
);

/**
 * One step of the schedule: where a card goes when it is answered.
 *
 * An SM-2 variant with Anki's learning steps, and deliberately nothing more
 * clever. The two properties that matter are that a failed word comes back
 * inside the session but not inside the next ten cards, and that a word which
 * keeps being answered correctly leaves for long enough that answering it is
 * evidence of memory rather than of recency.
 *
 *   again — the interval is thrown away. A card still in the learning steps
 *           goes back to the first one, a minute out; a card that had a real
 *           interval has genuinely lapsed, so it waits ten minutes and pays an
 *           ease penalty. Ten rather than one for that case on purpose: a word
 *           re-asked immediately is answered off the screen you just read,
 *           which is the failure mode this whole migration exists to fix.
 *   hard  — right, but with effort. Ease drops a little; a card in review
 *           grows by 1.2 rather than by its ease.
 *   good  — right. In the learning steps this walks 10m → graduate at 1 day;
 *           in review it multiplies the interval by the card's ease.
 *   easy  — right and instant. Graduates straight to 4 days from learning, and
 *           takes a 1.3 bonus on top of ease in review.
 *
 * Immutable and pure, so `quiz_pool` can ask it what each button would do
 * without a second round trip and without a second copy of the arithmetic in
 * the client.
 */
create or replace function public.srs_next(
  p_ease          real,
  p_interval_days real,
  p_reps          integer,
  p_grade         public.review_grade
)
returns public.srs_step
language plpgsql
immutable
as $$
declare
  v      public.srs_step;
  v_ease real    := greatest(1.3::real, coalesce(p_ease, 2.5::real));
  v_iv   real    := greatest(0::real, coalesce(p_interval_days, 0::real));
  v_reps integer := greatest(0, coalesce(p_reps, 0));
begin
  if p_grade = 'again' then
    -- Only a card that had reached a real interval is penalised: failing a
    -- word you are still meeting for the first time is what learning steps
    -- are *for*, and charging ease for it would slow that word down forever.
    v.ease          := case when v_iv < 1 then v_ease
                            else greatest(1.3::real, v_ease - 0.20::real) end;
    v.interval_days := 0;
    v.reps          := 0;
    v.due_minutes   := case when v_iv < 1 then 1 else 10 end;

  elsif v_iv < 1 then
    -- Still in the learning steps: the card has never held a real interval.
    if p_grade = 'hard' then
      v.ease          := v_ease;
      v.interval_days := 0;
      v.reps          := v_reps;
      v.due_minutes   := 6;
    elsif p_grade = 'good' then
      v.ease := v_ease;
      v.reps := v_reps + 1;
      if v.reps >= 2 then
        v.interval_days := 1;
        v.due_minutes   := 1440;
      else
        v.interval_days := 0;
        v.due_minutes   := 10;
      end if;
    else
      v.ease          := least(3.0::real, v_ease + 0.15::real);
      v.reps          := v_reps + 1;
      v.interval_days := 4;
      v.due_minutes   := 4 * 1440;
    end if;

  else
    -- In review. The interval compounds; the ease decides how fast.
    v.reps := v_reps + 1;
    if p_grade = 'hard' then
      v.ease          := greatest(1.3::real, v_ease - 0.15::real);
      v.interval_days := least(365::real, v_iv * 1.2::real);
    elsif p_grade = 'good' then
      v.ease          := v_ease;
      v.interval_days := least(365::real, v_iv * v_ease);
    else
      v.ease          := least(3.0::real, v_ease + 0.15::real);
      v.interval_days := least(365::real, v_iv * v_ease * 1.3::real);
    end if;
    v.due_minutes := v.interval_days::double precision * 1440;
  end if;

  return v;
end;
$$;

comment on function public.srs_next(real, real, integer, public.review_grade) is
  'Where a vocabulary card goes when it is answered. The only copy of the schedule.';

/**
 * A word's status, read off its schedule rather than stored beside it.
 *
 * `status` stays a column because half the app filters on it, but it is a
 * cache of this function and nothing writes it by hand any more.
 */
create or replace function public.srs_status(
  p_interval_days real,
  p_reps          integer,
  p_reviewed      boolean
)
returns public.word_status
language sql
immutable
as $$
  select case
    when coalesce(p_interval_days, 0) >= public.srs_mature_days()
      then 'learned'::public.word_status
    when coalesce(p_reviewed, false) or coalesce(p_reps, 0) > 0
      then 'learning'::public.word_status
    else 'new'::public.word_status
  end;
$$;

-- --- the card's state ------------------------------------------------------

alter table public.user_word_progress
  add column if not exists ease          real    not null default 2.5,
  add column if not exists interval_days real    not null default 0,
  add column if not exists reps          integer not null default 0 check (reps >= 0),
  add column if not exists lapses        integer not null default 0 check (lapses >= 0),
  add column if not exists due_at        timestamptz;

comment on column public.user_word_progress.ease is
  'SM-2 ease factor, 1.3–3.0. How fast this word''s interval grows on a good answer.';
comment on column public.user_word_progress.interval_days is
  'Current scheduling interval. Below 1 the card is in the learning steps; at '
  'srs_mature_days() it counts as learned.';
comment on column public.user_word_progress.reps is
  'Consecutive passing answers. Reset to zero by a lapse, not by a hard answer.';
comment on column public.user_word_progress.due_at is
  'When the card next wants asking. Null only for rows written before the schedule existed.';

-- The 'due' scope and every "what is waiting" count reads this.
create index if not exists user_word_progress_due_idx
  on public.user_word_progress (user_id, due_at);

/**
 * Existing words get a schedule that matches what they were already claiming.
 *
 * A word marked learned under the old on/off rule is put at the maturity line
 * rather than above or below it: it keeps its green marker today, and the next
 * answer it gets — good or again — is what decides whether it stays there. A
 * word that was learning starts due now, which is exactly what it means.
 */
update public.user_word_progress
   set interval_days = case when status = 'learned' then public.srs_mature_days()::real else 0 end,
       reps          = case when status = 'learned' then greatest(2, least(reps, 20)) else 0 end,
       due_at        = case
                         when status = 'learned'
                           then coalesce(last_reviewed_at, now())
                                + make_interval(days => public.srs_mature_days())
                         else now()
                       end
 where due_at is null;

-- --- the answer ------------------------------------------------------------

alter table public.quiz_attempts
  add column if not exists grade public.review_grade;

comment on column public.quiz_attempts.grade is
  'The grade the reader gave, once the gloss was showing. `correct` is kept '
  'alongside it as `grade <> ''again''`, because the scoreboard counts passes '
  'and does not care which kind. Null for attempts recorded before grades '
  'existed.';

-- Replaced rather than kept beside the new one: a boolean answer no longer has
-- a meaning the scheduler can act on, so a caller still reaching for it would
-- be writing a row the schedule cannot use.
drop function if exists public.record_quiz_attempt(integer, boolean);
drop function if exists public.record_quiz_attempt(integer, boolean, boolean);

/**
 * Records one graded review and returns the word's new schedule.
 *
 * The schedule comes back rather than being fetched again because the round
 * says what the answer bought — "next in 4 days" — immediately under the
 * button that bought it, and a second round trip for a number the write
 * already computed would put a spinner in the middle of the rhythm.
 *
 * A word answered for the first time enters the list here, at whatever grade
 * it was given. There is still no marking step before a round.
 */
create or replace function public.record_vocab_review(
  p_word_id integer,
  p_grade   public.review_grade
)
returns table (
  status        public.word_status,
  ease          real,
  interval_days real,
  reps          integer,
  lapses        integer,
  due_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_ease    real;
  v_iv      real;
  v_reps    integer;
  v_lapses  integer;
  v_reviews integer;
  v_correct integer;
  v_step    public.srs_step;
  v_status  public.word_status;
  v_pass    boolean := p_grade <> 'again';
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select p.ease, p.interval_days, p.reps, p.lapses, p.review_count, p.correct_count
    into v_ease, v_iv, v_reps, v_lapses, v_reviews, v_correct
    from public.user_word_progress p
   where p.user_id = v_user and p.word_id = p_word_id;

  if not found then
    v_ease := 2.5; v_iv := 0; v_reps := 0; v_lapses := 0; v_reviews := 0; v_correct := 0;
  end if;

  v_step   := public.srs_next(v_ease, v_iv, v_reps, p_grade);
  v_status := public.srs_status(v_step.interval_days, v_step.reps, true);

  insert into public.quiz_attempts (user_id, word_id, correct, grade)
  values (v_user, p_word_id, v_pass, p_grade);

  insert into public.user_word_progress (
    user_id, word_id, status, ease, interval_days, reps, lapses,
    review_count, correct_count, last_reviewed_at, due_at, updated_at
  ) values (
    v_user, p_word_id, v_status, v_step.ease, v_step.interval_days, v_step.reps,
    v_lapses + (case when v_pass then 0 else 1 end),
    v_reviews + 1,
    v_correct + (case when v_pass then 1 else 0 end),
    now(),
    now() + make_interval(mins => v_step.due_minutes::integer),
    now()
  )
  on conflict (user_id, word_id) do update set
    status           = excluded.status,
    ease             = excluded.ease,
    interval_days    = excluded.interval_days,
    reps             = excluded.reps,
    lapses           = excluded.lapses,
    review_count     = excluded.review_count,
    correct_count    = excluded.correct_count,
    last_reviewed_at = excluded.last_reviewed_at,
    due_at           = excluded.due_at,
    updated_at       = excluded.updated_at;

  return query
    select p.status, p.ease, p.interval_days, p.reps, p.lapses, p.due_at
      from public.user_word_progress p
     where p.user_id = v_user and p.word_id = p_word_id;
end;
$$;

/**
 * Sets a word's status by hand, and gives it a schedule that agrees.
 *
 * The reader can still say "I know this one" without being quizzed on it —
 * from a word chip, from the vocabulary list, or for every word in an ayah at
 * once. What that cannot be any more is a status written straight into the
 * column, because the column is a cache of the schedule and the next review
 * would recompute it back. So a declaration is expressed as a schedule:
 * `learned` puts the word at the maturity line and out of sight for that long,
 * `learning` brings it back to zero and due now, `new` forgets it entirely.
 *
 * Marking learned never *shortens* an interval a word has genuinely earned —
 * a word already out at three months stays there.
 *
 * Takes an array because the ayah-level button is one act: "the words in this
 * ayah are learned" should be one write, not one per word.
 */
create or replace function public.set_words_status(
  p_word_ids integer[],
  p_status   public.word_status
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_ids     integer[] := coalesce(p_word_ids, array[]::integer[]);
  v_written integer := 0;
  v_mature  integer := public.srs_mature_days();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if array_length(v_ids, 1) is null then
    return 0;
  end if;

  if p_status = 'new' then
    delete from public.user_word_progress
     where user_id = v_user and word_id = any(v_ids);
    get diagnostics v_written = row_count;
    return v_written;
  end if;

  insert into public.user_word_progress as p (
    user_id, word_id, status, ease, interval_days, reps, due_at, updated_at
  )
  select v_user,
         ids.word_id,
         p_status,
         2.5,
         case when p_status = 'learned' then v_mature::real else 0::real end,
         case when p_status = 'learned' then 2 else 0 end,
         case when p_status = 'learned'
              then now() + make_interval(days => v_mature)
              else now()
         end,
         now()
    from (select distinct u as word_id from unnest(v_ids) as u) ids
  on conflict (user_id, word_id) do update set
    status        = excluded.status,
    interval_days = case when p_status = 'learned'
                         then greatest(p.interval_days, excluded.interval_days)
                         else 0::real end,
    reps          = case when p_status = 'learned'
                         then greatest(p.reps, excluded.reps)
                         else 0 end,
    due_at        = case when p_status = 'learned'
                         then greatest(coalesce(p.due_at, excluded.due_at), excluded.due_at)
                         else now() end,
    updated_at    = now();

  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- --- the pool --------------------------------------------------------------

drop function if exists public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint);

/**
 * One round of vocabulary cards, drawn from a scope.
 *
 *   due    — every word whose schedule says it wants asking, wherever it is.
 *            The daily driver, and the one scope that needs nothing marked:
 *            a word is due because you have answered it before, not because
 *            you have memorized the ayah it sits in.
 *   ruku   — every word in the ruku.
 *   surah  — every word in the surah.
 *   global — words in every ayah marked memorized.
 *
 * Only `global` asks about memorization, and that is the point of it: it is
 * the "test me on what I have actually learnt by heart" round. Naming a ruku
 * or a surah is already a specific enough request to be taken at face value,
 * and refusing it because nothing in that passage is marked memorized was a
 * rule the ruku scope never applied and the surah scope did — one door open,
 * one door shut, for the same question.
 *
 * A word with no gloss in the requested language is skipped rather than
 * returned blank: it cannot be answered, so it must not be asked.
 *
 * Ordering: due first, most overdue first; then words never seen, shuffled;
 * then words scheduled ahead, soonest first, so a round in a quiet scope still
 * fills up rather than coming back short.
 *
 * `pool_size` is how many words the scope holds and `due_count` how many of
 * them are waiting, both independent of the page `p_limit` asks for. The four
 * `next_*_minutes` columns are what each grade would buy this card, straight
 * from `srs_next`, so the buttons can be labelled with their consequences.
 */
create or replace function public.quiz_pool(
  p_scope    public.quiz_scope default 'due',
  p_limit    integer default 10,
  p_language text    default 'en',
  p_surah    smallint default null,
  p_ruku     smallint default null
)
returns table (
  word_id            integer,
  arabic             text,
  transliteration    text,
  gloss              text,
  status             public.word_status,
  tracked            boolean,
  surah_number       smallint,
  ayah_number        smallint,
  ruku_number        smallint,
  verse_id           integer,
  verse_arabic       text,
  translation_en     text,
  translation_ru     text,
  translation_uz     text,
  ease               real,
  interval_days      real,
  reps               integer,
  due_at             timestamptz,
  next_again_minutes double precision,
  next_hard_minutes  double precision,
  next_good_minutes  double precision,
  next_easy_minutes  double precision,
  pool_size          integer,
  due_count          integer
)
language sql
security definer
set search_path = public
stable
as $$
  with quizzable as (
    select w.id as word_id,
           w.arabic,
           w.transliteration,
           case when p_language = 'ru'
                then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
                else w.gloss_en
           end as gloss,
           v.id as verse_id,
           v.surah_number,
           v.ayah_number,
           v.ruku_number,
           v.arabic_text,
           v.translation_en,
           v.translation_ru,
           v.translation_uz,
           coalesce(p.status, 'new'::public.word_status) as status,
           (p.word_id is not null)                       as tracked,
           coalesce(p.ease, 2.5::real)                    as ease,
           coalesce(p.interval_days, 0::real)             as interval_days,
           coalesce(p.reps, 0)                            as reps,
           p.due_at
      from public.quran_words w
      join public.quran_verses v on v.id = w.verse_id
      left join public.user_word_progress p
             on p.word_id = w.id and p.user_id = auth.uid()
     -- Compared as text rather than as the enum: 'due' was added to the type
     -- one migration ago, and an enum literal in a function body is resolved
     -- when the body is parsed. Text keeps the two files independent.
     where case p_scope::text
             when 'ruku'  then v.ruku_number = p_ruku
             when 'surah' then v.surah_number = p_surah
             when 'due'   then p.word_id is not null
                               and p.due_at is not null
                               and p.due_at <= now()
             else exists (
                    select 1 from public.memorized_verses m
                     where m.user_id = auth.uid() and m.verse_id = v.id
                  )
           end
  ),
  ranked as (
    select q.*,
           (count(*) over ())::integer as pool_size,
           (count(*) filter (where q.due_at is not null and q.due_at <= now())
              over ())::integer        as due_count,
           row_number() over (
             order by
               case
                 when q.due_at is not null and q.due_at <= now() then 0
                 when not q.tracked                              then 1
                 else                                                 2
               end,
               q.due_at nulls last,
               random()
           ) as ord
      from quizzable q
     where coalesce(q.gloss, '') <> ''
  )
  -- The projections are computed here rather than in `ranked` so that
  -- `srs_next` runs four times per *card dealt*, not four times per word in
  -- the scope — the global scope is tens of thousands of rows wide.
  select r.word_id, r.arabic, r.transliteration, r.gloss, r.status, r.tracked,
         r.surah_number, r.ayah_number, r.ruku_number, r.verse_id,
         r.arabic_text, r.translation_en, r.translation_ru, r.translation_uz,
         r.ease, r.interval_days, r.reps, r.due_at,
         (public.srs_next(r.ease, r.interval_days, r.reps, 'again')).due_minutes,
         (public.srs_next(r.ease, r.interval_days, r.reps, 'hard')).due_minutes,
         (public.srs_next(r.ease, r.interval_days, r.reps, 'good')).due_minutes,
         (public.srs_next(r.ease, r.interval_days, r.reps, 'easy')).due_minutes,
         r.pool_size,
         r.due_count
    from ranked r
   where r.ord <= greatest(1, least(coalesce(p_limit, 10), 100))
   order by r.ord;
$$;

comment on function public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) is
  'A round of vocabulary cards: what is due, a ruku, a surah, or every memorized ayah.';

-- --- the knowledge pool, to the same scope rules ----------------------------

drop function if exists public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint);

/**
 * Verses in a scope, in random order, for a generated round.
 *
 * The scope rules are `quiz_pool`'s, so the two quiz types cover the same
 * ground and the same picker drives both: a named ruku or surah is taken
 * whole, and only "everything memorized" consults `memorized_verses`. The
 * `due` scope has no meaning here — nothing schedules an ayah — so it is read
 * as the memorized scope rather than as an error; the quiz screen does not
 * offer it for this round type.
 *
 * Verses with no translation in the requested language are skipped. The model
 * is given the translation to write questions from, and a verse it cannot read
 * produces a question about nothing.
 */
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
     where case p_scope::text
             when 'ruku'  then v.ruku_number = p_ruku
             when 'surah' then v.surah_number = p_surah
             else exists (
                    select 1 from public.memorized_verses m
                     where m.user_id = auth.uid() and m.verse_id = v.id
                  )
           end
       and coalesce(
             nullif(case when p_language = 'ru'
                         then coalesce(nullif(v.translation_ru, ''), v.translation_en)
                         when p_language = 'uz'
                         then coalesce(nullif(v.translation_uz, ''), v.translation_en)
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

-- --- "words learned" becomes a reading of the word list ---------------------

/**
 * The marker moves into the thing it was always describing.
 *
 * Every ayah someone marked keeps its marker, because the marker's own
 * definition — all of this ayah's words are learned — is now made true of the
 * words themselves. Words already out on a longer interval are left where they
 * are; the rest are put at the maturity line, which is the weakest claim that
 * still reads as learned.
 */
insert into public.user_word_progress as p (
  user_id, word_id, status, ease, interval_days, reps, due_at, created_at, updated_at
)
select wl.user_id,
       w.id,
       'learned'::public.word_status,
       2.5,
       public.srs_mature_days()::real,
       2,
       wl.learned_at + make_interval(days => public.srs_mature_days()),
       wl.learned_at,
       now()
  from public.words_learned_verses wl
  join public.quran_words w on w.verse_id = wl.verse_id
 where coalesce(w.gloss_en, '') <> ''
on conflict (user_id, word_id) do update set
  status        = 'learned',
  interval_days = greatest(p.interval_days, excluded.interval_days),
  reps          = greatest(p.reps, excluded.reps),
  due_at        = greatest(coalesce(p.due_at, excluded.due_at), excluded.due_at),
  updated_at    = now();

drop table public.words_learned_verses;

drop function if exists public.ruku_progress();

/**
 * Memorized, tafsir-read and words-learned counts for every ruku.
 *
 * `words_learned_count` is now computed rather than stored: an ayah counts
 * when it has at least one quizzable word and every one of them is learned.
 * Words with no gloss are excluded on both sides of that test, for the same
 * reason `quiz_pool` skips them — a word that can never be asked must never be
 * the thing holding an ayah back.
 */
create or replace function public.ruku_progress()
returns table (
  ruku_number         smallint,
  surah_number        smallint,
  verse_count         bigint,
  memorized_count     bigint,
  tafsir_read_count   bigint,
  words_learned_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with verse_words as (
    select v.id,
           count(*) filter (where coalesce(w.gloss_en, '') <> '') as glossed,
           count(*) filter (
             where coalesce(w.gloss_en, '') <> '' and p.status = 'learned'
           ) as learned
      from public.quran_verses v
      left join public.quran_words w on w.verse_id = v.id
      left join public.user_word_progress p
             on p.word_id = w.id and p.user_id = auth.uid()
     group by v.id
  )
  select v.ruku_number,
         min(v.surah_number)::smallint,
         count(*),
         count(m.verse_id),
         count(t.verse_id),
         count(*) filter (where vw.glossed > 0 and vw.learned = vw.glossed)
    from public.quran_verses v
    join verse_words vw on vw.id = v.id
    left join public.memorized_verses m
           on m.verse_id = v.id and m.user_id = auth.uid()
    left join public.tafsir_read_verses t
           on t.verse_id = v.id and t.user_id = auth.uid()
   group by v.ruku_number
   order by v.ruku_number;
$$;

drop function if exists public.word_progress_by_ruku();

/**
 * Per-ruku word totals, for the quiz buttons in the browser.
 *
 * `due_count` joins them, because "43 words · 12 to learn" says what is left
 * and not what is waiting, and the second is the one that decides whether to
 * open this ruku's round this evening.
 */
create or replace function public.word_progress_by_ruku()
returns table (
  ruku_number     smallint,
  word_count      bigint,
  learned_count   bigint,
  learning_count  bigint,
  untouched_count bigint,
  due_count       bigint
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
         count(*) filter (where p.word_id is null),
         count(*) filter (where p.due_at is not null and p.due_at <= now())
    from public.quran_words w
    join public.quran_verses v on v.id = w.verse_id
    left join public.user_word_progress p
           on p.word_id = w.id and p.user_id = auth.uid()
   where coalesce(w.gloss_en, '') <> ''
   group by v.ruku_number
   order by v.ruku_number;
$$;

/**
 * Vocabulary aggregates.
 *
 * `due` is added beside the counts, and it is the number the page now leads
 * with: how many words are learned is a score, how many are waiting is a
 * thing to do.
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
    'due', (
      select count(*) from public.user_word_progress
       where user_id = v_user and due_at is not null and due_at <= now()
    ),
    'rukus_read', (
      select count(distinct ruku_number)
        from public.reading_sessions
       where user_id = v_user and ruku_number is not null
    )
  );
end;
$$;

-- --- grants ----------------------------------------------------------------

grant execute on function public.srs_mature_days() to authenticated;
grant execute on function public.srs_next(real, real, integer, public.review_grade) to authenticated;
grant execute on function public.srs_status(real, integer, boolean) to authenticated;
grant execute on function public.record_vocab_review(integer, public.review_grade) to authenticated;
grant execute on function public.set_words_status(integer[], public.word_status) to authenticated;
grant execute on function public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;
grant execute on function public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;
grant execute on function public.ruku_progress() to authenticated;
grant execute on function public.word_progress_by_ruku() to authenticated;
grant execute on function public.vocabulary_overview() to authenticated;
