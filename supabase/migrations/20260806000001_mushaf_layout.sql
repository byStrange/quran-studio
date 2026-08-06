-- ---------------------------------------------------------------------------
-- Madani mushaf page layout.
--
-- The study reader renders `quran_verses.arabic_text` and lets the browser
-- wrap it. Mushaf mode instead reproduces the printed King Fahd mushaf exactly:
-- 604 pages of 15 lines, with the same words on the same lines as the paper
-- copy people memorise from.
--
-- That fidelity comes from the QCF page fonts, where each page has its own
-- font file and every word is a single glyph in the Private Use Area. The
-- justification is baked into the glyph outlines, so a line needs no letter
-- spacing or kashida work from us — rendering its glyphs at the right size
-- fills the measure the way the printed line does.
--
-- These tables therefore store glyph codes and line positions, not text. The
-- readable Arabic already lives in `quran_verses` / `quran_words` and is not
-- duplicated here.
-- ---------------------------------------------------------------------------

-- One row per line of the mushaf: 604 * 15 = 9,060.
--
-- Most lines carry ayah glyphs. The rest are the furniture the printed page
-- puts between surahs — the ornamental surah-name banner and the basmalah —
-- which carry no ayah text and so have no glyph rows pointing at them. Pages 1
-- and 2 are typeset short inside a decorative frame, so they also hold genuinely
-- blank lines, which are stored rather than inferred: the reader has to leave
-- room for them to reproduce the page.
create table public.quran_mushaf_lines (
  page_number  smallint not null check (page_number between 1 and 604),
  line_number  smallint not null check (line_number between 1 and 15),
  line_type    text     not null
    check (line_type in ('ayah', 'surah_name', 'basmalah', 'blank')),
  -- Which surah is starting. Set on 'surah_name' and 'basmalah' lines only;
  -- an 'ayah' line's surah is reachable through its glyphs' verses.
  surah_number smallint references public.quran_surahs (number),
  -- Short lines the printed mushaf centres rather than stretches to the full
  -- measure: the opening two pages, and the final line of certain surahs.
  is_centered  boolean  not null default false,
  primary key (page_number, line_number),
  constraint surah_set_on_heading_lines check (
    (line_type in ('surah_name', 'basmalah')) = (surah_number is not null)
  )
);

comment on table public.quran_mushaf_lines is
  'Line-by-line structure of the 604-page Madani mushaf, including the surah-name and basmalah lines that carry no ayah text.';

-- One row per rendered glyph run: ~84,000. Ids are quran.com word ids, the
-- same id space as `quran_words`, so re-running the seed is idempotent and a
-- tapped word joins straight back to its word-by-word breakdown.
--
-- Ayah-end markers are included. They are numbered glyphs in the same page
-- font, not text, and the printed line does not exist without them — but they
-- are not words, so `quran_words` deliberately has no row for them.
create table public.quran_mushaf_glyphs (
  id           integer  primary key,
  verse_id     integer  not null references public.quran_verses (id) on delete cascade,
  page_number  smallint not null check (page_number between 1 and 604),
  line_number  smallint not null check (line_number between 1 and 15),
  position     smallint not null check (position > 0),
  -- Usually one character; a word carrying a waqf sign is two.
  glyph        text     not null,
  char_type    text     not null check (char_type in ('word', 'end')),
  unique (verse_id, position),
  foreign key (page_number, line_number)
    references public.quran_mushaf_lines (page_number, line_number)
);

-- The reader's only query: every glyph on a page, in reading order.
create index quran_mushaf_glyphs_page_idx
  on public.quran_mushaf_glyphs (page_number, line_number, id);

comment on column public.quran_mushaf_glyphs.glyph is
  'Private Use Area codepoints for the page font (QCF V1 codes, shared by the V4 tajweed font). Meaningless in any other typeface.';

-- Mushaf mode navigates by page, so the page a ruku starts on has to be a
-- single lookup rather than a scan of `quran_verses`.
alter table public.quran_rukus
  add column page_start smallint,
  add column page_end   smallint;

comment on column public.quran_rukus.page_start is
  'Mushaf page the ruku''s first ayah falls on, for switching a ruku into page view.';

-- --- RLS: public read, service-role write ----------------------------------

alter table public.quran_mushaf_lines  enable row level security;
alter table public.quran_mushaf_glyphs enable row level security;

create policy "content is readable by everyone" on public.quran_mushaf_lines
  for select to anon, authenticated using (true);
create policy "content is readable by everyone" on public.quran_mushaf_glyphs
  for select to anon, authenticated using (true);

revoke insert, update, delete on
  public.quran_mushaf_lines, public.quran_mushaf_glyphs
  from anon, authenticated;
