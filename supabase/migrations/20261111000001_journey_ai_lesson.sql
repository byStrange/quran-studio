-- ---------------------------------------------------------------------------
-- Journey lessons from the tafsir.
--
-- The tafsir scene of a Journey stop ("what these ayahs teach") is written by
-- the AI from the tafsir, for a child: a gist, a few points, and
-- multiple-choice questions, each carrying a quote the backend located in the
-- tafsir itself. This is the shared cache for those, exactly like
-- `tafsir_ai_summary`: produced by the Rust backend, written back with the
-- reader's own session, readable by everyone — so a lesson prepared once on
-- one device is there for every reader on every device.
--
-- Keyed by the stop's own range rather than by tafsir entry: a stop is cut by
-- word count and does not line up with the commentary's passages, and the
-- lesson is about the stop's ayahs only. `ayah_end` is part of the key so that
-- retuning where stops fall makes new rows rather than serving a lesson
-- written for a different range.
-- ---------------------------------------------------------------------------

create table public.journey_ai_lesson (
  edition       text        not null references public.tafsir_editions (slug) on delete cascade,
  surah_number  smallint    not null,
  ayah_start    smallint    not null,
  ayah_end      smallint    not null,
  language      text        not null,
  lesson        jsonb       not null,
  model_used    text        not null,
  generated_at  timestamptz not null default now(),
  primary key (edition, surah_number, ayah_start, ayah_end, language)
);
comment on table public.journey_ai_lesson is
  'AI-written Journey lessons drawn from tafsir passages, shared across readers.';

alter table public.journey_ai_lesson enable row level security;

create policy "content is readable by everyone" on public.journey_ai_lesson
  for select to anon, authenticated using (true);
revoke insert, update, delete on public.journey_ai_lesson from anon, authenticated;
grant insert, update on public.journey_ai_lesson to authenticated;
create policy "authenticated users may cache journey lessons" on public.journey_ai_lesson
  for insert to authenticated with check (true);
create policy "authenticated users may refresh journey lessons" on public.journey_ai_lesson
  for update to authenticated using (true) with check (true);
