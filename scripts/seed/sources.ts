/**
 * Upstream data sources.
 *
 * Primary: the quran.com v4 API, which serves Uthmani text, the Saheeh
 * International translation, word-by-word transliteration and glosses, and
 * ruku/juz metadata in a single call per surah — with no credentials.
 *
 * Tafsir: spa5k/tafsir_api, a static JSON mirror of quran.com's tafsir corpus
 * served from jsDelivr, one file per surah per edition.
 *
 * These are fetched exactly once, here, and written into Supabase. The running
 * app never calls them.
 */
import { cachedJson, stripHtml } from "./util.ts";

const QURAN_API = "https://api.quran.com/api/v4";
const TAFSIR_CDN = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir";

/** Saheeh International, resource id 20 in the quran.com translation catalog. */
export const TRANSLATION_ID = 20;

/**
 * The tafsir editions imported, with display metadata written alongside them.
 *
 * The upstream catalogue is not used for these fields: it lists the Uzbek
 * edition with both name and author as "Uzbek Mokhtasar", which is a slug, not
 * a title. Naming them here keeps the picker readable and makes the curation
 * deliberate — the mirror carries a hundred editions and this app ships two.
 *
 * The Uzbek edition is titled and labelled in Cyrillic because its content is
 * Cyrillic; a reader who can use it is a reader who reads that script.
 */
export const TAFSIR_EDITIONS = [
  {
    slug: "en-tafisr-ibn-kathir",
    name: "Ibn Kathir",
    author_name: "Hafiz Ibn Kathir",
    language_code: "en",
    language_name: "English",
    sort_order: 0,
  },
  {
    slug: "uzbek-mokhtasar",
    name: "Ал-Мухтасар",
    author_name: "Tafsir Center for Quranic Studies",
    language_code: "uz",
    language_name: "Ўзбекча",
    sort_order: 1,
  },
] as const;

export type TafsirEditionSlug = (typeof TAFSIR_EDITIONS)[number]["slug"];

// --- wire types ------------------------------------------------------------

interface ChapterResponse {
  chapters: Array<{
    id: number;
    name_simple: string;
    name_arabic: string;
    revelation_place: string;
    verses_count: number;
    translated_name: { name: string };
  }>;
}

interface VersesResponse {
  verses: Array<{
    id: number;
    verse_number: number;
    ruku_number: number;
    juz_number: number;
    page_number: number | null;
    text_uthmani: string;
    translations?: Array<{ text: string }>;
    words?: Array<{
      id: number;
      position: number;
      char_type_name: string;
      text_uthmani: string | null;
      text: string | null;
      translation?: { text: string | null };
      transliteration?: { text: string | null };
    }>;
  }>;
  pagination: { next_page: number | null };
}

type TafsirResponse = Array<{ text: string; ayah: string | number; surah: string | number }>;

// --- domain shapes ---------------------------------------------------------

export interface Surah {
  number: number;
  name_arabic: string;
  name_english: string;
  name_translation: string;
  revelation_type: "meccan" | "medinan";
  ayah_count: number;
}

export interface Verse {
  id: number;
  surah_number: number;
  ayah_number: number;
  ruku_number: number;
  juz_number: number;
  page_number: number | null;
  arabic_text: string;
  translation_en: string;
}

export interface Word {
  id: number;
  verse_id: number;
  position: number;
  arabic: string;
  transliteration: string | null;
  gloss_en: string | null;
}

export interface TafsirEntry {
  edition: string;
  surah_number: number;
  ayah_start: number;
  ayah_end: number;
  content: string;
}

// --- fetchers --------------------------------------------------------------

export async function fetchSurahs(): Promise<Surah[]> {
  const data = await cachedJson<ChapterResponse>(
    "chapters",
    `${QURAN_API}/chapters?language=en`,
  );
  return data.chapters.map((c) => ({
    number: c.id,
    name_arabic: c.name_arabic,
    name_english: c.name_simple,
    name_translation: c.translated_name.name,
    revelation_type: c.revelation_place === "makkah" ? "meccan" : "medinan",
    ayah_count: c.verses_count,
  }));
}

/** All verses of one surah, with their word-by-word breakdown. */
export async function fetchSurahContent(
  surahNumber: number,
): Promise<{ verses: Verse[]; words: Word[] }> {
  const verses: Verse[] = [];
  const words: Word[] = [];

  let page: number | null = 1;
  while (page !== null) {
    const url =
      `${QURAN_API}/verses/by_chapter/${surahNumber}` +
      `?language=en&words=true&word_fields=text_uthmani,transliteration` +
      `&translations=${TRANSLATION_ID}` +
      `&fields=text_uthmani,ruku_number,juz_number,page_number` +
      `&per_page=50&page=${page}`;
    const data: VersesResponse = await cachedJson<VersesResponse>(
      `verses-${surahNumber}-${page}`,
      url,
    );

    for (const v of data.verses) {
      verses.push({
        id: v.id,
        surah_number: surahNumber,
        ayah_number: v.verse_number,
        ruku_number: v.ruku_number,
        juz_number: v.juz_number,
        page_number: v.page_number,
        arabic_text: v.text_uthmani,
        translation_en: stripHtml(v.translations?.[0]?.text ?? ""),
      });

      for (const w of v.words ?? []) {
        // `end` entries are the decorative ayah-number glyph, not a word.
        if (w.char_type_name !== "word") continue;
        const arabic = w.text_uthmani ?? w.text;
        if (!arabic) continue;
        words.push({
          id: w.id,
          verse_id: v.id,
          position: w.position,
          arabic,
          transliteration: w.transliteration?.text ?? null,
          gloss_en: w.translation?.text ?? null,
        });
      }
    }
    page = data.pagination.next_page;
  }

  return { verses, words };
}

/**
 * One edition's commentary on one surah.
 *
 * Ibn Kathir comments on runs of ayahs at a time, and the mirror repeats the
 * identical commentary against every ayah in the run. Consecutive duplicates
 * are collapsed into one row covering the whole range so the reader can show
 * "commentary on 2:1-5" instead of the same text five times. The Mukhtasar
 * comments ayah by ayah and collapses to almost nothing, which is correct
 * rather than a special case — the rule is "identical neighbours merge", and
 * it simply finds few.
 */
export async function fetchTafsir(
  edition: string,
  surahNumber: number,
  ayahCount: number,
): Promise<TafsirEntry[]> {
  const data = await cachedJson<TafsirResponse>(
    // The edition belongs in the cache key: without it the second edition
    // would be served the first one's download.
    `tafsir-${edition}-${surahNumber}`,
    `${TAFSIR_CDN}/${edition}/${surahNumber}.json`,
  );

  const byAyah = new Map<number, string>();
  for (const entry of data) {
    const ayah = Number(entry.ayah);
    const text = stripHtml(entry.text ?? "");
    if (!Number.isFinite(ayah) || ayah < 1 || ayah > ayahCount || !text) continue;
    byAyah.set(ayah, text);
  }

  const entries: TafsirEntry[] = [];
  let current: TafsirEntry | null = null;
  for (let ayah = 1; ayah <= ayahCount; ayah++) {
    const text = byAyah.get(ayah);
    if (!text) {
      current = null; // a gap ends the run
      continue;
    }
    if (current && current.content === text && current.ayah_end === ayah - 1) {
      current.ayah_end = ayah;
    } else {
      current = {
        edition,
        surah_number: surahNumber,
        ayah_start: ayah,
        ayah_end: ayah,
        content: text,
      };
      entries.push(current);
    }
  }
  return entries;
}

/** Ruku boundaries, derived from the per-verse ruku numbers. */
export function deriveRukus(verses: readonly Verse[]): Array<{
  ruku_number: number;
  surah_number: number;
  ayah_start: number;
  ayah_end: number;
  verse_count: number;
  ruku_in_surah: number;
}> {
  const byRuku = new Map<number, Verse[]>();
  for (const v of verses) {
    const list = byRuku.get(v.ruku_number);
    if (list) list.push(v);
    else byRuku.set(v.ruku_number, [v]);
  }

  const rukus = [...byRuku.entries()]
    .map(([ruku_number, group]) => {
      const sorted = [...group].sort((a, b) => a.ayah_number - b.ayah_number);
      const surahs = new Set(sorted.map((v) => v.surah_number));
      if (surahs.size !== 1) {
        throw new Error(
          `ruku ${ruku_number} spans multiple surahs (${[...surahs].join(", ")})`,
        );
      }
      return {
        ruku_number,
        surah_number: sorted[0]!.surah_number,
        ayah_start: sorted[0]!.ayah_number,
        ayah_end: sorted[sorted.length - 1]!.ayah_number,
        verse_count: sorted.length,
        ruku_in_surah: 0, // assigned below
      };
    })
    .sort((a, b) => a.ruku_number - b.ruku_number);

  const seenPerSurah = new Map<number, number>();
  for (const ruku of rukus) {
    const next = (seenPerSurah.get(ruku.surah_number) ?? 0) + 1;
    seenPerSurah.set(ruku.surah_number, next);
    ruku.ruku_in_surah = next;
  }
  return rukus;
}
