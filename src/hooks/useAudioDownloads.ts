import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@/lib/ai";
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

export interface SurahDownload {
  state: "none" | "downloading" | "downloaded";
  /** False in a plain browser, where there is no filesystem to download to. */
  available: boolean;
  /** 0–1 while downloading. */
  progress: number;
  /** Human-readable size, from the stored metadata or the file on disk. */
  sizeLabel: string;
  /** An `asset:` URL for the local copy, or null when there isn't one. */
  localSrc: string | null;
  start: () => void;
  cancel: () => void;
  remove: () => void;
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
  const available = isTauri() && reciterId !== null && surahNumber !== null && url !== null;
  const downloadId = `${reciterId}:${surahNumber}`;

  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const activeId = useRef<string | null>(null);

  const local = useQuery({
    queryKey: ["recitation-local", reciterId, surahNumber],
    enabled: available,
    staleTime: Infinity,
    queryFn: async (): Promise<LocalFile | null> =>
      invoke<LocalFile | null>("recitation_local_file", { reciterId, surahNumber }),
  });

  // Progress arrives as a backend event rather than a polled query: the
  // download runs in Rust and is the only thing that knows how far it has got.
  useEffect(() => {
    if (!isTauri()) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;

    void listen<ProgressEvent>("recitation-download-progress", (event) => {
      if (event.payload.id !== activeId.current) return;
      const { received, total } = event.payload;
      setProgress(total && total > 0 ? Math.min(received / total, 1) : 0);
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else dispose = unlisten;
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const start = useMutation({
    mutationFn: async () => {
      if (!available) return null;
      activeId.current = downloadId;
      setDownloading(true);
      setProgress(0);
      return invoke<LocalFile>("recitation_download", {
        id: downloadId,
        url,
        reciterId,
        surahNumber,
      });
    },
    onSettled: () => {
      activeId.current = null;
      setDownloading(false);
      setProgress(0);
      queryClient.invalidateQueries({ queryKey: ["recitation-local", reciterId, surahNumber] });
      queryClient.invalidateQueries({ queryKey: ["recitation-downloads"] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      if (!available) return;
      await invoke("recitation_remove_download", { reciterId, surahNumber });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["recitation-local", reciterId, surahNumber] });
      queryClient.invalidateQueries({ queryKey: ["recitation-downloads"] });
    },
  });

  const cancel = useCallback(() => {
    if (!isTauri()) return;
    void invoke("recitation_cancel_download", { id: downloadId });
  }, [downloadId]);

  const localSrc = useMemo(
    () => (local.data ? convertFileSrc(local.data.path) : null),
    [local.data],
  );

  const bytes = local.data?.bytes ?? fileSize ?? null;

  return {
    state: downloading ? "downloading" : local.data ? "downloaded" : "none",
    available,
    progress,
    sizeLabel: bytes !== null ? formatBytes(bytes) : "",
    localSrc,
    start: () => start.mutate(),
    cancel,
    remove: () => remove.mutate(),
  };
}

/** Every downloaded surah, as `reciterId:surahNumber` keys. */
export function useDownloadedSurahs() {
  return useQuery({
    queryKey: ["recitation-downloads"],
    enabled: isTauri(),
    staleTime: 60_000,
    queryFn: async (): Promise<Set<string>> => {
      const rows = await invoke<Array<[number, number]>>("recitation_downloads");
      return new Set(rows.map(([reciter, surah]) => `${reciter}:${surah}`));
    },
  });
}
