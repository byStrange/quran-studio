import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Ruku, Surah, TafsirEntry, VerseWithWords } from "@/lib/types";

/** Quran content never changes after seeding, so it is cached aggressively. */
const CONTENT_QUERY = { staleTime: Infinity, gcTime: 60 * 60 * 1000 } as const;

export function useSurahs() {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["surahs"],
    queryFn: async (): Promise<Surah[]> => {
      const { data, error } = await supabase.from("quran_surahs").select("*").order("number");
      if (error) throw error;
      return data;
    },
  });
}

export function useRukus() {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["rukus"],
    queryFn: async (): Promise<Ruku[]> => {
      // 558 rows — under the 1000-row cap, so a single request is safe here.
      const { data, error } = await supabase.from("quran_rukus").select("*").order("ruku_number");
      if (error) throw error;
      return data;
    },
  });
}

export function useRuku(rukuNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["ruku", rukuNumber],
    enabled: rukuNumber !== null,
    queryFn: async (): Promise<Ruku> => {
      const { data, error } = await supabase
        .from("quran_rukus")
        .select("*")
        .eq("ruku_number", rukuNumber!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/** Every verse of a ruku, with its word-by-word breakdown. */
export function useRukuVerses(rukuNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["ruku-verses", rukuNumber],
    enabled: rukuNumber !== null,
    queryFn: async (): Promise<VerseWithWords[]> => {
      const { data, error } = await supabase
        .from("quran_verses")
        .select("*, words:quran_words(*)")
        .eq("ruku_number", rukuNumber!)
        .order("ayah_number");
      if (error) throw error;
      return (data ?? []).map((verse) => ({
        ...verse,
        words: [...(verse.words ?? [])].sort((a, b) => a.position - b.position),
      })) as VerseWithWords[];
    },
  });
}

/**
 * Ibn Kathir's commentary covering a specific ayah. Entries often span a
 * range, so this looks for the row whose range contains the ayah.
 */
export function useTafsirForAyah(surahNumber: number | null, ayahNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["tafsir", surahNumber, ayahNumber],
    enabled: surahNumber !== null && ayahNumber !== null,
    queryFn: async (): Promise<TafsirEntry | null> => {
      const { data, error } = await supabase
        .from("tafsir_ibn_kathir")
        .select("*")
        .eq("surah_number", surahNumber!)
        .lte("ayah_start", ayahNumber!)
        .gte("ayah_end", ayahNumber!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });
}
