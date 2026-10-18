-- ---------------------------------------------------------------------------
-- Uzbek word-by-word glosses, built in the app by trusted volunteers.
--
-- The uzbek_mode migration deliberately left `gloss_uz` off `quran_words`:
-- there was no Uzbek word-by-word corpus upstream to fill it with. This builds
-- that corpus a different way. A contributor photographs a page of a physical
-- Uzbek word-by-word mushaf, the app's Ollama vision model reads the Cyrillic
-- gloss under each Arabic word, the contributor corrects the draft, and the
-- batch waits in a review queue until a reviewer approves it into `gloss_uz`.
--
-- Three things are new here and nothing like them existed before:
--   - `gloss_uz` on quran_words — the live corpus column, read exactly like
--     `gloss_ru` (public read, service-role/definer write).
--   - an allowlist (`gloss_uz_contributors`) — the app had no notion of roles
--     at all; this is the whole of it, a small table you populate by hand with
--     the service role. `can_review` marks the few who may approve.
--   - a staging pair (`gloss_uz_batches` + `gloss_uz_submissions`) that holds a
--     submission until a reviewer approves or rejects it. Nothing a contributor
--     submits reaches a reader until then.
--
-- All writes go through the `security definer` RPCs at the bottom, which carry
-- the gate inside them (contributor to submit, reviewer to approve) — the
-- tables themselves take no client insert/update/delete, the same shape as the
-- content tables. This mirrors `set_word_glosses_ru`, but opened to gated
-- authenticated callers rather than the service role alone, because the app has
-- no service-role key at runtime.
-- ---------------------------------------------------------------------------

-- --- the corpus column -----------------------------------------------------
-- Nullable, and null for every row until a batch is approved. Reads fall back
-- to the English gloss per word (see lib/language.ts `wordGloss`), so the app
-- is correct before anything is imported and better after it — the same
-- contract `gloss_ru` has.
alter table public.quran_words add column gloss_uz text;

comment on column public.quran_words.gloss_uz is
  'Uzbek word-by-word gloss (Cyrillic), built in-app from photographed mushaf '
  'pages and approved through the review queue. Null falls back to gloss_en.';

-- --- the allowlist ---------------------------------------------------------
-- The app's only notion of "who may do this". Rows are added with the service
-- role (SQL editor); no client may write it. A contributor may read their own
-- row so the app can decide whether to show the tool.
create table public.gloss_uz_contributors (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  can_review boolean     not null default false,
  note       text,
  added_at   timestamptz not null default now()
);

comment on table public.gloss_uz_contributors is
  'Accounts allowed to use the Uzbek gloss contribution tool. can_review marks reviewers who may approve batches.';

alter table public.gloss_uz_contributors enable row level security;

create policy "own membership is readable" on public.gloss_uz_contributors
  for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.gloss_uz_contributors from anon, authenticated;

-- --- the staging queue -----------------------------------------------------
create table public.gloss_uz_batches (
  id           uuid        primary key default gen_random_uuid(),
  submitted_by uuid        not null references auth.users (id) on delete cascade,
  surah_number smallint    not null,
  ayah_start   smallint    not null,
  ayah_end     smallint    not null,
  status       text        not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected')),
  note         text,
  submitted_at timestamptz not null default now(),
  reviewed_by  uuid        references auth.users (id) on delete set null,
  reviewed_at  timestamptz
);

comment on table public.gloss_uz_batches is
  'One submission of proposed Uzbek glosses for an ayah range, awaiting review.';

create index gloss_uz_batches_status_idx on public.gloss_uz_batches (status, submitted_at);

create table public.gloss_uz_submissions (
  id             bigint generated always as identity primary key,
  batch_id       uuid    not null references public.gloss_uz_batches (id) on delete cascade,
  word_id        integer not null references public.quran_words (id) on delete cascade,
  proposed_gloss text    not null
);

comment on table public.gloss_uz_submissions is
  'The per-word proposed Uzbek glosses of one batch; copied into quran_words.gloss_uz on approval.';

create index gloss_uz_submissions_batch_idx on public.gloss_uz_submissions (batch_id);

alter table public.gloss_uz_batches enable row level security;
alter table public.gloss_uz_submissions enable row level security;

-- Readable by the contributor who submitted it, and by any reviewer. Writes go
-- only through the RPCs below, so no insert/update/delete policy exists and the
-- grants are revoked.
create policy "own or reviewer can read batches" on public.gloss_uz_batches
  for select to authenticated using (
    submitted_by = auth.uid()
    or exists (
      select 1 from public.gloss_uz_contributors c
       where c.user_id = auth.uid() and c.can_review
    )
  );

create policy "own or reviewer can read submissions" on public.gloss_uz_submissions
  for select to authenticated using (
    exists (
      select 1 from public.gloss_uz_batches b
       where b.id = batch_id
         and (
           b.submitted_by = auth.uid()
           or exists (
             select 1 from public.gloss_uz_contributors c
              where c.user_id = auth.uid() and c.can_review
           )
         )
    )
  );

revoke insert, update, delete on public.gloss_uz_batches from anon, authenticated;
revoke insert, update, delete on public.gloss_uz_submissions from anon, authenticated;

-- --- RPCs ------------------------------------------------------------------
-- Every write path. Each is `security definer` (runs as the table owner, which
-- bypasses the revokes above) and carries its own gate, so being granted to
-- `authenticated` is safe: a caller who is not a contributor / reviewer is
-- refused inside the function.

-- What the app asks to decide whether to show the tool and the reviewer view.
create or replace function public.gloss_contributor_status()
returns table (is_contributor boolean, can_review boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (select 1 from public.gloss_uz_contributors c where c.user_id = auth.uid()),
    coalesce(
      (select c.can_review from public.gloss_uz_contributors c where c.user_id = auth.uid()),
      false
    );
$$;

comment on function public.gloss_contributor_status() is
  'Whether the caller may use the Uzbek gloss tool, and whether they may approve batches.';

-- Stage a batch of proposed glosses. p_rows is [{word_id, gloss}, …]; empty
-- glosses are skipped so a word the model could not read is simply left for a
-- later pass rather than stored blank.
create or replace function public.submit_gloss_uz(
  p_surah smallint,
  p_start smallint,
  p_end   smallint,
  p_rows  jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  v_count integer;
begin
  if not exists (
    select 1 from public.gloss_uz_contributors c where c.user_id = auth.uid()
  ) then
    raise exception 'not a gloss contributor' using errcode = '42501';
  end if;

  insert into public.gloss_uz_batches (submitted_by, surah_number, ayah_start, ayah_end)
    values (auth.uid(), p_surah, p_start, p_end)
    returning id into v_batch;

  -- Only words that actually sit in the declared range are stored. The allowlist
  -- trusts the contributor, but the batch's range label is what a reviewer reads
  -- before approving, so a row whose word_id belongs to some other verse — a
  -- client bug, or a hand-crafted request — must not ride in under it and get
  -- written to an unrelated word on approval. Out-of-range rows are dropped
  -- here; a batch left with nothing then fails the empty check below.
  insert into public.gloss_uz_submissions (batch_id, word_id, proposed_gloss)
    select v_batch, (r->>'word_id')::integer, btrim(r->>'gloss')
      from jsonb_array_elements(p_rows) as r
     where coalesce(btrim(r->>'gloss'), '') <> ''
       and exists (
         select 1
           from public.quran_words w
           join public.quran_verses v on v.id = w.verse_id
          where w.id = (r->>'word_id')::integer
            and v.surah_number = p_surah
            and v.ayah_number between p_start and p_end
       );

  get diagnostics v_count = row_count;
  -- A batch with nothing in it is noise in the reviewer's queue.
  if v_count = 0 then
    delete from public.gloss_uz_batches where id = v_batch;
    raise exception 'no non-empty glosses to submit' using errcode = '22023';
  end if;

  return v_batch;
end;
$$;

comment on function public.submit_gloss_uz(smallint, smallint, smallint, jsonb) is
  'Stages a contributor''s proposed Uzbek glosses as a pending batch; returns the batch id.';

-- Approve a pending batch: copy its glosses into the live corpus (idempotent,
-- skipping rows already at that value) and mark it approved.
create or replace function public.approve_gloss_batch(p_batch uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.gloss_uz_contributors c
     where c.user_id = auth.uid() and c.can_review
  ) then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.gloss_uz_batches b where b.id = p_batch and b.status = 'pending'
  ) then
    raise exception 'batch is not pending' using errcode = '22023';
  end if;

  with upd as (
    update public.quran_words w
       set gloss_uz = s.proposed_gloss
      from public.gloss_uz_submissions s
     where s.batch_id = p_batch
       and s.word_id = w.id
       and w.gloss_uz is distinct from s.proposed_gloss
    returning 1
  )
  select count(*)::integer into v_count from upd;

  update public.gloss_uz_batches
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_batch;

  return v_count;
end;
$$;

comment on function public.approve_gloss_batch(uuid) is
  'Reviewer-only: copies a pending batch''s glosses into quran_words.gloss_uz and marks it approved.';

create or replace function public.reject_gloss_batch(p_batch uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.gloss_uz_contributors c
     where c.user_id = auth.uid() and c.can_review
  ) then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  update public.gloss_uz_batches
     set status = 'rejected',
         note = coalesce(p_note, note),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_batch and status = 'pending';
end;
$$;

comment on function public.reject_gloss_batch(uuid, text) is
  'Reviewer-only: marks a pending batch rejected, writing nothing to the corpus.';

revoke all on function public.gloss_contributor_status() from public;
revoke all on function public.submit_gloss_uz(smallint, smallint, smallint, jsonb) from public;
revoke all on function public.approve_gloss_batch(uuid) from public;
revoke all on function public.reject_gloss_batch(uuid, text) from public;

grant execute on function public.gloss_contributor_status() to authenticated;
grant execute on function public.submit_gloss_uz(smallint, smallint, smallint, jsonb) to authenticated;
grant execute on function public.approve_gloss_batch(uuid) to authenticated;
grant execute on function public.reject_gloss_batch(uuid, text) to authenticated;

-- --- quiz pool: teach it the Uzbek gloss -----------------------------------
-- The vocabulary pool resolved every non-Russian gloss to English because there
-- was no gloss_uz. There is now, so Uzbek gets the same coalesce Russian has —
-- the only change from the current definition (20260920000002_spaced_vocabulary)
-- is the added `uz` arm in the gloss CASE. The whole body is reproduced so this
-- replace keeps the SRS scheduling intact rather than regressing it; the return
-- signature is unchanged, so `create or replace` suffices, and the grant is
-- reasserted since a recreate drops it. (The sibling `quiz_verse_pool` already
-- handles `uz`, so it needs nothing here.)
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
           case
             when p_language = 'ru' then coalesce(nullif(w.gloss_ru, ''), w.gloss_en)
             when p_language = 'uz' then coalesce(nullif(w.gloss_uz, ''), w.gloss_en)
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

grant execute on function
  public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;
