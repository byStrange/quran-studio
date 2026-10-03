/**
 * Offline packs — the Quran and its commentaries, downloaded once and read
 * from this device afterwards, the way a maps app keeps a region.
 *
 * Two kinds of pack:
 * - `quran`: every surah, ruku and ayah with its translations, word-by-word
 *   breakdown and tajweed, the 604 mushaf pages, and the reciter catalogue.
 *   The page fonts already ship inside the app, so this is all the mushaf
 *   needs too.
 * - `tafsir:<slug>`: one tafsir edition, entry by entry.
 *
 * Recitation audio is not a pack. It is several gigabytes per reciter, so it
 * stays per surah (`useAudioDownloads`), and each surah download brings its
 * ayah timings into the `timings` store so it plays offline with following.
 *
 * Once a pack is installed, the content hooks read it first and the network
 * second (`offlineFirst`). A pack is marked installed only after every row is
 * written, so a download cut off half way leaves the app reading the network
 * rather than a Quran with holes in it.
 */
import { supabase } from "@/lib/supabase";
import type { MushafGlyph, MushafLine } from "@/lib/mushaf";
import type {
  RecitationFile,
  Reciter,
  Ruku,
  Surah,
  TafsirEdition,
  TafsirEntry,
  VerseWithWords,
  Word,
} from "@/lib/types";
import {
  clearStore,
  deleteByIndex,
  getAllByIndex,
  getMany,
  getOne,
  kvDelete,
  kvGet,
  kvSet,
  putAll,
} from "./db";

export type PackId = "quran" | `tafsir:${string}`;

export interface PackInfo {
  installedAt: string;
  /** Rows written, for the settings list. */
  rows: number;
}

type Manifest = Partial<Record<PackId, PackInfo>>;

const MANIFEST_KEY = "packs";

// --- manifest --------------------------------------------------------------

let manifest: Manifest = {};
let manifestLoaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Loads which packs are installed. Every local read awaits it. */
export function loadManifest(): Promise<void> {
  if (!manifestLoaded) {
    manifestLoaded = kvGet<Manifest>(MANIFEST_KEY)
      .then((stored) => {
        manifest = stored ?? {};
        notify();
      })
      .catch(() => {
        manifest = {};
      });
  }
  return manifestLoaded;
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeManifest(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getManifest(): Manifest {
  return manifest;
}

/** Manifest writes, one after another: two packs finishing together must not each overwrite the other's entry. */
let manifestWrites: Promise<void> = Promise.resolve();

function setPack(id: PackId, info: PackInfo | null): Promise<void> {
  const write = manifestWrites.then(async () => {
    await loadManifest();
    const next = { ...manifest };
    if (info) next[id] = info;
    else delete next[id];
    await kvSet(MANIFEST_KEY, next);
    manifest = next;
    notify();
  });
  // A failed write must not wedge every later one.
  manifestWrites = write.catch(() => {});
  return write;
}

async function installed(id: PackId): Promise<boolean> {
  await loadManifest();
  return Boolean(manifest[id]);
}

// --- reading ---------------------------------------------------------------

/**
 * Reads from the device when it can, and from Supabase when it can't.
 *
 * `local` returns undefined for "not on this device" — a pack not installed,
 * a row it doesn't hold — and only then is the network asked. A local read
 * that throws (storage unavailable) falls through to the network as well.
 */
export async function offlineFirst<T>(
  local: () => Promise<T | undefined>,
  remote: () => Promise<T>,
): Promise<T> {
  try {
    const value = await local();
    if (value !== undefined) return value;
  } catch {
    // Fall through to the network.
  }
  return remote();
}

export const local = {
  async surahs(): Promise<Surah[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    return kvGet<Surah[]>("table:surahs");
  },

  async rukus(): Promise<Ruku[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    return kvGet<Ruku[]>("table:rukus");
  },

  async ruku(rukuNumber: number): Promise<Ruku | undefined> {
    return (await local.rukus())?.find((ruku) => ruku.ruku_number === rukuNumber);
  },

  async rukusOnPage(page: number): Promise<Ruku[] | undefined> {
    return (await local.rukus())?.filter(
      (ruku) => (ruku.page_start ?? Infinity) <= page && (ruku.page_end ?? -Infinity) >= page,
    );
  },

  async rukuVerses(rukuNumber: number): Promise<VerseWithWords[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    const rows = await getAllByIndex<VerseWithWords>("verses", "ruku_number", rukuNumber);
    return rows.sort((a, b) => a.ayah_number - b.ayah_number);
  },

  async surahVerses(
    surahNumber: number,
    afterAyah: number | null,
    limit: number,
  ): Promise<VerseWithWords[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    const rows = await getAllByIndex<VerseWithWords>("verses", "surah_number", surahNumber);
    return rows
      .filter((verse) => afterAyah === null || verse.ayah_number > afterAyah)
      .sort((a, b) => a.ayah_number - b.ayah_number)
      .slice(0, limit);
  },

  async surahVerseIds(surahNumber: number): Promise<Map<number, number> | undefined> {
    if (!(await installed("quran"))) return undefined;
    const rows = await getAllByIndex<VerseWithWords>("verses", "surah_number", surahNumber);
    return new Map(
      rows.sort((a, b) => a.ayah_number - b.ayah_number).map((row) => [row.ayah_number, row.id]),
    );
  },

  async versesById(ids: readonly number[]): Promise<VerseWithWords[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    const rows = await getMany<VerseWithWords>("verses", [...ids]);
    return rows.sort((a, b) => a.id - b.id);
  },

  async mushafPage(
    page: number,
  ): Promise<{ lines: MushafLine[]; glyphs: MushafGlyph[] } | undefined> {
    if (!(await installed("quran"))) return undefined;
    return getOne("mushaf", page);
  },

  async tafsirEditions(): Promise<TafsirEdition[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    return kvGet<TafsirEdition[]>("table:tafsir_editions");
  },

  /**
   * The entry covering an ayah, or null when the edition has none there —
   * which, with the edition installed, is a real answer and not a miss.
   */
  async tafsir(
    edition: string,
    surahNumber: number,
    ayahNumber: number,
  ): Promise<TafsirEntry | null | undefined> {
    if (!(await installed(`tafsir:${edition}`))) return undefined;
    const rows = await getAllByIndex<TafsirEntry>("tafsir", "edition_surah", [
      edition,
      surahNumber,
    ]);
    return rows.find((row) => row.ayah_start <= ayahNumber && row.ayah_end >= ayahNumber) ?? null;
  },

  async reciters(): Promise<Reciter[] | undefined> {
    if (!(await installed("quran"))) return undefined;
    return kvGet<Reciter[]>("table:reciters");
  },

  async recitationFile(
    reciterId: number,
    surahNumber: number,
  ): Promise<RecitationFile | null | undefined> {
    if (!(await installed("quran"))) return undefined;
    const files = await kvGet<RecitationFile[]>("table:recitation_files");
    if (!files) return undefined;
    return (
      files.find((file) => file.reciter_id === reciterId && file.surah_number === surahNumber) ??
      null
    );
  },

  /**
   * Timings saved alongside a downloaded surah. Not tied to a pack: they are
   * there exactly when the surah's audio was downloaded. Returned only when
   * every asked-for ayah is covered, so a passage is never half-timed.
   */
  async timings(reciterId: number, verseIds: readonly number[]): Promise<TimingRow[] | undefined> {
    const rows = await getMany<TimingRow>(
      "timings",
      verseIds.map((verseId) => [reciterId, verseId]),
    );
    return rows.length === verseIds.length && rows.length > 0 ? rows : undefined;
  },
};

export interface TimingRow {
  reciter_id: number;
  verse_id: number;
  surah_number: number;
  start_ms: number;
  end_ms: number;
  segments: unknown;
}

// --- recitation timings ----------------------------------------------------

/** Saves one surah's timings for a reciter, so its downloaded audio can follow along offline. */
export async function saveSurahTimings(reciterId: number, surahNumber: number): Promise<void> {
  const { data: verses, error: versesError } = await supabase
    .from("quran_verses")
    .select("id")
    .eq("surah_number", surahNumber);
  if (versesError) throw versesError;
  const ids = (verses ?? []).map((row) => row.id);
  if (ids.length === 0) return;
  const { data, error } = await supabase
    .from("recitation_timings")
    .select("verse_id, start_ms, end_ms, segments")
    .eq("reciter_id", reciterId)
    .in("verse_id", ids);
  if (error) throw error;
  await putAll(
    "timings",
    (data ?? []).map((row) => ({ ...row, reciter_id: reciterId, surah_number: surahNumber })),
  );
}

export async function removeSurahTimings(reciterId: number, surahNumber: number): Promise<void> {
  await deleteByIndex("timings", "reciter_surah", [reciterId, surahNumber]);
}

// --- downloading -----------------------------------------------------------

export interface PackProgress {
  done: number;
  total: number;
}

type OnProgress = (progress: PackProgress) => void;

/** The REST layer's row cap: every larger table is walked in pages of this. */
const PAGE = 1000;

class Cancelled extends Error {
  constructor() {
    super("Download cancelled");
    this.name = "Cancelled";
  }
}

export function isCancelled(error: unknown): boolean {
  return error instanceof Cancelled;
}

function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new Cancelled();
}

async function countRows(table: string, filter?: (q: any) => any): Promise<number> {
  let query: any = supabase.from(table as never).select("*", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * Every row of a table, `PAGE` at a time, ordered by `orderBy` so pages never
 * overlap or skip. Pages are fetched a few at a time — one after another is
 * slow over a high-latency link, all at once trips rate limits.
 */
async function fetchAll<T>(
  table: string,
  orderBy: string,
  {
    filter,
    pageSize = PAGE,
    signal,
    onPage,
  }: {
    filter?: (q: any) => any;
    pageSize?: number;
    signal?: AbortSignal;
    onPage: () => void;
  },
): Promise<T[]> {
  const total = await countRows(table, filter);
  const pages = Math.ceil(total / pageSize);
  const results: T[][] = new Array(pages);
  let next = 0;
  const worker = async () => {
    while (next < pages) {
      const page = next++;
      check(signal);
      let query: any = supabase
        .from(table as never)
        .select("*")
        .order(orderBy)
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (filter) query = filter(query);
      const { data, error } = await query;
      if (error) throw error;
      results[page] = (data ?? []) as T[];
      onPage();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pages) }, worker));
  return results.flat();
}

/** How many page requests a table will take, for the progress bar. */
async function pagesOf(table: string, pageSize = PAGE, filter?: (q: any) => any) {
  return Math.max(1, Math.ceil((await countRows(table, filter)) / pageSize));
}

export async function downloadQuranPack(onProgress: OnProgress, signal?: AbortSignal) {
  // The small tables are one request each; the big ones are counted first so
  // the bar moves evenly rather than jumping at the end.
  const [verses, words, lines, glyphs, files] = await Promise.all([
    pagesOf("quran_verses"),
    pagesOf("quran_words"),
    pagesOf("quran_mushaf_lines"),
    pagesOf("quran_mushaf_glyphs"),
    pagesOf("recitation_files"),
  ]);
  const progress = { done: 0, total: 4 + verses + words + lines + glyphs + files + 1 };
  const tick = () => {
    progress.done += 1;
    onProgress({ ...progress });
  };
  onProgress({ ...progress });

  const small = async <T>(table: string, order: string[]): Promise<T[]> => {
    check(signal);
    let query: any = supabase.from(table as never).select("*");
    for (const column of order) query = query.order(column);
    const { data, error } = await query;
    if (error) throw error;
    tick();
    return (data ?? []) as T[];
  };

  const surahs = await small<Surah>("quran_surahs", ["number"]);
  const rukus = await small<Ruku>("quran_rukus", ["ruku_number"]);
  const editions = await small<TafsirEdition>("tafsir_editions", ["sort_order", "name"]);
  const reciters = await small<Reciter>("reciters", ["sort_order", "name"]);
  const recitationFiles = await fetchAll<RecitationFile>("recitation_files", "reciter_id", {
    signal,
    onPage: tick,
    // Two columns make a stable order; reciter id alone would let pages shuffle.
    filter: (q) => q.order("surah_number"),
  });
  const verseRows = await fetchAll<VerseWithWords>("quran_verses", "id", { signal, onPage: tick });
  const wordRows = await fetchAll<Word>("quran_words", "id", { signal, onPage: tick });
  const lineRows = await fetchAll<MushafLine>("quran_mushaf_lines", "page_number", {
    signal,
    onPage: tick,
    filter: (q) => q.order("line_number"),
  });
  const glyphRows = await fetchAll<MushafGlyph>("quran_mushaf_glyphs", "id", {
    signal,
    onPage: tick,
  });
  check(signal);

  const wordsByVerse = new Map<number, Word[]>();
  for (const word of wordRows) {
    const list = wordsByVerse.get(word.verse_id);
    if (list) list.push(word);
    else wordsByVerse.set(word.verse_id, [word]);
  }
  const fullVerses = verseRows.map((verse) => ({
    ...verse,
    words: (wordsByVerse.get(verse.id) ?? []).sort((a, b) => a.position - b.position),
  }));

  const pages = new Map<number, { page_number: number; lines: MushafLine[]; glyphs: MushafGlyph[] }>();
  const pageOf = (page: number) => {
    let entry = pages.get(page);
    if (!entry) {
      entry = { page_number: page, lines: [], glyphs: [] };
      pages.set(page, entry);
    }
    return entry;
  };
  for (const line of lineRows) pageOf(line.page_number).lines.push(line);
  for (const glyph of glyphRows) pageOf(glyph.page_number).glyphs.push(glyph);
  for (const page of pages.values()) {
    page.lines.sort((a, b) => a.line_number - b.line_number);
    page.glyphs.sort((a, b) => a.id - b.id);
  }

  // Uninstalled while the rows are replaced — and not before: an update that
  // fails or is cancelled while fetching leaves the old pack working. A crash
  // past this point must not leave the manifest vouching for half-written rows.
  await setPack("quran", null);
  await clearStore("verses");
  await clearStore("mushaf");
  // Written in slices so no single transaction holds the whole Quran.
  for (let i = 0; i < fullVerses.length; i += 500) {
    check(signal);
    await putAll("verses", fullVerses.slice(i, i + 500));
  }
  await putAll("mushaf", [...pages.values()]);
  await kvSet("table:surahs", surahs);
  await kvSet("table:rukus", rukus);
  await kvSet("table:tafsir_editions", editions);
  await kvSet("table:reciters", reciters);
  await kvSet("table:recitation_files", recitationFiles);
  tick();

  await setPack("quran", {
    installedAt: new Date().toISOString(),
    rows: fullVerses.length + wordRows.length + lineRows.length + glyphRows.length,
  });
}

export async function downloadTafsirPack(
  edition: string,
  onProgress: OnProgress,
  signal?: AbortSignal,
) {
  const id: PackId = `tafsir:${edition}`;
  // Entries run to tens of kilobytes each, so pages are smaller than the cap.
  const pageSize = 200;
  const filter = (q: any) => q.eq("edition", edition);
  const total = await pagesOf("tafsir", pageSize, filter);
  const progress = { done: 0, total: total + 1 };
  onProgress({ ...progress });

  const rows = await fetchAll<TafsirEntry>("tafsir", "id", {
    filter,
    pageSize,
    signal,
    onPage: () => {
      progress.done += 1;
      onProgress({ ...progress });
    },
  });
  check(signal);
  // As with the Quran pack: uninstalled only once the old rows start going.
  await setPack(id, null);
  await deleteByIndex("tafsir", "edition", edition);
  for (let i = 0; i < rows.length; i += 500) {
    check(signal);
    await putAll("tafsir", rows.slice(i, i + 500));
  }
  progress.done += 1;
  onProgress({ ...progress });
  await setPack(id, { installedAt: new Date().toISOString(), rows: rows.length });
}

export async function removePack(id: PackId) {
  await setPack(id, null);
  if (id === "quran") {
    await clearStore("verses");
    await clearStore("mushaf");
    for (const table of ["surahs", "rukus", "tafsir_editions", "reciters", "recitation_files"]) {
      await kvDelete(`table:${table}`);
    }
  } else {
    await deleteByIndex("tafsir", "edition", id.slice("tafsir:".length));
  }
}
