-- ---------------------------------------------------------------------------
-- Knowledge quizzes, and the confirm step both quiz types now share.
--
-- Two things happen here.
--
-- First, every quiz answer becomes two answers. A reader used to say "I know
-- it" and be believed; that made the word list a record of confidence rather
-- than of knowledge, and confidence is exactly the thing a memorizer is worst
-- at judging. So the round now shows the answer after the claim and asks
-- again — "were you right?" — and it is that second answer that counts. The
-- first is kept as `claimed`, because the gap between the two is worth
-- knowing: a reader who claims a word and then concedes it is not the same
-- reader as one who never claimed it.
--
-- Second, a quiz type that is not vocabulary. Words are the smallest thing a
-- memorizer knows; what they actually want tested is the passage — which ayah
-- says a thing, which word carried a meaning, what follows a phrase. Those
-- questions cannot be drawn from a table, so they are generated: the app takes
-- a scope, draws verses from it (`quiz_verse_pool`), and the model writes one
-- question per verse. Nothing generated is trusted as content — the verse it
-- belongs to is always shown alongside, and the reader marks their own answer.
--
-- Generated questions are stored per answer rather than cached and reused.
-- They are cheap, a repeat round should not be the same ten questions, and a
-- question is only meaningful next to the answer it actually got.
-- ---------------------------------------------------------------------------

-- --- the confirm step, for the vocabulary round ----------------------------

alter table public.quiz_attempts
  add column if not exists claimed boolean;

comment on column public.quiz_attempts.claimed is
  'What the reader said before the answer was revealed. `correct` is what they '
  'confirmed after seeing it, and is the one that moves the word''s status. '
  'Null for attempts recorded before the confirm step existed.';

-- Replaced rather than overloaded: a two-argument call would still resolve to
-- the old function and silently record no claim.
drop function if exists public.record_quiz_attempt(integer, boolean);

/**
 * Records one recall, as confirmed.
 *
 * `p_correct` is the reader's answer *after* seeing the gloss, so it is the
 * one that decides status: knowing a word marks it learned, missing it marks
 * it learning, including from learned. `p_claimed` is what they said before,
 * kept only for the scoreboard; it never moves status, because a claim that
 * the reader themselves withdrew is not evidence of anything except optimism.
 */
create or replace function public.record_quiz_attempt(
  p_word_id integer,
  p_correct boolean,
  p_claimed boolean default null
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
  insert into public.quiz_attempts (user_id, word_id, correct, claimed)
  values (auth.uid(), p_word_id, p_correct, p_claimed);

  select review_count, correct_count
    into v_review_count, v_correct_count
    from public.user_word_progress
   where user_id = auth.uid()
     and word_id = p_word_id;

  if not found then
    v_review_count := 0;
    v_correct_count := 0;
  end if;

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

grant execute on function public.record_quiz_attempt(integer, boolean, boolean) to authenticated;

-- --- verses to build a knowledge round from --------------------------------

/**
 * Verses in a scope, in random order, for a generated round.
 *
 * The scope rules are `quiz_pool`'s, so the two quiz types cover the same
 * ground and the same picker drives both: a ruku is taken whole (memorizing a
 * ruku and being examined on it are the same session), while surah and global
 * are limited to ayahs the reader has marked memorized.
 *
 * Verses with no translation in the requested language are skipped. The model
 * is given the translation to write questions from, and a verse it cannot read
 * produces a question about nothing.
 *
 * `pool_size` is how many verses the scope holds, so the app can say "10 of
 * 43" before spending a generation.
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
  pool_size      integer
)
language sql
security definer
set search_path = public
stable
as $$
  with scope_verses as (
    select v.id, v.surah_number, v.ayah_number, v.ruku_number, v.arabic_text,
           v.translation_en, v.translation_ru, s.name_english
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
             nullif(case when p_language = 'ru'
                         then coalesce(nullif(v.translation_ru, ''), v.translation_en)
                         else v.translation_en
                    end, ''),
             '') <> ''
  )
  select id, surah_number, ayah_number, ruku_number, name_english,
         arabic_text, translation_en, translation_ru,
         (count(*) over ())::integer as pool_size
    from scope_verses
   order by random()
   limit greatest(1, least(coalesce(p_limit, 10), 30));
$$;

comment on function public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint) is
  'Random verses from a scope, as the source material for a generated knowledge round.';

grant execute on function public.quiz_verse_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;

-- --- knowledge rounds ------------------------------------------------------

/**
 * What a generated question asks about. The model picks one per question and
 * the mix is enforced app-side; the enum exists so the scoreboard can say
 * *which kind* of knowledge is weak, which is more actionable than one number.
 */
do $$
begin
  if not exists (select 1 from pg_type where typname = 'knowledge_question_kind') then
    create type public.knowledge_question_kind as enum (
      'locate',       -- content described, name the ayah
      'wording',      -- meaning given, name the Arabic word used for it
      'meaning',      -- ayah named, say what it states
      'continuation', -- opening given, say what follows
      'detail'        -- a named item in the passage: a number, a name, an attribute
    );
  end if;
end
$$;

create table if not exists public.knowledge_quiz_sessions (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  scope          public.quiz_scope not null,
  surah_number   smallint,
  ruku_number    smallint,
  language       text        not null default 'en',
  model_used     text,
  question_count smallint    not null default 0 check (question_count >= 0),
  answered_count smallint    not null default 0 check (answered_count >= 0),
  correct_count  smallint    not null default 0 check (correct_count >= 0),
  -- How many answers the reader revised at the confirm step, in either
  -- direction. The honest-reckoning number; see `knowledge_quiz_stats`.
  revised_count  smallint    not null default 0 check (revised_count >= 0),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index if not exists knowledge_quiz_sessions_user_idx
  on public.knowledge_quiz_sessions (user_id, started_at desc);

create table if not exists public.knowledge_quiz_answers (
  id          bigint      generated always as identity primary key,
  session_id  uuid        not null references public.knowledge_quiz_sessions (id) on delete cascade,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  position    smallint    not null,
  verse_id    integer     references public.quran_verses (id) on delete set null,
  kind        public.knowledge_question_kind not null,
  question    text        not null,
  -- The answer as generated, kept verbatim: it is what the reader marked
  -- themselves against, so a later reading of the score needs to see it.
  expected    text        not null,
  claimed     boolean     not null,
  correct     boolean     not null,
  answered_at timestamptz not null default now(),
  unique (session_id, position)
);

create index if not exists knowledge_quiz_answers_user_idx
  on public.knowledge_quiz_answers (user_id, answered_at desc);

alter table public.knowledge_quiz_sessions enable row level security;
alter table public.knowledge_quiz_answers  enable row level security;

create policy "own rows" on public.knowledge_quiz_sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.knowledge_quiz_answers
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

/**
 * Opens a round and returns its id.
 *
 * Called after generation succeeds, not before: a round that the model could
 * not produce questions for should leave no trace in the history, or the
 * scoreboard fills with empty sessions on a bad network.
 */
create or replace function public.start_knowledge_quiz(
  p_scope          public.quiz_scope,
  p_question_count smallint,
  p_language       text     default 'en',
  p_surah          smallint default null,
  p_ruku           smallint default null,
  p_model          text     default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.knowledge_quiz_sessions
    (user_id, scope, surah_number, ruku_number, language, model_used, question_count)
  values
    (auth.uid(), p_scope, p_surah, p_ruku, coalesce(p_language, 'en'), p_model,
     greatest(0, coalesce(p_question_count, 0)))
  returning id;
$$;

grant execute on function public.start_knowledge_quiz(public.quiz_scope, smallint, text, smallint, smallint, text) to authenticated;

/**
 * Records one answer, and keeps the session's counters in step with it.
 *
 * Upserted on `(session_id, position)` so that answering the same question
 * twice — the reader changing their mind at the confirm step, or a retried
 * write — corrects the row rather than adding a second one. The counters are
 * recomputed from the answers each time rather than incremented, which is
 * what makes that safe.
 *
 * `p_verse_id` is the verse the question was written from. It is checked
 * against the round's own scope only in the sense that the app supplies it
 * from the pool it drew; a null means the verse has since been removed.
 */
create or replace function public.record_knowledge_answer(
  p_session_id uuid,
  p_position   smallint,
  p_verse_id   integer,
  p_kind       public.knowledge_question_kind,
  p_question   text,
  p_expected   text,
  p_claimed    boolean,
  p_correct    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ownership is enforced here rather than left to RLS: the function is
  -- security definer, so without this check any session id would be writable.
  if not exists (
    select 1 from public.knowledge_quiz_sessions
     where id = p_session_id and user_id = auth.uid()
  ) then
    raise exception 'no such quiz session';
  end if;

  insert into public.knowledge_quiz_answers
    (session_id, user_id, position, verse_id, kind, question, expected, claimed, correct)
  values
    (p_session_id, auth.uid(), p_position, p_verse_id, p_kind, p_question, p_expected,
     p_claimed, p_correct)
  on conflict (session_id, position) do update set
    verse_id    = excluded.verse_id,
    kind        = excluded.kind,
    question    = excluded.question,
    expected    = excluded.expected,
    claimed     = excluded.claimed,
    correct     = excluded.correct,
    answered_at = now();

  update public.knowledge_quiz_sessions s
     set answered_count = a.answered,
         correct_count  = a.correct,
         revised_count  = a.revised
    from (
      select count(*)::smallint                                        as answered,
             count(*) filter (where correct)::smallint                 as correct,
             count(*) filter (where claimed is distinct from correct)::smallint as revised
        from public.knowledge_quiz_answers
       where session_id = p_session_id
    ) a
   where s.id = p_session_id;
end;
$$;

grant execute on function public.record_knowledge_answer(uuid, smallint, integer, public.knowledge_question_kind, text, text, boolean, boolean) to authenticated;

/** Closes a round. Separate from the last answer so an abandoned round stays open. */
create or replace function public.finish_knowledge_quiz(p_session_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.knowledge_quiz_sessions
     set completed_at = now()
   where id = p_session_id
     and user_id = auth.uid()
     and completed_at is null;
$$;

grant execute on function public.finish_knowledge_quiz(uuid) to authenticated;

-- --- the scoreboard --------------------------------------------------------

/**
 * Everything the quiz screens need to say how the reader is doing, in one row.
 *
 * Both quiz types are reported side by side because they measure different
 * things and a reader improving at one while sliding at the other should be
 * able to see that. Each carries a 30-day pair alongside the all-time pair:
 * an all-time accuracy is dominated by whatever happened in the first week and
 * stops moving, which is the opposite of what a progress number is for.
 *
 * `overclaimed` is the count of answers claimed before the reveal and conceded
 * after it. It is the honest-reckoning number and the one worth watching: it
 * does not measure knowledge, it measures how well the reader can tell whether
 * they have it. `recovered` is the mirror — answers given up on that turned out
 * to be right — and a high one means the reader is being harsh with themselves
 * rather than ignorant.
 */
create or replace function public.quiz_scoreboard()
returns table (
  vocab_attempts        bigint,
  vocab_correct         bigint,
  vocab_attempts_30d    bigint,
  vocab_correct_30d     bigint,
  vocab_overclaimed     bigint,
  vocab_recovered       bigint,
  words_learned         bigint,
  words_learning        bigint,
  knowledge_sessions    bigint,
  knowledge_answered    bigint,
  knowledge_correct     bigint,
  knowledge_answered_30d bigint,
  knowledge_correct_30d bigint,
  knowledge_overclaimed bigint,
  knowledge_recovered   bigint,
  knowledge_by_kind     jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  with vocab as (
    select count(*)                                                        as attempts,
           count(*) filter (where correct)                                 as correct,
           count(*) filter (where answered_at >= now() - interval '30 days') as attempts_30d,
           count(*) filter (where correct and answered_at >= now() - interval '30 days') as correct_30d,
           count(*) filter (where claimed and not correct)                  as overclaimed,
           count(*) filter (where claimed is not null and not claimed and correct) as recovered
      from public.quiz_attempts
     where user_id = auth.uid()
  ),
  words as (
    select count(*) filter (where status = 'learned')  as learned,
           count(*) filter (where status = 'learning') as learning
      from public.user_word_progress
     where user_id = auth.uid()
  ),
  sessions as (
    select count(*) as sessions
      from public.knowledge_quiz_sessions
     where user_id = auth.uid()
  ),
  answers as (
    select count(*)                                                        as answered,
           count(*) filter (where correct)                                 as correct,
           count(*) filter (where answered_at >= now() - interval '30 days') as answered_30d,
           count(*) filter (where correct and answered_at >= now() - interval '30 days') as correct_30d,
           count(*) filter (where claimed and not correct)                  as overclaimed,
           count(*) filter (where not claimed and correct)                  as recovered
      from public.knowledge_quiz_answers
     where user_id = auth.uid()
  ),
  by_kind as (
    select coalesce(
             jsonb_agg(
               jsonb_build_object('kind', kind, 'answered', answered, 'correct', correct)
               order by kind
             ),
             '[]'::jsonb
           ) as kinds
      from (
        select kind,
               count(*)                        as answered,
               count(*) filter (where correct) as correct
          from public.knowledge_quiz_answers
         where user_id = auth.uid()
         group by kind
      ) k
  )
  select vocab.attempts, vocab.correct, vocab.attempts_30d, vocab.correct_30d,
         vocab.overclaimed, vocab.recovered,
         words.learned, words.learning,
         sessions.sessions,
         answers.answered, answers.correct, answers.answered_30d, answers.correct_30d,
         answers.overclaimed, answers.recovered,
         by_kind.kinds
    from vocab, words, sessions, answers, by_kind;
$$;

grant execute on function public.quiz_scoreboard() to authenticated;

/**
 * Knowledge accuracy per surah, worst first.
 *
 * "How is my knowledge" is not one number — it is which surahs the reader can
 * be asked about and which they cannot. Surahs with fewer than three answers
 * are still returned rather than hidden, because early on that is all there
 * is; the caller decides what is too thin to draw a conclusion from.
 */
create or replace function public.knowledge_quiz_by_surah()
returns table (
  surah_number smallint,
  surah_name   text,
  answered     bigint,
  correct      bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select v.surah_number,
         s.name_english,
         count(*),
         count(*) filter (where a.correct)
    from public.knowledge_quiz_answers a
    join public.quran_verses v on v.id = a.verse_id
    join public.quran_surahs s on s.number = v.surah_number
   where a.user_id = auth.uid()
   group by v.surah_number, s.name_english
   order by (count(*) filter (where a.correct))::numeric / nullif(count(*), 0), count(*) desc;
$$;

grant execute on function public.knowledge_quiz_by_surah() to authenticated;

/** Recent rounds, newest first, for the history strip on the quiz screen. */
create or replace function public.knowledge_quiz_history(p_limit integer default 10)
returns table (
  id             uuid,
  scope          public.quiz_scope,
  surah_number   smallint,
  surah_name     text,
  ruku_number    smallint,
  answered_count smallint,
  correct_count  smallint,
  revised_count  smallint,
  started_at     timestamptz,
  completed_at   timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select q.id, q.scope, q.surah_number, s.name_english, q.ruku_number,
         q.answered_count, q.correct_count, q.revised_count,
         q.started_at, q.completed_at
    from public.knowledge_quiz_sessions q
    left join public.quran_surahs s on s.number = q.surah_number
   where q.user_id = auth.uid()
     and q.answered_count > 0
   order by q.started_at desc
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

grant execute on function public.knowledge_quiz_history(integer) to authenticated;
