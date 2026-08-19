-- ---------------------------------------------------------------------------
-- Russian mode.
--
-- The app was built English-first in three places that each assumed a single
-- language rather than choosing one: the verse translation, the word-by-word
-- gloss, and the two AI caches. This migration widens all three.
--
-- Tafsir needs nothing here — `tafsir_editions` already made the edition a
-- value rather than a schema decision, so the Russian editions arrive as seed
-- data alongside the English and Uzbek ones.
-- ---------------------------------------------------------------------------

-- --- verse translation -----------------------------------------------------
-- A sibling column rather than a `quran_translations` table. The table would
-- be the better shape for "any number of translations", but the app shows
-- exactly one translation at a time and picks it from a preference; a second
-- column keeps every existing read path (`select ... translation_en`) working
-- untouched and costs one migration instead of a rewrite of the reader.
--
-- Nullable, unlike `translation_en`: the column exists before the seed fills
-- it, and a verse whose Russian text has not landed yet must read as "not
-- imported", not as an empty translation.
alter table public.quran_verses add column translation_ru text;

comment on column public.quran_verses.translation_ru is
  'Elmir Kuliev''s Russian translation. Null until the seed imports it.';

-- --- word-by-word gloss ----------------------------------------------------
-- Same reasoning as above. Null here is expected and permanent for some rows:
-- the upstream Russian word-by-word corpus is ~98.5% complete, so roughly
-- 1,100 of the 77,429 words have no Russian gloss and fall back to English in
-- the reader.
alter table public.quran_words add column gloss_ru text;

comment on column public.quran_words.gloss_ru is
  'Russian word-by-word gloss. Null where the upstream corpus has no entry; '
  'the reader falls back to gloss_en for those words.';

-- --- AI caches -------------------------------------------------------------
-- These two tables are global and shared by every user, keyed by the content
-- alone. That was correct while every explanation was English. It is actively
-- wrong once a second language exists: the first reader to generate a Russian
-- summary would overwrite the English one for everyone, and the next English
-- reader would overwrite it back. The language joins the key.
--
-- Added with a default so the existing rows — all English by construction,
-- since English was the only language the prompts could produce — keep their
-- meaning without a backfill pass.

alter table public.word_ai_context add column language text not null default 'en';
alter table public.ruku_ai_summary add column language text not null default 'en';

-- The default did its job on the existing rows; dropping it forces every new
-- write to state its language rather than silently inheriting English.
alter table public.word_ai_context  alter column language drop default;
alter table public.ruku_ai_summary  alter column language drop default;

alter table public.word_ai_context drop constraint word_ai_context_pkey;
alter table public.word_ai_context add primary key (word_id, language);

alter table public.ruku_ai_summary drop constraint ruku_ai_summary_pkey;
alter table public.ruku_ai_summary add primary key (ruku_number, language);

-- The existing RLS policies are unconditional (`using (true)`) and the grants
-- are table-wide, so both survive the key change untouched. Deletes stay
-- closed: a cached row still cannot be destroyed from the app.
