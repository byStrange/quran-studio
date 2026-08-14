import { useEffect, useState } from "react";

/**
 * Most responsive work belongs in CSS. This exists for the cases where the two
 * layouts are not the same tree — the tafsir panel is a column beside the
 * reader on a desktop window and a modal over it on a phone, and rendering
 * both would duplicate its state and its queries.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    // Re-read on subscribe: the query may have changed since the first render.
    setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** The one breakpoint the layout actually branches on, matching Tailwind's md. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 768px)");
}
