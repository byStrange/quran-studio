-- Keep the streak honest when nothing is being written.
--
-- `streak_state` is recomputed by a trigger on `daily_reading`. That covers
-- every change the user makes, but the event this feature is actually about —
-- a day passing with no reading — writes no row, so the trigger never fires.
-- A reader who stops reading keeps whatever state was computed on their last
-- active day: the streak stays at its old number, and a grace window that has
-- since lapsed still looks open.
--
-- Reading the streak is therefore made to refresh it. The rules themselves are
-- untouched; `recompute_streak` remains the single definition of them.

create or replace function public.current_streak()
returns public.streak_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_tz    text;
  v_state public.streak_state;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(timezone, 'UTC') into v_tz from public.profiles where user_id = v_user;
  v_tz := coalesce(v_tz, 'UTC');

  select * into v_state from public.streak_state where user_id = v_user;

  -- Only the date matters to the streak rules, so state computed earlier today
  -- is still correct and is served as-is. That caps the recompute at once per
  -- day per user, rather than once per dashboard load.
  if v_state.user_id is null
     or (v_state.computed_at at time zone v_tz)::date < (now() at time zone v_tz)::date
  then
    perform public.recompute_streak(v_user);
    select * into v_state from public.streak_state where user_id = v_user;
  end if;

  return v_state;
end;
$$;

grant execute on function public.current_streak() to authenticated;
