-- ---------------------------------------------------------------------------
-- Recitation audio.
--
-- The brief deferred audio to a later version and reserved
-- `quran_verses.audio_url` as the extension point. That reservation guessed
-- the shape wrong, and the guess matters: it assumed one file per ayah.
--
-- Recitation as a reciter actually performs it is one continuous take per
-- surah. Cutting it into 6,236 clips is what makes ayah-by-ayah players sound
-- mechanical — every ayah begins from silence, the breath and the phrasing
-- that carry across an ayah boundary are lost, and a waqf the reciter chose
-- not to take is forced anyway. So the audio here is one file per reciter per
-- surah, and following along is a matter of knowing where each ayah falls
-- inside it.
--
-- That is what `recitation_timings` is: the millisecond offsets of every ayah
-- within its surah file. Playing a ruku is then a seek to the first ayah's
-- offset and a stop at the last one's — the same file, no stitching, and the
-- reciter's own transitions intact.
--
-- Content tables: identical for every user, written only by the seed pipeline
-- under the service role, readable by everyone.
-- ---------------------------------------------------------------------------

-- Ids are quran.com's, because they are also the path parameter for the
-- audio-files endpoint the seed reads. Keeping them means the seed never has
-- to hold a mapping between our ids and theirs.
create table public.reciters (
  id             smallint primary key,
  slug           text     not null unique,
  name           text     not null,
  -- Murattal, Mujawwad, Muallim, and so on. Null when upstream gives none.
  -- The same reciter appears once per style: AbdulBaset's Murattal and
  -- Mujawwad are different performances, not a display detail.
  style          text,
  qirat          text,
  sort_order     smallint not null default 0
);

comment on table public.reciters is
  'Available reciters, written by the seed pipeline alongside their audio.';

-- One continuous recording per surah. `duration_ms` and `file_size` come from
-- upstream so the UI can show a length and a download size without first
-- fetching the file.
create table public.recitation_files (
  reciter_id    smallint not null references public.reciters (id) on delete cascade,
  surah_number  smallint not null references public.quran_surahs (number),
  audio_url     text     not null,
  duration_ms   integer  not null check (duration_ms > 0),
  file_size     bigint,
  format        text     not null default 'mp3',
  primary key (reciter_id, surah_number)
);

comment on column public.recitation_files.audio_url is
  'Absolute URL of the whole-surah recording. Served with range support, so '
  'seeking into a ruku streams only the bytes it needs.';

-- Where each ayah falls inside its surah file. Offsets are absolute
-- milliseconds from the start of that file, not relative to the ayah.
create table public.recitation_timings (
  reciter_id  smallint not null references public.reciters (id) on delete cascade,
  verse_id    integer  not null references public.quran_verses (id) on delete cascade,
  start_ms    integer  not null check (start_ms >= 0),
  end_ms      integer  not null,
  -- Word-level offsets: [[word_position, start_ms, end_ms], ...], positions
  -- matching `quran_words.position`.
  --
  -- Not a table: this is ~78,000 words per reciter and it is only ever read as
  -- a whole ayah's worth at a time, alongside the row it hangs off. As jsonb
  -- it rides along with the ayah lookup for free; as rows it would be a second
  -- index and a join to serve exactly the same access pattern.
  --
  -- Positions may repeat within one ayah, and legitimately so — a reciter who
  -- repeats a phrase produces two spans for the same word. Readers should
  -- resolve "current word" by which span contains the playhead rather than
  -- assuming positions increase.
  segments    jsonb,
  primary key (reciter_id, verse_id),
  check (end_ms > start_ms)
);

-- The reader's query is "every ayah of this ruku, for this reciter", which it
-- reaches by verse id; this index serves the ordered range scan behind it.
create index recitation_timings_verse_idx
  on public.recitation_timings (reciter_id, verse_id);

-- The per-ayah `audio_url` reserved in the original schema is superseded by
-- the tables above and was null in every row, so dropping it loses nothing.
-- Leaving it would document a plan the app no longer follows.
alter table public.quran_verses drop column if exists audio_url;

-- --- RLS: public read, service-role write ----------------------------------

alter table public.reciters           enable row level security;
alter table public.recitation_files   enable row level security;
alter table public.recitation_timings enable row level security;

create policy "content is readable by everyone" on public.reciters
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.recitation_files
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.recitation_timings
  for select to anon, authenticated using (true);

revoke insert, update, delete on
  public.reciters, public.recitation_files, public.recitation_timings
  from anon, authenticated;
