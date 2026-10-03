import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  downloadQuranPack,
  downloadTafsirPack,
  getManifest,
  isCancelled,
  removePack,
  subscribeManifest,
  type PackId,
  type PackInfo,
  type PackProgress,
} from "@/lib/offline/packs";

/**
 * Pack downloads in flight, at module level so leaving Settings mid-download
 * neither stops it nor loses track of it.
 */
interface Running {
  progress: PackProgress;
  controller: AbortController;
}

const running = new Map<PackId, Running>();
const failures = new Map<PackId, string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribeManifest = subscribeManifest(() => {
    version += 1;
    listener();
  });
  return () => {
    listeners.delete(listener);
    unsubscribeManifest();
  };
}

export interface PackState {
  info: PackInfo | null;
  /** 0–1 while downloading, null otherwise. */
  progress: number | null;
  error: string | null;
}

export function useOfflinePacks() {
  const queryClient = useQueryClient();
  useSyncExternalStore(subscribe, () => version);
  const manifest = getManifest();

  const state = useCallback(
    (id: PackId): PackState => {
      const run = running.get(id);
      return {
        info: manifest[id] ?? null,
        progress: run ? (run.progress.total ? run.progress.done / run.progress.total : 0) : null,
        error: failures.get(id) ?? null,
      };
    },
    [manifest],
  );

  const download = useCallback(
    (id: PackId) => {
      if (running.has(id)) return;
      const controller = new AbortController();
      const run: Running = { progress: { done: 0, total: 0 }, controller };
      running.set(id, run);
      failures.delete(id);
      emit();
      const onProgress = (progress: PackProgress) => {
        run.progress = progress;
        emit();
      };
      const task =
        id === "quran"
          ? downloadQuranPack(onProgress, controller.signal)
          : downloadTafsirPack(id.slice("tafsir:".length), onProgress, controller.signal);
      void task
        .then(() => {
          // Content queries cached from the network are just as good, but
          // ones that failed offline should try again against the pack.
          void queryClient.invalidateQueries({
            predicate: (query) => query.state.status === "error",
          });
        })
        .catch((error: unknown) => {
          if (!isCancelled(error)) {
            failures.set(id, error instanceof Error ? error.message : String(error));
          }
        })
        .finally(() => {
          running.delete(id);
          emit();
        });
    },
    [queryClient],
  );

  const cancel = useCallback((id: PackId) => {
    running.get(id)?.controller.abort();
  }, []);

  const remove = useCallback(
    async (id: PackId) => {
      if (running.has(id)) return;
      try {
        await removePack(id);
        failures.delete(id);
      } catch (error) {
        failures.set(id, error instanceof Error ? error.message : String(error));
      }
      emit();
      // Whatever was read from the pack should come from the network now.
      void queryClient.invalidateQueries({ predicate: (query) => query.meta?.persist === false });
    },
    [queryClient],
  );

  return { state, download, cancel, remove };
}
