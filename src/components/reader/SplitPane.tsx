/**
 * Two panes with a draggable divider.
 *
 * The split is stored locally rather than in the profile — it's a per-window
 * layout choice, not a study preference. Both readers share it, so dragging
 * the divider in one does not surprise the other by moving it back.
 */
import { useEffect, useRef, useState } from "react";

const SPLIT_STORAGE_KEY = "qs.readerSplit";

export function SplitPane({
  reader,
  tafsir,
  tafsirFirst,
}: {
  reader: React.ReactNode;
  tafsir: React.ReactNode;
  tafsirFirst: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tafsirWidth, setTafsirWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 20 && stored <= 60 ? stored : 38;
  });
  const dragging = useRef(false);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fromLeft = ((event.clientX - rect.left) / rect.width) * 100;
      const next = tafsirFirst ? fromLeft : 100 - fromLeft;
      setTafsirWidth(Math.min(60, Math.max(20, next)));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      setTafsirWidth((width) => {
        localStorage.setItem(SPLIT_STORAGE_KEY, String(width));
        return width;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [tafsirFirst]);

  const divider = (
    <div
      role="separator"
      aria-orientation="vertical"
      onMouseDown={() => {
        dragging.current = true;
        document.body.style.cursor = "col-resize";
      }}
      className="group relative w-px shrink-0 cursor-col-resize bg-border"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 transition-colors group-hover:bg-accent/20" />
    </div>
  );

  const tafsirPane = (
    <div
      className="min-w-0 shrink-0 border-border bg-surface/40"
      style={{ width: `${tafsirWidth}%` }}
    >
      {tafsir}
    </div>
  );

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      {tafsirFirst ? (
        <>
          {tafsirPane}
          {divider}
          <div className="min-w-0 flex-1">{reader}</div>
        </>
      ) : (
        <>
          <div className="min-w-0 flex-1">{reader}</div>
          {divider}
          {tafsirPane}
        </>
      )}
    </div>
  );
}
