import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
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

export function useToggleMemorized() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ verseId, memorized }: { verseId: number; memorized: boolean }) => {
      if (memorized) {
        const { error } = await supabase
          .from("memorized_verses")
          .insert({ user_id: user!.id, verse_id: verseId });
        // A double-click can race; an existing row is the desired end state.
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("memorized_verses")
          .delete()
          .eq("user_id", user!.id)
          .eq("verse_id", verseId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memorized"] });
      queryClient.invalidateQueries({ queryKey: ["memorization-overview"] });
      queryClient.invalidateQueries({ queryKey: ["memorized-by-surah"] });
      queryClient.invalidateQueries({ queryKey: ["ruku-progress"] });
    },
  });
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
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ verseIds, read }: { verseIds: number[]; read: boolean }) => {
      if (verseIds.length === 0) return;
      if (read) {
        const { error } = await supabase
          .from("tafsir_read_verses")
          .upsert(
            verseIds.map((verseId) => ({ user_id: user!.id, verse_id: verseId })),
            { onConflict: "user_id,verse_id" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("tafsir_read_verses")
          .delete()
          .eq("user_id", user!.id)
          .in("verse_id", verseIds);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tafsir-read"] });
      queryClient.invalidateQueries({ queryKey: ["ruku-progress"] });
    },
  });
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
 * same passage again, or loop five requests.
 */
export function useMarkTafsirEntryRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ verseIds }: { verseIds: number[] }) => {
      if (verseIds.length === 0) return;
      const { error } = await supabase
        .from("tafsir_read_verses")
        .upsert(
          verseIds.map((verseId) => ({ user_id: user!.id, verse_id: verseId })),
          { onConflict: "user_id,verse_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tafsir-read"] });
      queryClient.invalidateQueries({ queryKey: ["ruku-progress"] });
    },
  });
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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ wordIds, status }: { wordIds: number[]; status: WordStatus }) => {
      if (wordIds.length === 0) return;
      const { error } = await supabase.rpc("set_words_status", {
        p_word_ids: wordIds,
        p_status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of [
        "word-progress",
        "memorization-overview",
        "vocabulary",
        "vocabulary-overview",
        "ruku-progress",
        "ruku-word-stats",
        "quiz-scoreboard",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
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
