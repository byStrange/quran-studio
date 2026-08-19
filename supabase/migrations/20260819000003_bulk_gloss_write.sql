-- ---------------------------------------------------------------------------
-- Bulk writer for the Russian word-by-word glosses.
--
-- PostgREST has no "update these 77,000 rows to these 77,000 different
-- values". The importer's first approach was to group words by shared gloss
-- and issue one request per distinct gloss — 32,132 of them, at which scale a
-- single hung socket stalls the whole run, and the run takes longer than the
-- crawl that produced the data.
--
-- This takes the whole batch as one JSON array and does the update set-wise,
-- turning tens of thousands of round trips into about sixteen.
-- ---------------------------------------------------------------------------

create or replace function public.set_word_glosses_ru(p_rows jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  with input as (
    select (row_value->>'id')::integer as id,
           row_value->>'gloss'         as gloss
      from jsonb_array_elements(p_rows) as row_value
  ),
  updated as (
    update public.quran_words w
       set gloss_ru = i.gloss
      from input i
     where w.id = i.id
       -- Skips rows that already hold this value, so re-running the import
       -- writes nothing rather than rewriting all 77,429 rows.
       and w.gloss_ru is distinct from i.gloss
    returning 1
  )
  select count(*)::integer from updated;
$$;

comment on function public.set_word_glosses_ru(jsonb) is
  'Bulk-sets quran_words.gloss_ru from [{id, gloss}, …]. Seed pipeline only.';

-- Postgres grants EXECUTE on new functions to PUBLIC by default, which on a
-- `security definer` function that writes scripture would let any signed-in
-- user rewrite the glosses. The content tables are readable by everyone and
-- writable by nobody but the service role, and this function must not be the
-- hole in that.
revoke all on function public.set_word_glosses_ru(jsonb) from public;
revoke all on function public.set_word_glosses_ru(jsonb) from anon, authenticated;
grant execute on function public.set_word_glosses_ru(jsonb) to service_role;
