/**
 * Recitation audio sourcing.
 *
 * quran.com's `qdc` audio API is the only open source that publishes both
 * halves of what following-along needs: a continuous per-surah recording *and*
 * the offsets of every ayah inside it. Everything else in the open ecosystem
 * gives one or the other — EveryAyah publishes per-ayah clips (which is the
 * mechanical-sounding playback this feature exists to avoid), and the bare
 * quranicaudio.com mirrors publish surah files with no timing data at all.
 *
 * Two endpoints are used, both unauthenticated:
 *
 *   /audio/reciters                          the reciter catalogue
 *   /audio/reciters/{id}/audio_files?chapter the file + its verse timings
 *
 * The second returns exactly one file per surah for every reciter listed here
 * (they are all gapless recordings), carrying `duration`, the mp3 URL, and a
 * `verse_timings` array with millisecond offsets per ayah plus word-level
 * `segments`.
 */
import { cachedJson } from "./util.ts";

const API = "https://api.qurancdn.com/api/qdc";

// --- upstream shapes -------------------------------------------------------

interface QdcReciter {
  id: number;
  reciter_id: number;
  name: string;
  style?: { name?: string } | null;
  qirat?: { name?: string } | null;
}

interface QdcVerseTiming {
  verse_key: string;
  timestamp_from: number;
  timestamp_to: number;
  duration: number;
  segments?: number[][] | null;
}

interface QdcAudioFile {
  id: number;
  chapter_id: number;
  file_size?: number | null;
  format?: string | null;
  audio_url: string;
  duration: number;
  verse_timings?: QdcVerseTiming[] | null;
}

// --- row shapes (mirroring the tables) -------------------------------------

export interface ReciterRow {
  id: number;
  slug: string;
  name: string;
  style: string | null;
  qirat: string | null;
  sort_order: number;
}

export interface RecitationFileRow {
  reciter_id: number;
  surah_number: number;
  audio_url: string;
  duration_ms: number;
  file_size: number | null;
  format: string;
}

export interface RecitationTimingRow {
  reciter_id: number;
  verse_id: number;
  start_ms: number;
  end_ms: number;
  segments: number[][] | null;
}

/**
 * A stable, readable key for a reciter.
 *
 * The same reciter appears once per recitation style, so the style has to be
 * part of the slug — AbdulBaset's Murattal and Mujawwad are different
 * recordings and both are offered.
 */
function slugify(name: string, style: string | null): string {
  return `${name} ${style ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function fetchReciters(): Promise<ReciterRow[]> {
  const data = await cachedJson<{ reciters: QdcReciter[] }>(
    "audio-reciters",
    `${API}/audio/reciters?locale=en`,
  );

  const reciters = data.reciters.map((reciter) => {
    const style = reciter.style?.name?.trim() || null;
    return {
      id: reciter.id,
      slug: slugify(reciter.name, style),
      name: reciter.name.trim(),
      style,
      qirat: reciter.qirat?.name?.trim() || null,
      sort_order: 0,
    };
  });

  // The catalogue lists the same recitation twice under two ids where a
  // second, streaming-optimised encode exists — ids 7 and 173 are both
  // al-`Afasy's Murattal, identical in name, style and qirat, differing only
  // in which encode of the same recording they point at.
  //
  // Both are kept upstream because their player chooses between them by
  // bitrate. Here they would be two picker entries a reader cannot tell apart,
  // so the duplicate is dropped. The lower id wins: it is the original entry,
  // and the only one whose audio-file rows carry a `file_size` — which is what
  // the download UI shows before fetching anything.
  //
  // This deliberately keeps genuinely distinct performances: al-Minshawi's
  // Murattal and his "Kids repeat" share a name but differ in style, so their
  // slugs differ and both survive.
  const byIdentity = new Map<string, ReciterRow>();
  for (const reciter of reciters) {
    const existing = byIdentity.get(reciter.slug);
    if (!existing || reciter.id < existing.id) byIdentity.set(reciter.slug, reciter);
  }

  const deduped = [...byIdentity.values()];

  // Upstream order is arbitrary and has changed between requests. Sorting by
  // name here means the reader's picker keeps the same order across imports.
  deduped.sort(
    (a, b) => a.name.localeCompare(b.name) || (a.style ?? "").localeCompare(b.style ?? ""),
  );
  deduped.forEach((reciter, index) => {
    reciter.sort_order = index;
  });
  return deduped;
}

/**
 * One surah's recording for one reciter, with its ayah offsets.
 *
 * `resolveVerseId` maps a `surah:ayah` pair onto our canonical verse id; it is
 * passed in rather than derived so the mapping stays a single database-backed
 * fact instead of arithmetic repeated per call site.
 */
export async function fetchSurahAudio(
  reciterId: number,
  surahNumber: number,
  resolveVerseId: (surah: number, ayah: number) => number | undefined,
): Promise<{ file: RecitationFileRow; timings: RecitationTimingRow[] }> {
  const data = await cachedJson<{ audio_files: QdcAudioFile[] }>(
    `audio-${reciterId}-${surahNumber}`,
    `${API}/audio/reciters/${reciterId}/audio_files?chapter=${surahNumber}&segments=true`,
  );

  const files = data.audio_files ?? [];
  if (files.length === 0) {
    throw new Error(`reciter ${reciterId} has no audio for surah ${surahNumber}`);
  }
  // Every reciter in the catalogue is gapless, so a surah is one file. More
  // than one would mean a per-ayah reciter slipped into the list, which this
  // importer's whole premise rules out — fail rather than import silence.
  if (files.length > 1) {
    throw new Error(
      `reciter ${reciterId} returned ${files.length} files for surah ${surahNumber}; ` +
        `expected a single gapless recording`,
    );
  }

  const audio = files[0]!;
  const file: RecitationFileRow = {
    reciter_id: reciterId,
    surah_number: surahNumber,
    audio_url: audio.audio_url,
    duration_ms: Math.round(audio.duration),
    file_size: audio.file_size != null ? Math.round(audio.file_size) : null,
    format: audio.format?.trim() || "mp3",
  };

  const timings: RecitationTimingRow[] = [];
  for (const timing of audio.verse_timings ?? []) {
    const [surahPart, ayahPart] = timing.verse_key.split(":");
    const surah = Number(surahPart);
    const ayah = Number(ayahPart);
    const verseId = resolveVerseId(surah, ayah);
    if (verseId === undefined) {
      throw new Error(`timing for unknown verse ${timing.verse_key} (reciter ${reciterId})`);
    }

    // Some surah files carry a leading basmala timing keyed to the surah's
    // first ayah in surahs where it is not itself an ayah. That is already
    // covered by the ayah's own span, and the endpoints below are what the
    // player seeks to, so a zero-or-negative span is dropped rather than
    // stored — the check constraint would reject it anyway.
    const start = Math.max(0, Math.round(timing.timestamp_from));
    const end = Math.round(timing.timestamp_to);
    if (end <= start) continue;

    const segments = (timing.segments ?? [])
      // Upstream occasionally emits shorter tuples for non-word tokens; only
      // full [position, from, to] triples describe something the UI can
      // highlight.
      .filter((s) => Array.isArray(s) && s.length >= 3)
      .map((s) => [Math.round(s[0]!), Math.round(s[1]!), Math.round(s[2]!)]);

    timings.push({
      reciter_id: reciterId,
      verse_id: verseId,
      start_ms: start,
      end_ms: end,
      segments: segments.length > 0 ? segments : null,
    });
  }

  if (timings.length === 0) {
    throw new Error(`reciter ${reciterId} has no verse timings for surah ${surahNumber}`);
  }

  return { file, timings };
}
