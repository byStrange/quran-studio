import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

/**
 * Whether the app believes it has a network — the same signal TanStack Query
 * uses to pause queries and queue writes, so what the UI says and what the
 * data layer does can't disagree.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
}
