-- ---------------------------------------------------------------------------
-- Tafsir in the knowledge quiz, and a study summary of a tafsir passage.
--
-- Until now a knowledge question could only come from the ayah itself. Most
-- of a round (about 70%) is now written from Ibn Kathir's commentary on the
-- ayah instead, in the reader's language, so the round tests what the ayah
-- *means* as well as what it says. Those questions get a kind of their own,
-- so the scoreboard can tell the two apart.
--
-- The summary is a shared cache like `ruku_ai_summary`: produced by the Rust
-- backend, written back with the reader's own session, readable by everyone.
-- ---------------------------------------------------------------------------

alter type public.knowledge_question_kind add value if not exists 'tafsir';

/**
 * The tafsir row covering each of a set of verses, in one edition.
 *
 * The quiz draws its ayahs first and then asks for their commentary, so this
 * takes verse ids rather than a scope. A verse the edition has no entry for
 * (the Uzbek Ibn Kathir has gaps) is simply absent from the result, and the
 * app asks a Quran-only question about it instead.
 */
create or replace function public.quiz_tafsir_for_verses(
  p_edition   text,
  p_verse_ids integer[]
)
returns table (
  verse_id   integer,
  ayah_start smallint,
  ayah_end   smallint,
  content    text
)
language sql
security definer
set search_path = public
stable
as $$
  select v.id, t.ayah_start, t.ayah_end, t.content
    from public.quran_verses v
    join public.tafsir t
      on t.edition = p_edition
     and t.surah_number = v.surah_number
     and v.ayah_number between t.ayah_start and t.ayah_end
   where v.id = any (p_verse_ids)
     and coalesce(t.content, '') <> '';
$$;

comment on function public.quiz_tafsir_for_verses(text, integer[]) is
  'The commentary covering each given verse in one tafsir edition, for tafsir-grounded quiz questions.';

grant execute on function public.quiz_tafsir_for_verses(text, integer[]) to anon, authenticated;

-- --- tafsir study summaries --------------------------------------------------

-- Keyed by the tafsir row it summarizes (edition + surah + the row's first
-- ayah, which is unique per edition) and the language it was written in.
-- `summary` holds {gist, key_points[], recall[], narrations[]} as the backend
-- produced and validated it.
create table public.tafsir_ai_summary (
  edition       text        not null references public.tafsir_editions (slug) on delete cascade,
  surah_number  smallint    not null,
  ayah_start    smallint    not null,
  language      text        not null,
  summary       jsonb       not null,
  model_used    text        not null,
  generated_at  timestamptz not null default now(),
  primary key (edition, surah_number, ayah_start, language)
);

comment on table public.tafsir_ai_summary is
  'AI study summaries of tafsir passages, shared across readers.';

alter table public.tafsir_ai_summary enable row level security;

create policy "content is readable by everyone" on public.tafsir_ai_summary
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.tafsir_ai_summary from anon, authenticated;
grant insert, update on public.tafsir_ai_summary to authenticated;

create policy "authenticated users may cache tafsir summaries" on public.tafsir_ai_summary
  for insert to authenticated with check (true);

create policy "authenticated users may refresh tafsir summaries" on public.tafsir_ai_summary
  for update to authenticated using (true) with check (true);
