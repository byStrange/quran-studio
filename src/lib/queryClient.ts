import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { registerProgressMutations } from "@/hooks/useProgress";
import { kvDelete, kvGet, kvSet } from "@/lib/offline/db";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Quran content is immutable once seeded, so refetching it is pure waste.
      staleTime: 5 * 60 * 1000,
      // A day, so what was last seen is still there to persist and restore
      // when the app next opens without a network.
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Before anything can mutate or be restored: a queued write resumed after a
// restart finds its function here, by key.
registerProgressMutations(queryClient);

const CACHE_KEY = "query-cache";

/**
 * The query cache kept in IndexedDB.
 *
 * IndexedDB rather than localStorage because the cached values are Sets and
 * Maps (memorized ayahs, word statuses) — structured clone keeps them, where
 * JSON would turn every one into `{}`. It also keeps queued progress marks,
 * so a mark made offline survives closing the app before the network returns.
 */
let pending: PersistedClient | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export const persister: Persister = {
  // Called on every cache event; written at most once a second, latest wins.
  persistClient: (client: PersistedClient) => {
    pending = client;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      const latest = pending;
      pending = null;
      if (latest) void kvSet(CACHE_KEY, latest).catch(() => {});
    }, 1000);
  },
  restoreClient: () => kvGet<PersistedClient>(CACHE_KEY).catch(() => undefined),
  removeClient: () => {
    pending = null;
    return kvDelete(CACHE_KEY).catch(() => {});
  },
};

export const persistOptions = {
  persister,
  // Long, because this snapshot also carries marks queued offline, and a
  // trip away from a network can last longer than a week. Stale queries in
  // it are harmless — they are refetched on use — and gcTime keeps the
  // snapshot from growing with ones no longer used.
  maxAge: 365 * 24 * 60 * 60 * 1000,
  // Bump when a persisted query's data changes shape. Not tied to the app
  // version: an update must not throw away marks still queued from offline.
  buster: "1",
  dehydrateOptions: {
    shouldDehydrateQuery: (query: Parameters<typeof defaultShouldDehydrateQuery>[0]) =>
      defaultShouldDehydrateQuery(query) && query.meta?.persist !== false,
  },
};
