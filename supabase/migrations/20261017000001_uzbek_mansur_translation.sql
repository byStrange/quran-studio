-- ---------------------------------------------------------------------------
-- A second Uzbek verse translation, and with it the first time the reader
-- shows more than one translation at once.
--
-- Until now one `language` preference picked one translation column, so each
-- language needed exactly one. The reader is gaining a translation picker that
-- selects any set of translations to stack together, which is why Uzbek can
-- now carry two: Shaykh Muhammad Sodiq (already in `translation_uz`) and
-- Alouddin Mansur, added here.
--
-- A sibling column again, for the same reason the other three are columns: a
-- translation is one short string per verse, the read paths already `select *`,
-- and the picker chooses which columns to render rather than which rows to
-- fetch. A `quran_translations` table would buy nothing a column does not.
--
-- The deliberate exception: this column is Cyrillic, not Latin. The only
-- published Alouddin Mansur edition is Cyrillic, and it is a translation Uzbek
-- readers specifically ask for; the picker labels it as such, and a reader who
-- selects it is one who reads that script. The Latin-only rule that
-- `seed/translation-uz.ts` enforces is for the column that stands in for the
-- Uzbek interface, not for an edition the reader opts into by name.
--
-- Nullable, and null for every row until `pnpm seed:translation-uz-mansur`
-- runs. The reader falls back to English per verse while it is, so the app is
-- correct before the import and better after it — the same contract as
-- `translation_uz` at its own migration.
-- ---------------------------------------------------------------------------

alter table public.quran_verses add column translation_uz_mansur text;

comment on column public.quran_verses.translation_uz_mansur is
  'Alouddin Mansur''s Uzbek verse translation, in Cyrillic. Null until the '
  'seed imports it; the reader falls back to translation_en per verse while it is.';
