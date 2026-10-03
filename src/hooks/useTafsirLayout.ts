import { useCallback, useSyncExternalStore } from "react";

/**
 * How the desktop reader divides its width between the Quran and the tafsir.
 *
 * "split" is the two columns side by side; "hidden" folds the tafsir away to
 * a rail at the edge, for reading the Quran alone; "full" gives the tafsir the
 * whole width, for sitting down with a long commentary.
 *
 * Kept in a small store rather than component state because two places own a
 * piece of it — the reader's header has the toggle, the split pane does the
 * drawing — and stored locally rather than in the profile because, like the
 * split width, it is a per-window layout choice, not a study preference.
 */
export type TafsirLayout = "split" | "hidden" | "full";

const STORAGE_KEY = "qs.readerTafsirLayout";

function isLayout(value: unknown): value is TafsirLayout {
  return value === "split" || value === "hidden" || value === "full";
}

function readStored(): TafsirLayout {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLayout(stored) ? stored : "split";
  } catch {
    return "split";
  }
}

let current: TafsirLayout = readStored();
const listeners = new Set<() => void>();

function setLayout(next: TafsirLayout) {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode or a full quota: the layout still applies for this session.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTafsirLayout() {
  const layout = useSyncExternalStore(subscribe, () => current);
  /** Hidden ↔ split. From fullscreen it goes back to the split. */
  const toggleOpen = useCallback(() => setLayout(current === "split" ? "hidden" : "split"), []);
  /** Full ↔ split. */
  const toggleFull = useCallback(() => setLayout(current === "full" ? "split" : "full"), []);
  return { layout, setLayout, toggleOpen, toggleFull };
}
