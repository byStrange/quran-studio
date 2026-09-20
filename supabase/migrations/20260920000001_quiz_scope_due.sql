-- ---------------------------------------------------------------------------
-- A fourth quiz scope: whatever is due.
--
-- Alone in its own migration because of a Postgres rule rather than a design
-- one. A value added to an existing enum cannot be *used* in the transaction
-- that adds it, and a `language sql` function body is parsed — and its enum
-- literals resolved — at CREATE time. So the value lands here and everything
-- that mentions it lands in the next file, which runs in its own transaction.
-- ---------------------------------------------------------------------------

alter type public.quiz_scope add value if not exists 'due';
