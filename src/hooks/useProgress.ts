import { useCallback, useMemo } from "react";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { readStoredSession, supabase } from "@/lib/supabase";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/providers/I18nProvider";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/hooks/useProfile";
import type { Database } from "@/lib/database.types";
import { daysBetween, todayInTimezone } from "@/lib/utils";
import type {
  MemorizationOverview,
  ReadingOverview,
  StreakState,
  WordStatus,
} from "@/lib/types";

// --- streaks & hours -------------------------------------------------------

/**
 * The streak, refreshed for today before it is read.
 *
 * This goes through `current_streak()` rather than selecting the table, because
 * the row is only rewritten when reading is logged. Days passing without any
 * reading is exactly the case the grace rules describe, and it writes nothing —
 * so a plain select serves state computed on the last active day.
 */
export function useStreak() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["streak", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<StreakState | null> => {
      const { data, error } = await supabase.rpc("current_streak");
      if (error) throw error;
      return (data as StreakState | null) ?? null;
    },
  });
}

/**
 * The streak plus how much of its grace window is left, in whole days.
 *
 * `graceDaysLeft` counts today as a day, since a paused streak can still be
 * restored on its expiry date itself. Null means there is no window to show —
 * either none is open, or the stored one has already lapsed, which can happen
 * briefly if the row is read before it is refreshed.
 */
export function useStreakStatus() {
  const { data: streak } = useStreak();
  const { data: profile } = useProfile();
  const today = todayInTimezone(profile?.timezone ?? "UTC");

  const graceDaysLeft = useMemo(() => {
    if (!streak?.grace_expires_on) return null;
    const left = daysBetween(today, streak.grace_expires_on) + 1;
    return left > 0 ? left : null;
  }, [streak?.grace_expires_on, today]);

  return { streak: streak ?? null, graceDaysLeft, inGrace: graceDaysLeft !== null };
}

export function useReadingOverview() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reading-overview", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<ReadingOverview> => {
      const { data, error } = await supabase.rpc("reading_overview");
      if (error) throw error;
      return data as unknown as ReadingOverview;
    },
  });
}

/** Recent daily totals, for the activity chart. */
export function useReadingHistory(days = 84) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reading-history", user?.id, days],
    enabled: Boolean(user),
    queryFn: async (): Promise<Array<{ day: string; seconds_read: number }>> => {
      const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("daily_reading")
        .select("day, seconds_read")
        .gte("day", since)
        .order("day");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useMemorizationOverview() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["memorization-overview", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<MemorizationOverview> => {
      const { data, error } = await supabase.rpc("memorization_overview");
      if (error) throw error;
      return data as unknown as MemorizationOverview;
    },
  });
}

// --- memorized verses ------------------------------------------------------

/**
 * The marked ayahs, optionally narrowed to a set of ids.
 *
 * `undefined` means the whole table; an empty array means nothing, which is
 * what a caller waiting on its scope should pass — treating "no ids yet" as
 * "everything" would flash every ayah as memorized and then take it back.
 */
export function useMemorizedVerses(verseIds?: number[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["memorized", user?.id, verseIds?.join(",") ?? "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Set<number>> => {
      if (verseIds?.length === 0) return new Set();
      let query = supabase.from("memorized_verses").select("verse_id");
      if (verseIds) query = query.in("verse_id", verseIds);
      const { data, error } = await query;
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.verse_id));
    },
  });
}

/** Marks or unmarks one ayah as memorized. Optimistic; see `registerProgressMutations`. */
export function useToggleMemorized() {
  return useMarkMutation<MemorizedVars>(MARK_KEYS.memorized);
}

// --- tafsir read -----------------------------------------------------------

export function useTafsirReadVerses(verseIds?: number[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tafsir-read", user?.id, verseIds?.join(",") ?? "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Set<number>> => {
      if (verseIds?.length === 0) return new Set();
      let query = supabase.from("tafsir_read_verses").select("verse_id");
      if (verseIds) query = query.in("verse_id", verseIds);
      const { data, error } = await query;
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.verse_id));
    },
  });
}

/**
 * Marks or unmarks the tafsir as read for one or more ayahs.
 *
 * Takes a list rather than a single id because a tafsir entry usually covers a
 * range: Ibn Kathir comments on 2:1-5 in one passage, and someone who has read
 * that passage has read the commentary on all five. Marking them one at a time
 * would be five clicks for one act of reading.
 */
export function useToggleTafsirRead() {
  return useMarkMutation<TafsirReadVars>(MARK_KEYS.tafsirRead);
}

// --- mistakes --------------------------------------------------------------

/**
 * The ayahs flagged as recited with a mistake, optionally narrowed to a set
 * of ids. `undefined` means all of them; an empty array means none.
 */
export function useMistakeVerses(verseIds?: number[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["mistakes", user?.id, verseIds?.join(",") ?? "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Set<number>> => {
      if (verseIds?.length === 0) return new Set();
      let query = supabase.from("mistake_verses").select("verse_id");
      if (verseIds) query = query.in("verse_id", verseIds);
      const { data, error } = await query;
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.verse_id));
    },
  });
}

/** One flagged ayah with what the review list needs to show and link to it. */
export interface MistakeVerse {
  id: number;
  surah_number: number;
  ayah_number: number;
  ruku_number: number;
  arabic_text: string;
  marked_at: string;
}

/**
 * Every flagged ayah in Quran order, for the review list.
 *
 * Its key sits under "mistakes" like the id-set queries above, so the same
 * invalidation and optimistic patching reach it.
 */
export function useMistakeList() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["mistakes", user?.id, "list"],
    enabled: Boolean(user),
    queryFn: async (): Promise<MistakeVerse[]> => {
      const { data, error } = await supabase
        .from("mistake_verses")
        .select("marked_at, verse:quran_verses!inner(id, surah_number, ayah_number, ruku_number, arabic_text)");
      if (error) throw error;
      return (data ?? [])
        .flatMap((row) => (row.verse ? [{ ...row.verse, marked_at: row.marked_at }] : []))
        .sort((a, b) => a.surah_number - b.surah_number || a.ayah_number - b.ayah_number);
    },
  });
}

/**
 * Flags or clears the mistake mark on one ayah. Optimistic and queued offline
 * like the other marks — the listener may well be marking without a connection.
 */
export function useToggleMistake() {
  return useMarkMutation<MistakeVars>(MARK_KEYS.mistake);
}

/** Word totals for every ruku, keyed by ruku number — for the quiz buttons. */
export function useRukuWordStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ruku-word-stats", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<Map<number, RukuWordStats>> => {
      const { data, error } = await supabase.rpc("word_progress_by_ruku");
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.ruku_number, row as RukuWordStats]));
    },
  });
}

/** The counts behind one ruku's "words" line. */
export interface RukuWordStats {
  ruku_number: number;
  word_count: number;
  learned_count: number;
  learning_count: number;
  untouched_count: number;
  /** How many of this ruku's words the schedule wants asking now. */
  due_count: number;
}

// --- tafsir nudge ----------------------------------------------------------

/** One memorized ayah whose tafsir has not been read, with the entry text. */
export type PendingTafsir = Database["public"]["Functions"]["next_unread_tafsir"]["Returns"][number];

/**
 * The next tafsir to offer on app open, or null when there is nothing left.
 *
 * Read once per launch rather than watched: the nudge is a single prompt, and
 * re-running it after the user dismisses the dialog would bring it straight
 * back — the row would still be unread until they act on it.
 */
export function usePendingTafsir(edition: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pending-tafsir", user?.id, edition],
    enabled: Boolean(user) && Boolean(edition),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    queryFn: async (): Promise<PendingTafsir | null> => {
      const { data, error } = await supabase.rpc("next_unread_tafsir", { p_edition: edition });
      if (error) throw error;
      return (data ?? [])[0] ?? null;
    },
  });
}

/**
 * Marks a whole tafsir entry read — the range of ayahs one passage covers.
 *
 * The nudge works in entries rather than ayahs, so it needs to mark 2:1-5 in
 * one write; without this it would either mark one ayah and be offered the
 * same passage again, or loop five requests. It is the tafsir toggle with
 * `read` fixed, so it shares its optimistic update and offline queue.
 */
export function useMarkTafsirEntryRead() {
  const toggle = useToggleTafsirRead();
  const { mutate } = toggle;
  return {
    ...toggle,
    mutate: useCallback(
      ({ verseIds }: { verseIds: number[] }) => mutate({ verseIds, read: true }),
      [mutate],
    ),
  };
}

// --- per-ruku progress -----------------------------------------------------

export interface RukuProgress {
  ruku_number: number;
  surah_number: number;
  verse_count: number;
  memorized_count: number;
  tafsir_read_count: number;
  words_learned_count: number;
}

/**
 * Memorized and tafsir-read counts for every ruku, keyed by ruku number.
 *
 * One 558-row read serves the whole ruku grid and the reader header; the
 * alternative is every marked verse id in the Quran just to count them.
 */
export function useRukuProgress() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ruku-progress", user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<Map<number, RukuProgress>> => {
      const { data, error } = await supabase.rpc("ruku_progress");
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.ruku_number, row as RukuProgress]));
    },
  });
}

// --- word progress ---------------------------------------------------------

export function useWordProgress(wordIds?: number[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["word-progress", user?.id, wordIds?.join(",") ?? "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Map<number, WordStatus>> => {
      let query = supabase.from("user_word_progress").select("word_id, status");
      if (wordIds?.length) query = query.in("word_id", wordIds);
      const { data, error } = await query;
      if (error) throw error;
      return new Map((data ?? []).map((row) => [row.word_id, row.status]));
    },
  });
}

/**
 * Every word the user has progress on, one page of rows at a time.
 *
 * The continuous reader shows word statuses across a surah and cannot name the
 * words up front without a request per ayah. A plain unfiltered select would do
 * it in one call — until the reader has marked a thousand words, at which
 * point the REST layer's row cap truncates the result silently and words start
 * reading as unmarked. Walking the table in pages has no such cliff.
 */
export function useAllWordProgress() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["word-progress", user?.id, "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Map<number, WordStatus>> => {
      const PAGE = 1000;
      const map = new Map<number, WordStatus>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("user_word_progress")
          .select("word_id, status")
          .order("word_id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) map.set(row.word_id, row.status);
        if ((data ?? []).length < PAGE) break;
      }
      return map;
    },
  });
}

/**
 * Says a word's status outright, without a review.
 *
 * Takes a list because that is what the ayah-level marker is: "the words in
 * this ayah are learned" is one act and one write, not one per word. A single
 * chip passes a list of one.
 *
 * It goes through `set_words_status` rather than writing the column, because
 * the column is a cache of the word's schedule and a review would recompute it
 * straight back. The RPC expresses the claim as a schedule instead — learned
 * puts the word out at the maturity line, learning brings it back to due now —
 * so a declaration and a round of answers leave the deck in the same shape.
 */
export function useSetWordsStatus() {
  return useMarkMutation<WordsStatusVars>(MARK_KEYS.wordsStatus);
}

// --- progress marks: optimistic, single-flight, offline-queued -------------

/**
 * The four marks a reader sets by hand — memorized, tafsir read, words
 * learned, mistake — share one way of being written.
 *
 * - The screen changes on the tap, not on the server's reply: `onMutate`
 *   writes the new state into every cached query that shows it, and a failure
 *   puts the old one back (with a toast saying so).
 * - A mark whose write is in flight cannot be pressed again —
 *   `usePendingMarks` tells the buttons — so a burst of taps is one write, not
 *   a race of inserts and deletes landing in any order.
 * - Offline, the write is queued rather than lost. TanStack Query pauses it
 *   until the network returns, the paused mutation is persisted with the
 *   query cache, and these defaults are what let it resume after a restart:
 *   a resumed mutation has no component and no hook, only its key.
 *
 * All four run in one scope, so queued writes replay in the order they were
 * made — marking an ayah and unmarking it offline must not land reversed.
 */
export const MARK_KEYS = {
  memorized: ["mark", "memorized"],
  tafsirRead: ["mark", "tafsir-read"],
  wordsStatus: ["mark", "words-status"],
  mistake: ["mark", "mistake"],
} as const satisfies Record<string, QueryKey>;

export interface MemorizedVars {
  verseId: number;
  memorized: boolean;
}
export interface TafsirReadVars {
  verseIds: number[];
  read: boolean;
}
export interface MistakeVars {
  verseId: number;
  mistake: boolean;
}
export interface WordsStatusVars {
  wordIds: number[];
  status: WordStatus;
}

/**
 * Who made the mark, captured on the tap. A queued write can replay after a
 * restart, possibly with someone else signed in by then; it must land under
 * the account that made it or not at all.
 */
type Owned<T> = T & { userId?: string };

type Snapshot = Array<[QueryKey, unknown]>;

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id ?? readStoredSession()?.user.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

/**
 * The account to write under, or null when the mark belongs to a different
 * one than is signed in now — a write queued by someone else, which is
 * dropped rather than applied to this account's progress.
 */
async function ownerFor(vars: { userId?: string }): Promise<string | null> {
  const current = await currentUserId();
  return vars.userId && vars.userId !== current ? null : current;
}

async function writeMemorized(vars: Owned<MemorizedVars>) {
  const { verseId, memorized } = vars;
  const userId = await ownerFor(vars);
  if (!userId) return;
  if (memorized) {
    const { error } = await supabase
      .from("memorized_verses")
      .insert({ user_id: userId, verse_id: verseId });
    // A replayed queue can repeat a write; an existing row is the desired end state.
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase
      .from("memorized_verses")
      .delete()
      .eq("user_id", userId)
      .eq("verse_id", verseId);
    if (error) throw error;
  }
}

async function writeTafsirRead(vars: Owned<TafsirReadVars>) {
  const { verseIds, read } = vars;
  if (verseIds.length === 0) return;
  const userId = await ownerFor(vars);
  if (!userId) return;
  if (read) {
    const { error } = await supabase
      .from("tafsir_read_verses")
      .upsert(
        verseIds.map((verseId) => ({ user_id: userId, verse_id: verseId })),
        { onConflict: "user_id,verse_id" },
      );
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("tafsir_read_verses")
      .delete()
      .eq("user_id", userId)
      .in("verse_id", verseIds);
    if (error) throw error;
  }
}

async function writeMistake(vars: Owned<MistakeVars>) {
  const { verseId, mistake } = vars;
  const userId = await ownerFor(vars);
  if (!userId) return;
  if (mistake) {
    const { error } = await supabase
      .from("mistake_verses")
      .upsert({ user_id: userId, verse_id: verseId }, { onConflict: "user_id,verse_id" });
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("mistake_verses")
      .delete()
      .eq("user_id", userId)
      .eq("verse_id", verseId);
    if (error) throw error;
  }
}

/**
 * Goes through `set_words_status` rather than writing the column, because
 * the column is a cache of the word's schedule and a review would recompute it
 * straight back. The RPC expresses the claim as a schedule instead — learned
 * puts the word out at the maturity line, learning brings it back to due now —
 * so a declaration and a round of answers leave the deck in the same shape.
 */
async function writeWordsStatus(vars: Owned<WordsStatusVars>) {
  const { wordIds, status } = vars;
  if (wordIds.length === 0) return;
  // The RPC writes as auth.uid(), so a foreign mark is dropped here too.
  if (!(await ownerFor(vars))) return;
  const { error } = await supabase.rpc("set_words_status", {
    p_word_ids: wordIds,
    p_status: status,
  });
  if (error) throw error;
}

/** Applies `update` to every cached query under `prefix`, returning what was there. */
async function patchQueries<T>(
  queryClient: QueryClient,
  prefix: QueryKey,
  update: (old: T) => T,
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: prefix });
  const snapshot = queryClient.getQueriesData({ queryKey: prefix });
  queryClient.setQueriesData<T>({ queryKey: prefix }, (old) =>
    old === undefined ? old : update(old),
  );
  return snapshot;
}

/**
 * The caches as they were before each optimistic update, by a token kept in
 * the mutation's context.
 *
 * Held here rather than in the context itself, because a paused mutation is
 * persisted whole: a write replayed days later that failed would otherwise
 * roll the caches back to what they held on the day it was queued, wiping
 * every mark made since. After a restart this map is empty, so a replayed
 * failure restores nothing and the refetch that follows tells the truth.
 */
const snapshots = new Map<number, Snapshot>();
let nextSnapshot = 1;

function keep(snapshot: Snapshot): { snapshotId: number } {
  const snapshotId = nextSnapshot++;
  snapshots.set(snapshotId, snapshot);
  return { snapshotId };
}

function restore(queryClient: QueryClient, context: unknown) {
  const id = (context as { snapshotId?: number } | undefined)?.snapshotId;
  if (id === undefined) return;
  for (const [key, data] of snapshots.get(id) ?? []) queryClient.setQueryData(key, data);
  snapshots.delete(id);
}

function forget(context: unknown) {
  const id = (context as { snapshotId?: number } | undefined)?.snapshotId;
  if (id !== undefined) snapshots.delete(id);
}

function toggledSet(old: Set<number>, ids: number[], on: boolean): Set<number> {
  if (!(old instanceof Set)) return old;
  const next = new Set(old);
  for (const id of ids) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}

/**
 * Refetches what a mark feeds — but only once the last write of its kind has
 * settled, so a refetch started between two quick marks can't briefly bring
 * back the state the second one already replaced.
 */
function invalidateWhenIdle(queryClient: QueryClient, key: QueryKey, prefixes: string[]) {
  if (queryClient.isMutating({ mutationKey: key }) > 1) return;
  for (const prefix of prefixes) queryClient.invalidateQueries({ queryKey: [prefix] });
}

const MARK_SCOPE = { id: "progress-marks" };

export function registerProgressMutations(queryClient: QueryClient) {
  queryClient.setMutationDefaults(MARK_KEYS.memorized, {
    mutationFn: (vars: MemorizedVars) => writeMemorized(vars),
    scope: MARK_SCOPE,
    onMutate: async ({ verseId, memorized }: MemorizedVars) =>
      keep(
        await patchQueries<Set<number>>(queryClient, ["memorized"], (old) =>
          toggledSet(old, [verseId], memorized),
        ),
      ),
    onError: (_error, _vars, context) => restore(queryClient, context),
    onSettled: (_data, _error, _vars, context) => {
      forget(context);
      invalidateWhenIdle(queryClient, MARK_KEYS.memorized, [
        "memorized",
        "memorization-overview",
        "memorized-by-surah",
        "ruku-progress",
      ]);
    },
  });

  queryClient.setMutationDefaults(MARK_KEYS.tafsirRead, {
    mutationFn: (vars: TafsirReadVars) => writeTafsirRead(vars),
    scope: MARK_SCOPE,
    onMutate: async ({ verseIds, read }: TafsirReadVars) =>
      keep(
        await patchQueries<Set<number>>(queryClient, ["tafsir-read"], (old) =>
          toggledSet(old, verseIds, read),
        ),
      ),
    onError: (_error, _vars, context) => restore(queryClient, context),
    onSettled: (_data, _error, _vars, context) => {
      forget(context);
      invalidateWhenIdle(queryClient, MARK_KEYS.tafsirRead, [
        "tafsir-read",
        "ruku-progress",
      ]);
    },
  });

  queryClient.setMutationDefaults(MARK_KEYS.mistake, {
    mutationFn: (vars: MistakeVars) => writeMistake(vars),
    scope: MARK_SCOPE,
    onMutate: async ({ verseId, mistake }: MistakeVars) =>
      keep(
        await patchQueries<Set<number> | MistakeVerse[]>(queryClient, ["mistakes"], (old) =>
          // The review list is rows, not ids: clearing a flag drops its row,
          // while raising one has no row to show until the refetch brings it.
          Array.isArray(old)
            ? mistake
              ? old
              : old.filter((row) => row.id !== verseId)
            : toggledSet(old, [verseId], mistake),
        ),
      ),
    onError: (_error, _vars, context) => restore(queryClient, context),
    onSettled: (_data, _error, _vars, context) => {
      forget(context);
      invalidateWhenIdle(queryClient, MARK_KEYS.mistake, ["mistakes"]);
    },
  });

  queryClient.setMutationDefaults(MARK_KEYS.wordsStatus, {
    mutationFn: (vars: WordsStatusVars) => writeWordsStatus(vars),
    scope: MARK_SCOPE,
    onMutate: async ({ wordIds, status }: WordsStatusVars) => {
      const progress = await patchQueries<Map<number, WordStatus>>(
        queryClient,
        ["word-progress"],
        (old) => {
          if (!(old instanceof Map)) return old;
          const next = new Map(old);
          for (const id of wordIds) next.set(id, status);
          return next;
        },
      );
      // The vocabulary list carries each row's status too.
      const wanted = new Set(wordIds);
      const vocabulary = await patchQueries<unknown>(queryClient, ["vocabulary"], (old) =>
        Array.isArray(old)
          ? old.map((row: { word?: { id?: number }; status?: WordStatus }) =>
              row?.word?.id !== undefined && wanted.has(row.word.id) ? { ...row, status } : row,
            )
          : old,
      );
      return keep([...progress, ...vocabulary]);
    },
    onError: (_error, _vars, context) => restore(queryClient, context),
    onSettled: (_data, _error, _vars, context) => {
      forget(context);
      invalidateWhenIdle(queryClient, MARK_KEYS.wordsStatus, [
        "word-progress",
        "memorization-overview",
        "vocabulary",
        "vocabulary-overview",
        "ruku-progress",
        "ruku-word-stats",
        "quiz-scoreboard",
      ]);
    },
  });
}

/**
 * A mark mutation as a component uses it: the defaults above do the work,
 * and this adds the toast when a write is refused and rolled back.
 */
function useMarkMutation<TVars>(key: QueryKey) {
  const toast = useToast();
  const t = useT();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id;
  const mutation = useMutation<void, Error, Owned<TVars>>({ mutationKey: key });
  const { mutate: rawMutate } = mutation;
  /** Returns whether the write was started; false when one on the same target is still in flight. */
  const mutate = useCallback(
    (vars: TVars, options?: { onSuccess?: () => void }): boolean => {
      // The disabled buttons are the visible half of single-flight; this is
      // the half that also covers keyboard shortcuts and anything else that
      // calls in without a button to disable.
      const busy = new Set(markTargets(vars));
      const inFlight = queryClient.getMutationCache().findAll({
        mutationKey: key,
        status: "pending",
        predicate: (m) =>
          !m.state.isPaused && markTargets(m.state.variables).some((id) => busy.has(id)),
      });
      if (inFlight.length > 0) return false;
      rawMutate(
        { ...vars, userId },
        {
          onSuccess: options?.onSuccess,
          onError: () => toast(t("common.saveFailed"), "error"),
        },
      );
      return true;
    },
    [rawMutate, toast, t, queryClient, key, userId],
  );
  return { ...mutation, mutate };
}

/** The ayah or word ids a mark write touches. */
function markTargets(vars: unknown): number[] {
  const v = vars as Partial<MemorizedVars & TafsirReadVars & WordsStatusVars> | undefined;
  if (!v) return [];
  if (v.verseId !== undefined) return [v.verseId];
  return v.verseIds ?? v.wordIds ?? [];
}

export interface PendingMarks {
  memorized: Set<number>;
  tafsirRead: Set<number>;
  mistake: Set<number>;
  /** Word ids whose status write is in flight. */
  words: Set<number>;
}

/**
 * The marks whose write is on its way to the server right now, so their
 * buttons can refuse a second press until it lands.
 *
 * Writes paused for want of a network are left out: they may wait for hours,
 * and a button locked that long is broken, not careful. Offline taps queue
 * in order instead, and the optimistic state they read is already current.
 */
export function usePendingMarks(): PendingMarks {
  const pending = useMutationState({
    filters: {
      mutationKey: ["mark"],
      status: "pending",
      predicate: (mutation) => !mutation.state.isPaused,
    },
    select: (mutation) => ({
      kind: mutation.options.mutationKey?.[1] as string | undefined,
      vars: mutation.state.variables as
        | Partial<MemorizedVars & TafsirReadVars & WordsStatusVars>
        | undefined,
    }),
  });
  return useMemo(() => {
    const marks: PendingMarks = {
      memorized: new Set(),
      tafsirRead: new Set(),
      mistake: new Set(),
      words: new Set(),
    };
    for (const { kind, vars } of pending) {
      if (!vars) continue;
      if (kind === "memorized" && vars.verseId !== undefined) marks.memorized.add(vars.verseId);
      if (kind === "mistake" && vars.verseId !== undefined) marks.mistake.add(vars.verseId);
      if (kind === "tafsir-read") for (const id of vars.verseIds ?? []) marks.tafsirRead.add(id);
      if (kind === "words-status") for (const id of vars.wordIds ?? []) marks.words.add(id);
    }
    return marks;
  }, [pending]);
}

// --- vocabulary ------------------------------------------------------------

export interface VocabularyOverview {
  encountered: number;
  learned: number;
  learning: number;
  /** Words the schedule wants asking now — the number that is a thing to do. */
  due: number;
  rukus_read: number;
}

/**
 * The vocabulary totals, shared by the vocabulary page and the quiz picker.
 *
 * The picker needs only `due`, but it needs it before a scope is chosen — the
 * "due today" tile has to carry its own count for the reader to have a reason
 * to press it — and one cached row serves both screens.
 */
export function useVocabularyOverview() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["vocabulary-overview", user?.id],
    enabled: Boolean(user),
    staleTime: 30_000,
    queryFn: async (): Promise<VocabularyOverview> => {
      const { data, error } = await supabase.rpc("vocabulary_overview");
      if (error) throw error;
      return data as unknown as VocabularyOverview;
    },
  });
}
