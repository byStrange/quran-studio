import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  RecitationFile,
  RecitationTiming,
  Reciter,
  WordSegment,
} from "@/lib/types";

/** Recitation metadata never changes after seeding, like the rest of the content. */
const CONTENT_QUERY = { staleTime: Infinity, gcTime: 60 * 60 * 1000 } as const;

export function useReciters() {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["reciters"],
    queryFn: async (): Promise<Reciter[]> => {
      const { data, error } = await supabase
        .from("reciters")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * The reciter to actually play.
 *
 * A stored preference wins, but only if that reciter still exists; otherwise
 * this falls back to the first in the list, so the player is never pointed at
 * a reciter a later import removed.
 */
export function useActiveReciter(preferredId: number | null): Reciter | null {
  const { data: reciters } = useReciters();
  return useMemo(() => {
    if (!reciters?.length) return null;
    return reciters.find((r) => r.id === preferredId) ?? reciters[0]!;
  }, [reciters, preferredId]);
}

/** The whole-surah recording for one reciter. */
export function useRecitationFile(reciterId: number | null, surahNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["recitation-file", reciterId, surahNumber],
    enabled: reciterId !== null && surahNumber !== null,
    queryFn: async (): Promise<RecitationFile | null> => {
      const { data, error } = await supabase
        .from("recitation_files")
        .select("*")
        .eq("reciter_id", reciterId!)
        .eq("surah_number", surahNumber!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}

/**
 * Ayah offsets for a set of verses, keyed by verse id.
 *
 * Stored `segments` are `[position, startMs, endMs]` triples — compact in the
 * database, awkward everywhere else — so they are widened into named fields
 * once here rather than at each read.
 */
export function useRecitationTimings(reciterId: number | null, verseIds: number[]) {
  const key = verseIds.join(",");
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["recitation-timings", reciterId, key],
    enabled: reciterId !== null && verseIds.length > 0,
    queryFn: async (): Promise<Map<number, RecitationTiming>> => {
      const { data, error } = await supabase
        .from("recitation_timings")
        .select("verse_id, start_ms, end_ms, segments")
        .eq("reciter_id", reciterId!)
        .in("verse_id", verseIds);
      if (error) throw error;

      const timings = new Map<number, RecitationTiming>();
      for (const row of data ?? []) {
        timings.set(row.verse_id, {
          verseId: row.verse_id,
          startMs: row.start_ms,
          endMs: row.end_ms,
          segments: parseSegments(row.segments),
        });
      }
      return timings;
    },
  });
}

function parseSegments(raw: unknown): WordSegment[] {
  if (!Array.isArray(raw)) return [];
  const segments: WordSegment[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [position, startMs, endMs] = entry as unknown[];
    if (typeof position !== "number" || typeof startMs !== "number" || typeof endMs !== "number") {
      continue;
    }
    segments.push({ position, startMs, endMs });
  }
  return segments;
}
