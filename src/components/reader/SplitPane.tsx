/**
 * Two panes with a draggable divider — on a window wide enough to hold both.
 *
 * The split is stored locally rather than in the profile — it's a per-window
 * layout choice, not a study preference. Both readers share it, so dragging
 * the divider in one does not surprise the other by moving it back.
 *
 * On a phone there is no width to divide. The tafsir becomes a sheet over the
 * page instead, because a commentary that permanently occupies a third of a
 * small screen costs more than it gives: the point of the screen is the Quran.
 */
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useIsDesktop } from "@/hooks/useMediaQuery";

const SPLIT_STORAGE_KEY = "qs.readerSplit";

export function SplitPane({
  reader,
  tafsir,
  tafsirFirst,
  tafsirOpen,
  onTafsirOpenChange,
}: {
  reader: React.ReactNode;
  tafsir: React.ReactNode;
  tafsirFirst: boolean;
  /** Sheet visibility below md. Ignored when the panes sit side by side. */
  tafsirOpen: boolean;
  onTafsirOpenChange: (open: boolean) => void;
}) {
  const isDesktop = useIsDesktop();
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

  if (!isDesktop) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">{reader}</div>

        <Dialog.Root open={tafsirOpen} onOpenChange={onTafsirOpenChange}>
          <Dialog.Portal>
            <Dialog.Content
              className="fixed inset-0 z-50 flex flex-col bg-bg animate-fade-in"
              // The panel carries its own heading; this only names the dialog.
              aria-describedby={undefined}
            >
              <Dialog.Title className="sr-only">Tafsir</Dialog.Title>

              <div className="min-h-0 flex-1 pt-[env(safe-area-inset-top)]">{tafsir}</div>

              {/* Bottom-right rather than in a title bar: it is the corner a
                  thumb reaches, and the panel header is already occupied by
                  the edition picker. */}
              <Dialog.Close
                className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 grid size-12 place-items-center rounded-full border border-border bg-surface-2 text-fg shadow-lg active:bg-surface"
                aria-label="Close tafsir"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    );
  }

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
      className="min-h-0 min-w-0 shrink-0 border-border bg-surface/40"
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
          <div className="min-h-0 min-w-0 flex-1">{reader}</div>
        </>
      ) : (
        <>
          <div className="min-h-0 min-w-0 flex-1">{reader}</div>
          {divider}
          {tafsirPane}
        </>
      )}
    </div>
  );
}
