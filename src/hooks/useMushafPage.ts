import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assemblePage, type MushafGlyph, type MushafLine, type MushafPageData } from "@/lib/mushaf";
import type { Ruku, VerseWithWords } from "@/lib/types";

/** Quran content never changes after seeding, so it is cached aggressively. */
const CONTENT_QUERY = { staleTime: Infinity, gcTime: 60 * 60 * 1000 } as const;

/** One mushaf page: its 15 lines and the glyphs sitting on them. */
export function useMushafPage(pageNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["mushaf-page", pageNumber],
    enabled: pageNumber !== null,
    queryFn: async (): Promise<MushafPageData> => {
      const [lines, glyphs] = await Promise.all([
        supabase
          .from("quran_mushaf_lines")
          .select("*")
          .eq("page_number", pageNumber!)
          .order("line_number"),
        supabase
          .from("quran_mushaf_glyphs")
          .select("*")
          .eq("page_number", pageNumber!)
          .order("id"),
      ]);
      if (lines.error) throw lines.error;
      if (glyphs.error) throw glyphs.error;

      return assemblePage(
        pageNumber!,
        (lines.data ?? []) as MushafLine[],
        (glyphs.data ?? []) as MushafGlyph[],
      );
    },
  });
}

/**
 * The verses appearing on a page, with their words.
 *
 * The page itself renders from glyphs alone, but the reader still needs real
 * text around it: the translation under the selected ayah, the word-by-word
 * breakdown, and the ayah numbers used to look up tafsir.
 */
export function useMushafPageVerses(verseIds: readonly number[]) {
  const key = verseIds.join(",");
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["mushaf-page-verses", key],
    enabled: verseIds.length > 0,
    queryFn: async (): Promise<VerseWithWords[]> => {
      const { data, error } = await supabase
        .from("quran_verses")
        .select("*, words:quran_words(*)")
        .in("id", verseIds as number[])
        .order("id");
      if (error) throw error;
      return (data ?? []).map((verse) => ({
        ...verse,
        words: [...(verse.words ?? [])].sort((a, b) => a.position - b.position),
      })) as VerseWithWords[];
    },
  });
}

/**
 * The rukus a page covers, so page view can report where the reader is and
 * attribute reading time to a ruku the rest of the app already understands.
 */
export function useRukusOnPage(pageNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["mushaf-page-rukus", pageNumber],
    enabled: pageNumber !== null,
    queryFn: async (): Promise<Ruku[]> => {
      const { data, error } = await supabase
        .from("quran_rukus")
        .select("*")
        .lte("page_start", pageNumber!)
        .gte("page_end", pageNumber!)
        .order("ruku_number");
      if (error) throw error;
      return data ?? [];
    },
  });
}
