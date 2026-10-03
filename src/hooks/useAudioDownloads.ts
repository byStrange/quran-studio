import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/ai";
import { removeSurahTimings, saveSurahTimings } from "@/lib/offline/packs";
import { formatBytes } from "@/lib/utils";

interface LocalFile {
  path: string;
  bytes: number;
}

interface ProgressEvent {
  id: string;
  received: number;
  total: number | null;
}

/** One downloaded surah, as the backend lists it. */
export interface DownloadEntry {
  reciter_id: number;
  surah_number: number;
  bytes: number;
}

export interface SurahDownload {
  state: "none" | "downloading" | "downloaded";
  /** False in a plain browser, where there is no filesystem to download to. */
  available: boolean;
  /**
   * Whether the check for a local copy has answered. Until it has, the player
   * should wait rather than start streaming a file that may be on disk.
   */
  ready: boolean;
  /** 0–1 while downloading. */
  progress: number;
  /** Human-readable size, from the stored metadata or the file on disk. */
  sizeLabel: string;
  /** An `asset:` URL for the local copy, or null when there isn't one. */
  localSrc: string | null;
  /** Why the last download of this surah failed, until dismissed or retried. */
  error: string | null;
  start: () => void;
  cancel: () => void;
  remove: () => void;
  clearError: () => void;
}

// --- downloads in flight -----------------------------------------------------
//
// Kept at module level, keyed by `reciter:surah`, rather than in the hook. A
// download outlives the reader that started it — leave the page, switch
// surah, come back — and per-instance state forgot it was running, offered to
// start it again, and pointed cancel at whatever surah was on screen now.

interface Active {
  progress: number;
}

const active = new Map<string, Active>();
const errors = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let progressListening = false;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ensureProgressListener();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Progress arrives as a backend event rather than a polled query: the
 * download runs in Rust and is the only thing that knows how far it has got.
 * One listener for the app's lifetime serves every download.
 */
function ensureProgressListener() {
  if (progressListening || !isTauri()) return;
  progressListening = true;
  void listen<ProgressEvent>("recitation-download-progress", (event) => {
    const entry = active.get(event.payload.id);
    if (!entry) return;
    const { received, total } = event.payload;
    entry.progress = total && total > 0 ? Math.min(received / total, 1) : 0;
    emit();
  }).catch(() => {
    progressListening = false;
  });
}

const downloadKey = (reciterId: number, surahNumber: number) => `${reciterId}:${surahNumber}`;

function invalidate(queryClient: QueryClient, reciterId: number, surahNumber: number) {
  void queryClient.invalidateQueries({ queryKey: ["recitation-local", reciterId, surahNumber] });
  void queryClient.invalidateQueries({ queryKey: ["recitation-downloads"] });
}

function describe(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}

async function startDownload(
  queryClient: QueryClient,
  reciterId: number,
  surahNumber: number,
  url: string,
) {
  const id = downloadKey(reciterId, surahNumber);
  if (active.has(id)) return;
  active.set(id, { progress: 0 });
  errors.delete(id);
  emit();
  try {
    await invoke<LocalFile>("recitation_download", { id, url, reciterId, surahNumber });
    // The audio alone plays offline but cannot follow along: the ayah timings
    // come from the server too, so they are saved with it.
    try {
      await saveSurahTimings(reciterId, surahNumber);
    } catch {
      // The file is good; following along will simply need a network until a
      // later download fills the timings in.
    }
  } catch (error) {
    const message = describe(error);
    // Cancelling is something the reader did, not something that went wrong.
    if (!/cancelled/i.test(message)) errors.set(id, message);
  } finally {
    active.delete(id);
    emit();
    invalidate(queryClient, reciterId, surahNumber);
  }
}

/**
 * The local copy of one surah's recitation, and the controls to manage it.
 *
 * Downloading is opt-in per surah rather than a bulk "download everything":
 * the whole Quran in one recitation is several gigabytes, and the thing a
 * reader actually wants offline is the surah they are working through.
 */
export function useSurahDownload({
  reciterId,
  surahNumber,
  url,
  fileSize,
}: {
  reciterId: number | null;
  surahNumber: number | null;
  url: string | null;
  fileSize: number | null;
}): SurahDownload {
  const queryClient = useQueryClient();
  // Looking for a local copy needs only the reciter and surah. It must not
  // wait for the stream URL: offline that never arrives, and the file on disk
  // is exactly what offline needs.
  const available = isTauri() && reciterId !== null && surahNumber !== null;
  const id = available ? downloadKey(reciterId, surahNumber) : null;

  useSyncExternalStore(subscribe, () => version);
  const entry = id ? active.get(id) : undefined;
  const error = id ? (errors.get(id) ?? null) : null;

  const local = useQuery({
    queryKey: ["recitation-local", reciterId, surahNumber],
    enabled: available,
    staleTime: Infinity,
    // A file on disk is there whether or not there is a network.
    networkMode: "always",
    meta: { persist: false },
    queryFn: async (): Promise<LocalFile | null> =>
      invoke<LocalFile | null>("recitation_local_file", { reciterId, surahNumber }),
  });

  const start = useCallback(() => {
    if (reciterId === null || surahNumber === null || !url || !isTauri()) return;
    void startDownload(queryClient, reciterId, surahNumber, url);
  }, [queryClient, reciterId, surahNumber, url]);

  const cancel = useCallback(() => {
    if (!id) return;
    void invoke("recitation_cancel_download", { id });
  }, [id]);

  const remove = useCallback(() => {
    if (reciterId === null || surahNumber === null || !isTauri()) return;
    void (async () => {
      try {
        await invoke("recitation_remove_download", { reciterId, surahNumber });
        await removeSurahTimings(reciterId, surahNumber).catch(() => {});
      } catch (err) {
        errors.set(downloadKey(reciterId, surahNumber), describe(err));
        emit();
      } finally {
        invalidate(queryClient, reciterId, surahNumber);
      }
    })();
  }, [queryClient, reciterId, surahNumber]);

  const clearError = useCallback(() => {
    if (!id) return;
    errors.delete(id);
    emit();
  }, [id]);

  const localSrc = useMemo(
    () => (local.data ? convertFileSrc(local.data.path) : null),
    [local.data],
  );

  const bytes = local.data?.bytes ?? fileSize ?? null;

  return {
    state: entry ? "downloading" : local.data ? "downloaded" : "none",
    // Downloading needs somewhere to download from as well.
    available: available && url !== null,
    ready: !available || local.isFetched,
    progress: entry?.progress ?? 0,
    sizeLabel: bytes !== null ? formatBytes(bytes) : "",
    localSrc,
    error,
    start,
    cancel,
    remove,
    clearError,
  };
}

/** Every downloaded surah, with its size on disk. */
export function useDownloadedSurahs() {
  return useQuery({
    queryKey: ["recitation-downloads"],
    enabled: isTauri(),
    staleTime: 60_000,
    networkMode: "always",
    meta: { persist: false },
    queryFn: async (): Promise<DownloadEntry[]> => invoke<DownloadEntry[]>("recitation_downloads"),
  });
}

/** Removes one downloaded surah, from Settings where there is no reader hook for it. */
export async function removeDownloadedSurah(
  queryClient: QueryClient,
  reciterId: number,
  surahNumber: number,
) {
  try {
    await invoke("recitation_remove_download", { reciterId, surahNumber });
    await removeSurahTimings(reciterId, surahNumber).catch(() => {});
  } finally {
    invalidate(queryClient, reciterId, surahNumber);
  }
}
