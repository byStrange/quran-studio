-- ---------------------------------------------------------------------------
-- Tajweed rule spans.
--
-- Recitation rules (madd, ghunnah, qalqalah, idgham, ikhfa, …) are stored as
-- character ranges over the verse's existing `arabic_text`, not as a second
-- copy of the text. Colouring is therefore a pure overlay: toggling tajweed on
-- or off never changes a single glyph, and the word-by-word breakdown, copied
-- text and search all keep working against one canonical string.
--
-- Shape: a JSON array of {r, s, e} ordered by `s`, where `r` is the rule name,
-- `s` is the inclusive start index and `e` the exclusive end index into
-- `arabic_text` (UTF-16 code units, which is what JavaScript slices on).
-- Ranges never overlap. Characters covered by no span carry no rule.
--
--   [{"r": "ham_wasl", "s": 6, "e": 7}, {"r": "madda_normal", "s": 21, "e": 23}]
--
-- Null means "not yet imported" and is what an un-reseeded row looks like; the
-- reader falls back to plain text for those, so the column can be filled in
-- without downtime.
-- ---------------------------------------------------------------------------

alter table public.quran_verses
  add column if not exists tajweed jsonb;

comment on column public.quran_verses.tajweed is
  'Tajweed rule spans over arabic_text: [{r, s, e}] ordered by s, non-overlapping. Null until seeded.';

-- The reader loads a whole ruku at a time and reads this column for every
-- verse in it, so it travels with the existing ruku index rather than needing
-- one of its own.
