-- ---------------------------------------------------------------------------
-- Uzbek glosses become phrase-level (segments), not word-level.
--
-- The printed Uzbek word-by-word mushaf glosses *runs* of Arabic words, not
-- single words: `ٱلَّذِينَ أَنْعَمْتَ عَلَيْهِمْ` carries one gloss,
-- "Сен инъом қилган зотларнинг йўлига". The original design (20261018000001)
-- stored one gloss per `quran_words` row, so a phrase gloss had nowhere to live
-- and the extractor smeared it across the individual word cells.
--
-- This moves the Uzbek corpus to a segment model: a gloss keyed by a contiguous
-- range of positions within one verse. A single-word gloss is just a segment of
-- length one. Nothing else about the feature changes — the allowlist, the
-- batches/review queue, and the security-definer write gates all stay; only the
-- unit of a gloss (and therefore the submissions shape and the two write RPCs)
-- becomes a range instead of a word.
--
-- `quran_words.gloss_uz` is dropped. It held nothing but failed test rows (no
-- batch ever approved before this), so the segment table is the single source
-- of truth for Uzbek with no data to migrate. Russian and English stay per-word
-- and untouched. Uzbek word-level lookups (the vocabulary quiz) fall back to the
-- English gloss, which is correct — a phrase gloss is not a single word's
-- meaning.
-- ---------------------------------------------------------------------------

-- --- the corpus: one gloss per contiguous run of positions in a verse --------
create table public.gloss_uz_segments (
  id             integer generated always as identity primary key,
  verse_id       integer  not null references public.quran_verses (id) on delete cascade,
  start_position smallint not null check (start_position > 0),
  end_position   smallint not null check (end_position >= start_position),
  gloss          text     not null,
  -- One segment may start at a given position; approval replaces a verse's
  -- segments wholesale, so overlaps cannot accrue (see approve_gloss_batch).
  unique (verse_id, start_position)
);

create index gloss_uz_segments_verse_idx
  on public.gloss_uz_segments (verse_id, start_position);

comment on table public.gloss_uz_segments is
  'Uzbek word-by-word glosses, each covering a contiguous run of positions in a '
  'verse (a single word is start_position = end_position). Built in-app from '
  'photographed mushaf pages and approved through the review queue.';

alter table public.gloss_uz_segments enable row level security;

-- Public read, exactly like the per-word gloss columns it replaces.
create policy "segments are readable" on public.gloss_uz_segments
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.gloss_uz_segments from anon, authenticated;

-- --- staging: submissions become segments ----------------------------------
-- The old per-word submissions table held nothing of value (no batch was ever
-- approved), so it is dropped and recreated in segment shape rather than
-- migrated. Pending batches, if any, are discarded with it; a contributor
-- simply resubmits. The batches table itself (the ayah-range label a reviewer
-- reads) is unchanged.
drop table public.gloss_uz_submissions;

create table public.gloss_uz_submissions (
  id             integer generated always as identity primary key,
  batch_id       uuid     not null references public.gloss_uz_batches (id) on delete cascade,
  verse_id       integer  not null references public.quran_verses (id) on delete cascade,
  start_position smallint not null check (start_position > 0),
  end_position   smallint not null check (end_position >= start_position),
  proposed_gloss text     not null
);

comment on table public.gloss_uz_submissions is
  'The proposed Uzbek gloss segments of one batch; copied into gloss_uz_segments on approval.';

create index gloss_uz_submissions_batch_idx on public.gloss_uz_submissions (batch_id);

alter table public.gloss_uz_submissions enable row level security;

-- Same read gate the table had before: the submitter, or any reviewer.
create policy "own or reviewer can read submissions" on public.gloss_uz_submissions
  for select to authenticated
  using (
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

revoke insert, update, delete on public.gloss_uz_submissions from anon, authenticated;

-- --- RPCs: stage and approve segments --------------------------------------
-- Stage a batch of proposed segments. p_rows is [{verse_id, start, end, gloss}].
-- Empty glosses are skipped (a run the model could not read is left for a later
-- pass); a segment whose verse is outside the declared range is dropped, the
-- same guard the per-word version carried, so a client bug or hand-crafted
-- request cannot write a segment onto an unrelated verse on approval.
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

  insert into public.gloss_uz_submissions (batch_id, verse_id, start_position, end_position, proposed_gloss)
    select v_batch,
           (r->>'verse_id')::integer,
           (r->>'start_position')::smallint,
           (r->>'end_position')::smallint,
           btrim(r->>'gloss')
      from jsonb_array_elements(p_rows) as r
     where coalesce(btrim(r->>'gloss'), '') <> ''
       and (r->>'end_position')::smallint >= (r->>'start_position')::smallint
       and exists (
         select 1
           from public.quran_verses v
          where v.id = (r->>'verse_id')::integer
            and v.surah_number = p_surah
            and v.ayah_number between p_start and p_end
       )
       -- Both endpoints must be real word positions of that verse, so a crafted
       -- request cannot store a segment over positions that cover no words.
       and exists (
         select 1 from public.quran_words w
          where w.verse_id = (r->>'verse_id')::integer
            and w.position = (r->>'start_position')::smallint
       )
       and exists (
         select 1 from public.quran_words w
          where w.verse_id = (r->>'verse_id')::integer
            and w.position = (r->>'end_position')::smallint
       );

  get diagnostics v_count = row_count;
  if v_count = 0 then
    delete from public.gloss_uz_batches where id = v_batch;
    raise exception 'no non-empty glosses to submit' using errcode = '22023';
  end if;

  return v_batch;
end;
$$;

comment on function public.submit_gloss_uz(smallint, smallint, smallint, jsonb) is
  'Stages a contributor''s proposed Uzbek gloss segments as a pending batch; returns the batch id.';

-- Approve a pending batch: replace the live segments the batch's segments
-- overlap with the batch's own, then mark it approved. Replacing by overlap
-- (rather than clearing the whole verse) lets a partial or re-grouped resubmit
-- land without erasing the verse's other approved segments, while a regroup of
-- the same span still cleanly supersedes what it covers.
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

  -- Replace only the segments this batch's segments overlap, so a partial or
  -- re-grouped resubmission leaves a verse's other approved segments intact.
  delete from public.gloss_uz_segments g
    using public.gloss_uz_submissions s
   where s.batch_id = p_batch
     and g.verse_id = s.verse_id
     and g.start_position <= s.end_position
     and g.end_position   >= s.start_position;

  with ins as (
    insert into public.gloss_uz_segments (verse_id, start_position, end_position, gloss)
      select s.verse_id, s.start_position, s.end_position, s.proposed_gloss
        from public.gloss_uz_submissions s
       where s.batch_id = p_batch
      -- A crafted batch could stage two segments sharing a start_position; keep
      -- the first rather than abort the whole approval on the unique constraint.
      on conflict (verse_id, start_position) do nothing
    returning 1
  )
  select count(*)::integer into v_count from ins;

  update public.gloss_uz_batches
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_batch;

  return v_count;
end;
$$;

comment on function public.approve_gloss_batch(uuid) is
  'Reviewer-only: replaces the live Uzbek segments a pending batch overlaps with the batch''s own and marks it approved.';

-- submit_gloss_uz keeps its signature, so its existing grants/revokes still
-- hold; approve_gloss_batch likewise. Re-assert nothing here but the new table's
-- read grant (RLS already restricts it; the grant lets the role reach the table).
grant select on public.gloss_uz_segments to anon, authenticated;

-- --- quiz pool: Uzbek word-level falls back to English ----------------------
-- quiz_pool referenced w.gloss_uz; that column is about to be dropped. Uzbek
-- word-level glosses no longer exist (the corpus is phrase-level now), so the
-- `uz` arm resolves to the English gloss like every other non-Russian language.
-- The whole body is reproduced so this replace keeps the SRS scheduling intact;
-- the only change from 20261018000001 is the removed `uz` CASE arm.
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

grant execute on function
  public.quiz_pool(public.quiz_scope, integer, text, smallint, smallint) to authenticated;

-- --- drop the per-word column (now unused, nothing to migrate) --------------
alter table public.quran_words drop column gloss_uz;
