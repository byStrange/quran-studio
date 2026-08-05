-- ---------------------------------------------------------------------------
-- Functions, triggers, and RPCs.
-- ---------------------------------------------------------------------------

-- --- Profile bootstrapping -------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.streak_state (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- Streak computation -----------------------------------------------------
--
-- Recomputed from scratch over `daily_reading`, which is the source of truth.
-- Nothing here mutates a counter incrementally, so the result is always
-- auditable against the raw per-day totals.
--
-- Rules (from the product spec):
--   * A calendar day in the user's own timezone counts if any reading time
--     was logged that day.
--   * A fully missed day does not reset the streak immediately. It opens a
--     "grace" window covering the 3 days that follow the missed day.
--   * To restore during that window the user must read at least 1 cumulative
--     hour in a single day. The streak then continues rather than resetting.
--   * If the window lapses with no qualifying day, the streak resets to 0 and
--     the next day with any reading starts a fresh streak at 1.
--   * Reading less than an hour during the grace window does not restore the
--     streak; the window keeps running.
--   * Today is never treated as a missed day, since it is not over yet.

create or replace function public.recompute_streak(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz            text;
  v_today         date;
  v_day           date;
  v_first         date;
  v_seconds       integer;
  v_streak        integer := 0;
  v_longest       integer := 0;
  v_last_counted  date;
  v_grace_start   date;
  v_grace_expires date;
  v_in_grace      boolean := false;
begin
  select coalesce(timezone, 'UTC') into v_tz from public.profiles where user_id = p_user_id;
  v_tz := coalesce(v_tz, 'UTC');
  v_today := (now() at time zone v_tz)::date;

  select min(day) into v_first
    from public.daily_reading
   where user_id = p_user_id and seconds_read > 0;

  -- No reading has ever been logged: everything is zero, but keep the
  -- historical longest streak if one somehow exists.
  if v_first is null then
    insert into public.streak_state (user_id, current_streak, longest_streak, computed_at)
    values (p_user_id, 0, 0, now())
    on conflict (user_id) do update
      set current_streak    = 0,
          last_counted_date = null,
          grace_started_on  = null,
          grace_expires_on  = null,
          computed_at       = now();
    return;
  end if;

  v_day := v_first;
  while v_day <= v_today loop
    select seconds_read into v_seconds
      from public.daily_reading
     where user_id = p_user_id and day = v_day;
    v_seconds := coalesce(v_seconds, 0);

    if v_in_grace then
      if v_day > v_grace_expires then
        -- The window lapsed without a qualifying hour.
        v_streak := 0;
        v_in_grace := false;
        v_grace_start := null;
        v_grace_expires := null;
        if v_seconds > 0 then
          v_streak := 1;
          v_last_counted := v_day;
        end if;
      elsif v_seconds >= 3600 then
        -- Restored: the streak continues as if the miss had not happened.
        v_streak := v_streak + 1;
        v_last_counted := v_day;
        v_in_grace := false;
        v_grace_start := null;
        v_grace_expires := null;
      end if;
      -- Otherwise the day passes without counting and the window keeps running.
    else
      if v_seconds > 0 then
        v_streak := v_streak + 1;
        v_last_counted := v_day;
      elsif v_streak > 0 and v_day < v_today then
        -- A genuine miss on a completed day opens the grace window.
        v_in_grace := true;
        v_grace_start := v_day;
        v_grace_expires := v_day + 3;
      end if;
    end if;

    if v_streak > v_longest then
      v_longest := v_streak;
    end if;

    v_day := v_day + 1;
  end loop;

  insert into public.streak_state (
    user_id, current_streak, longest_streak,
    last_counted_date, grace_started_on, grace_expires_on, computed_at
  )
  values (
    p_user_id, v_streak, v_longest,
    v_last_counted, v_grace_start, v_grace_expires, now()
  )
  on conflict (user_id) do update
    set current_streak    = excluded.current_streak,
        -- Guard against a shrinking record if history is ever edited.
        longest_streak    = greatest(public.streak_state.longest_streak, excluded.longest_streak),
        last_counted_date = excluded.last_counted_date,
        grace_started_on  = excluded.grace_started_on,
        grace_expires_on  = excluded.grace_expires_on,
        computed_at       = now();
end;
$$;

-- Keep streak_state in sync with any change to the raw daily totals.
create or replace function public.trg_recompute_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_streak(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

create trigger daily_reading_streak_sync
  after insert or update or delete on public.daily_reading
  for each row execute function public.trg_recompute_streak();

-- --- Reading session logging ------------------------------------------------
--
-- The client reports elapsed seconds; the day boundary is resolved here using
-- the user's stored timezone so the client clock can't skew streak accounting.

create or replace function public.log_reading(
  p_seconds     integer,
  p_ruku_number smallint default null,
  p_started_at  timestamptz default null
)
returns public.streak_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_tz     text;
  v_day    date;
  v_start  timestamptz;
  v_result public.streak_state;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_seconds is null or p_seconds <= 0 then
    select * into v_result from public.streak_state where user_id = v_user;
    return v_result;
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.profiles where user_id = v_user;
  v_tz := coalesce(v_tz, 'UTC');

  -- A session is attributed to the day it ended in the user's timezone.
  v_day := (now() at time zone v_tz)::date;
  v_start := coalesce(p_started_at, now() - make_interval(secs => p_seconds));

  insert into public.reading_sessions (user_id, started_at, ended_at, seconds, ruku_number)
  values (v_user, v_start, now(), p_seconds, p_ruku_number);

  insert into public.daily_reading (user_id, day, seconds_read)
  values (v_user, v_day, p_seconds)
  on conflict (user_id, day) do update
    set seconds_read = public.daily_reading.seconds_read + excluded.seconds_read,
        updated_at   = now();
  -- The trigger on daily_reading has now refreshed streak_state.

  select * into v_result from public.streak_state where user_id = v_user;
  return v_result;
end;
$$;

-- --- Dashboard aggregates ---------------------------------------------------

create or replace function public.reading_overview()
returns json
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user  uuid := auth.uid();
  v_tz    text;
  v_today date;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  select coalesce(timezone, 'UTC') into v_tz from public.profiles where user_id = v_user;
  v_tz := coalesce(v_tz, 'UTC');
  v_today := (now() at time zone v_tz)::date;

  return (
    select json_build_object(
      'today_seconds',  coalesce(sum(seconds_read) filter (where day = v_today), 0),
      'week_seconds',   coalesce(sum(seconds_read) filter (where day > v_today - 7), 0),
      'month_seconds',  coalesce(sum(seconds_read) filter (where day > v_today - 30), 0),
      'total_seconds',  coalesce(sum(seconds_read), 0),
      'days_read',      count(*) filter (where seconds_read > 0),
      'today',          v_today
    )
    from public.daily_reading
    where user_id = v_user
  );
end;
$$;

create or replace function public.memorization_overview()
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
    'verses_memorized', (select count(*) from public.memorized_verses where user_id = v_user),
    'total_verses',     (select count(*) from public.quran_verses),
    'surahs_completed', (
      -- A surah counts as complete when every one of its ayahs is marked.
      select count(*)
        from public.quran_surahs s
       where s.ayah_count = (
         select count(*)
           from public.memorized_verses m
           join public.quran_verses v on v.id = m.verse_id
          where m.user_id = v_user and v.surah_number = s.number
       )
    ),
    'words_learned',    (
      select count(*) from public.user_word_progress
       where user_id = v_user and status = 'learned'
    ),
    'words_learning',   (
      select count(*) from public.user_word_progress
       where user_id = v_user and status = 'learning'
    )
  );
end;
$$;

-- --- Grants -----------------------------------------------------------------

revoke execute on function public.recompute_streak(uuid) from public, anon, authenticated;

grant execute on function public.log_reading(integer, smallint, timestamptz) to authenticated;
grant execute on function public.reading_overview() to authenticated;
grant execute on function public.memorization_overview() to authenticated;
