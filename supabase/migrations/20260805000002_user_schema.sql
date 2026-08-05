-- ---------------------------------------------------------------------------
-- Per-user data. Every table here is protected by RLS on user_id = auth.uid(),
-- so one account can never observe or modify another's progress.
-- ---------------------------------------------------------------------------

create type public.word_status as enum ('new', 'learning', 'learned');

create table public.profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  -- IANA name, e.g. 'Asia/Tashkent'. Drives streak day boundaries.
  timezone    text        not null default 'UTC',
  ui_prefs    jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.user_word_progress (
  user_id          uuid        not null references auth.users (id) on delete cascade,
  word_id          integer     not null references public.quran_words (id) on delete cascade,
  status           public.word_status not null default 'learning',
  last_reviewed_at timestamptz,
  review_count     integer     not null default 0 check (review_count >= 0),
  correct_count    integer     not null default 0 check (correct_count >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, word_id)
);

create index user_word_progress_status_idx on public.user_word_progress (user_id, status);
-- Supports the quiz's "least recently reviewed first" ordering.
create index user_word_progress_review_idx on public.user_word_progress (user_id, last_reviewed_at nulls first);

create table public.quiz_attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  word_id     integer     not null references public.quran_words (id) on delete cascade,
  correct     boolean     not null,
  answered_at timestamptz not null default now()
);

create index quiz_attempts_user_idx on public.quiz_attempts (user_id, answered_at desc);

create table public.memorized_verses (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  verse_id     integer     not null references public.quran_verses (id) on delete cascade,
  memorized_at timestamptz not null default now(),
  primary key (user_id, verse_id)
);

-- Source of truth for hours and streaks. `day` is a calendar date in the
-- user's own timezone, resolved server-side when the session is logged.
create table public.daily_reading (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  day          date        not null,
  seconds_read integer     not null default 0 check (seconds_read >= 0),
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

create index daily_reading_user_day_idx on public.daily_reading (user_id, day desc);

-- Raw append-only session log. Rolls up into daily_reading; kept so reading
-- history stays auditable and can be re-derived if the rollup is ever wrong.
create table public.reading_sessions (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  seconds     integer     not null check (seconds >= 0),
  ruku_number smallint,
  created_at  timestamptz not null default now()
);

create index reading_sessions_user_idx on public.reading_sessions (user_id, started_at desc);

-- Materialized cache over daily_reading. Never written by hand: a trigger
-- recomputes it from the raw daily totals whenever those change.
create table public.streak_state (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  current_streak    integer not null default 0,
  longest_streak    integer not null default 0,
  last_counted_date date,
  grace_started_on  date,
  grace_expires_on  date,
  computed_at       timestamptz not null default now()
);

-- --- RLS -------------------------------------------------------------------

alter table public.profiles           enable row level security;
alter table public.user_word_progress enable row level security;
alter table public.quiz_attempts      enable row level security;
alter table public.memorized_verses   enable row level security;
alter table public.daily_reading      enable row level security;
alter table public.reading_sessions   enable row level security;
alter table public.streak_state       enable row level security;

create policy "own rows" on public.profiles
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.user_word_progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.quiz_attempts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.memorized_verses
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.daily_reading
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.reading_sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Read-only to the client: only the trigger (security definer) may write it.
create policy "own streak is readable" on public.streak_state
  for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete on public.streak_state from anon, authenticated;
