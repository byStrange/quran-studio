import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { useProfile } from "@/hooks/useProfile";
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

export function useMemorizedVerses(verseIds?: number[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["memorized", user?.id, verseIds?.join(",") ?? "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Set<number>> => {
      let query = supabase.from("memorized_verses").select("verse_id");
      if (verseIds?.length) query = query.in("verse_id", verseIds);
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

export function useToggleRukuMemorized() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ verseIds, memorized }: { verseIds: number[]; memorized: boolean }) => {
      if (verseIds.length === 0) return;
      if (memorized) {
        const { error } = await supabase
          .from("memorized_verses")
          .upsert(
            verseIds.map((verseId) => ({ user_id: user!.id, verse_id: verseId })),
            { onConflict: "user_id,verse_id" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("memorized_verses")
          .delete()
          .eq("user_id", user!.id)
          .in("verse_id", verseIds);
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
      let query = supabase.from("tafsir_read_verses").select("verse_id");
      if (verseIds?.length) query = query.in("verse_id", verseIds);
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

export function useSetWordStatus() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ wordId, status }: { wordId: number; status: WordStatus }) => {
      const { error } = await supabase.from("user_word_progress").upsert(
        {
          user_id: user!.id,
          word_id: wordId,
          status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,word_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["word-progress"] });
      queryClient.invalidateQueries({ queryKey: ["memorization-overview"] });
      queryClient.invalidateQueries({ queryKey: ["vocabulary"] });
    },
  });
}

// --- words learned (verse level) -------------------------------------------

export function useWordsLearnedVerses(verseIds?: number[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["words-learned-verses", user?.id, verseIds?.join(",") ?? "all"],
    enabled: Boolean(user),
    queryFn: async (): Promise<Set<number>> => {
      let query = supabase.from("words_learned_verses").select("verse_id");
      if (verseIds?.length) query = query.in("verse_id", verseIds);
      const { data, error } = await query;
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.verse_id));
    },
  });
}

export function useToggleWordsLearned() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ verseIds, learned }: { verseIds: number[]; learned: boolean }) => {
      if (verseIds.length === 0) return;
      if (learned) {
        const { error } = await supabase
          .from("words_learned_verses")
          .upsert(
            verseIds.map((verseId) => ({ user_id: user!.id, verse_id: verseId })),
            { onConflict: "user_id,verse_id" },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("words_learned_verses")
          .delete()
          .eq("user_id", user!.id)
          .in("verse_id", verseIds);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["words-learned-verses"] });
      queryClient.invalidateQueries({ queryKey: ["ruku-progress"] });
    },
  });
}
