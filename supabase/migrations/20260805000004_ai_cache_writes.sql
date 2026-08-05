-- ---------------------------------------------------------------------------
-- Let signed-in users populate the shared AI caches.
--
-- The AI text itself is produced by the Rust backend command, which holds the
-- Ollama key; the resulting row is then written back with the user's own
-- session. The alternative — having the desktop binary hold a service-role
-- key so it could write directly — would ship a credential that can read and
-- modify *every* user's private progress data, which is a much worse trade
-- than letting an authenticated user append to a shared content cache.
--
-- These two tables remain the only shared content that a non-service role can
-- write. Deletes stay closed, so cached rows cannot be destroyed from the app.
-- ---------------------------------------------------------------------------

grant insert, update on public.word_ai_context to authenticated;
grant insert, update on public.ruku_ai_summary to authenticated;

create policy "authenticated users may cache word context" on public.word_ai_context
  for insert to authenticated with check (true);

-- Update supports the manual "regenerate" action for a stale explanation.
create policy "authenticated users may refresh word context" on public.word_ai_context
  for update to authenticated using (true) with check (true);

create policy "authenticated users may cache ruku summaries" on public.ruku_ai_summary
  for insert to authenticated with check (true);

create policy "authenticated users may refresh ruku summaries" on public.ruku_ai_summary
  for update to authenticated using (true) with check (true);
