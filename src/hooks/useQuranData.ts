import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { local, offlineFirst } from "@/lib/offline/packs";
import type { Ruku, Surah, TafsirEdition, TafsirEntry, VerseWithWords } from "@/lib/types";

/**
 * Quran content never changes after seeding, so it is cached aggressively.
 *
 * `networkMode: "always"` because these read the offline packs before the
 * network: left at the default, the query would pause while offline instead
 * of running and finding the downloaded copy. Not persisted with the query
 * cache either — the packs are the offline copy, and duplicating megabytes of
 * scripture into the cache snapshot would only slow every save of it.
 */
export const CONTENT_QUERY = {
  staleTime: Infinity,
  gcTime: 60 * 60 * 1000,
  networkMode: "always",
  meta: { persist: false },
} as const;

export function useSurahs() {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["surahs"],
    queryFn: async (): Promise<Surah[]> => {
      return offlineFirst(
        () => local.surahs(),
        async () => {
          const { data, error } = await supabase.from("quran_surahs").select("*").order("number");
          if (error) throw error;
          return data;
        },
      );
    },
  });
}

export function useRukus() {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["rukus"],
    queryFn: async (): Promise<Ruku[]> => {
      return offlineFirst(
        () => local.rukus(),
        async () => {
          // 558 rows — under the 1000-row cap, so a single request is safe here.
          const { data, error } = await supabase.from("quran_rukus").select("*").order("ruku_number");
          if (error) throw error;
          return data;
        },
      );
    },
  });
}

export function useRuku(rukuNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["ruku", rukuNumber],
    enabled: rukuNumber !== null,
    queryFn: async (): Promise<Ruku> => {
      return offlineFirst(
        () => local.ruku(rukuNumber!),
        async () => {
          const { data, error } = await supabase
            .from("quran_rukus")
            .select("*")
            .eq("ruku_number", rukuNumber!)
            .single();
          if (error) throw error;
          return data;
        },
      );
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
      return offlineFirst(
        () => local.rukuVerses(rukuNumber!),
        async () => {
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
      );
    },
  });
}

/** How many ayahs of a surah each page of the continuous reader holds. */
export const SURAH_PAGE_SIZE = 40;

/**
 * A whole surah, one page of ayahs at a time.
 *
 * The continuous reader walks a surah from top to bottom, and Al-Baqarah is
 * 286 ayahs of text, translation and word-by-word breakdown — a single request
 * for that is several megabytes before a single line is drawn. Paging by ayah
 * number rather than offset keeps each page's boundary stable as the reader
 * scrolls, so a page can never repeat or skip an ayah of the surah.
 */
export function useSurahVerses(surahNumber: number | null) {
  return useInfiniteQuery({
    ...CONTENT_QUERY,
    queryKey: ["surah-verses", surahNumber],
    enabled: surahNumber !== null,
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }): Promise<VerseWithWords[]> => {
      return offlineFirst(
        () => local.surahVerses(surahNumber!, pageParam, SURAH_PAGE_SIZE),
        async () => {
          let query = supabase
            .from("quran_verses")
            .select("*, words:quran_words(*)")
            .eq("surah_number", surahNumber!)
            .order("ayah_number")
            .limit(SURAH_PAGE_SIZE);
          if (pageParam !== null) query = query.gt("ayah_number", pageParam);
          const { data, error } = await query;
          if (error) throw error;
          return (data ?? []).map((verse) => ({
            ...verse,
            words: [...(verse.words ?? [])].sort((a, b) => a.position - b.position),
          })) as VerseWithWords[];
        },
      );
    },
    getNextPageParam: (lastPage) =>
      lastPage.length < SURAH_PAGE_SIZE ? undefined : lastPage[lastPage.length - 1]!.ayah_number,
  });
}

/**
 * `ayah_number` → verse id, for one whole surah.
 *
 * A tafsir entry's range is written in ayah numbers and does not have to stop
 * where the ruku does — a commentary on 2:1-5 is one passage whether or not the
 * ruku on screen ends at 2:4. Marking it read therefore needs the surah's
 * numbering rather than only the verses the reader happens to have loaded.
 * The longest surah is 286 rows, so this stays a single request.
 */
export function useSurahVerseIds(surahNumber: number | null) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["surah-verse-ids", surahNumber],
    enabled: surahNumber !== null,
    queryFn: async (): Promise<Map<number, number>> => {
      return offlineFirst(
        () => local.surahVerseIds(surahNumber!),
        async () => {
          const { data, error } = await supabase
            .from("quran_verses")
            .select("id, ayah_number")
            .eq("surah_number", surahNumber!)
            .order("ayah_number");
          if (error) throw error;
          return new Map((data ?? []).map((row) => [row.ayah_number, row.id]));
        },
      );
    },
  });
}

/** One word of a chosen ayah range, for the gloss contribution tool's scaffold. */
export interface AyahRangeWord {
  id: number;
  arabic: string;
  gloss_en: string | null;
  verse_id: number;
  surah_number: number;
  ayah_number: number;
  position: number;
}

/**
 * Every word of an ayah range, in reading order, for the gloss tool.
 *
 * Not a `CONTENT_QUERY` and not offline-first on purpose: this reads live from
 * Supabase and the tool is desktop + online by nature. Enabled only once a
 * range is committed. Carries `verse_id` and `position` because an Uzbek gloss
 * is a segment — a range of positions within a verse — not a per-word value.
 */
export function useAyahRangeWords(
  range: { surah: number; start: number; end: number } | null,
) {
  return useQuery({
    queryKey: ["ayah-range-words", range?.surah, range?.start, range?.end],
    enabled: range !== null,
    staleTime: 0,
    queryFn: async (): Promise<AyahRangeWord[]> => {
      const { data, error } = await supabase
        .from("quran_verses")
        .select(
          "id, surah_number, ayah_number, words:quran_words(id, position, arabic, gloss_en)",
        )
        .eq("surah_number", range!.surah)
        .gte("ayah_number", range!.start)
        .lte("ayah_number", range!.end)
        .order("ayah_number");
      if (error) throw error;
      const rows: AyahRangeWord[] = [];
      for (const verse of data ?? []) {
        const words = [...(verse.words ?? [])].sort((a, b) => a.position - b.position);
        for (const w of words) {
          rows.push({
            id: w.id,
            arabic: w.arabic,
            gloss_en: w.gloss_en,
            verse_id: verse.id,
            surah_number: verse.surah_number,
            ayah_number: verse.ayah_number,
            position: w.position,
          });
        }
      }
      return rows;
    },
  });
}

/** The tafsir editions that were seeded, in the order the picker shows them. */
export function useTafsirEditions() {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["tafsir-editions"],
    queryFn: async (): Promise<TafsirEdition[]> => {
      return offlineFirst(
        () => local.tafsirEditions(),
        async () => {
          const { data, error } = await supabase
            .from("tafsir_editions")
            .select("*")
            .order("sort_order")
            .order("name");
          if (error) throw error;
          return data;
        },
      );
    },
  });
}

/**
 * One edition's commentary covering a specific ayah. Entries can span a range,
 * so this looks for the row whose range contains the ayah.
 */
export function useTafsirForAyah(
  surahNumber: number | null,
  ayahNumber: number | null,
  edition: string,
) {
  return useQuery({
    ...CONTENT_QUERY,
    queryKey: ["tafsir", edition, surahNumber, ayahNumber],
    enabled: surahNumber !== null && ayahNumber !== null,
    queryFn: async (): Promise<TafsirEntry | null> => {
      return offlineFirst(
        () => local.tafsir(edition, surahNumber!, ayahNumber!),
        async () => {
          const { data, error } = await supabase
            .from("tafsir")
            .select("*")
            .eq("edition", edition)
            .eq("surah_number", surahNumber!)
            .lte("ayah_start", ayahNumber!)
            .gte("ayah_end", ayahNumber!)
            .maybeSingle();
          if (error) throw error;
          return data ?? null;
        },
      );
    },
  });
}
