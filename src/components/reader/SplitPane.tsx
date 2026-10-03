/**
 * Two panes with a draggable divider — on a window wide enough to hold both.
 *
 * The split is stored locally rather than in the profile — it's a per-window
 * layout choice, not a study preference. Both readers share it, so dragging
 * the divider in one does not surprise the other by moving it back.
 *
 * The tafsir can also be folded away to a rail, or given the whole width — by
 * the buttons in its header, or by dragging the divider into either edge,
 * where it snaps. See `useTafsirLayout`.
 *
 * On a phone there is no width to divide. The tafsir becomes a sheet over the
 * page instead, because a commentary that permanently occupies a third of a
 * small screen costs more than it gives: the point of the screen is the Quran.
 */
import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import {
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/primitives";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useTafsirLayout } from "@/hooks/useTafsirLayout";
import { useT } from "@/providers/I18nProvider";
import { cn } from "@/lib/utils";

const SPLIT_STORAGE_KEY = "qs.readerSplit";

/** The range a split can rest in, as the tafsir's share of the width. */
const MIN_SPLIT = 20;
const MAX_SPLIT = 75;
/**
 * Released this close to an edge, the drag stops being a resize and becomes
 * "close the tafsir" or "give it everything". The divider follows the pointer
 * all the way into these zones, so the snap is visible before it happens.
 */
const SNAP_HIDE_BELOW = 12;
const SNAP_FULL_ABOVE = 88;

function readStoredSplit(): number {
  try {
    const stored = Number(localStorage.getItem(SPLIT_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_SPLIT && stored <= MAX_SPLIT ? stored : 38;
  } catch {
    return 38;
  }
}

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
  const t = useT();
  const isDesktop = useIsDesktop();
  const { layout, setLayout } = useTafsirLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  /** The resting split, kept while the tafsir is hidden or full so it comes back where it was. */
  const [tafsirWidth, setTafsirWidth] = useState<number>(readStoredSplit);
  /** The width under the pointer mid-drag, unclamped into the snap zones; null when not dragging. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragWidthRef = useRef<number | null>(null);

  const dragActive = dragWidth !== null;

  useEffect(() => {
    if (!dragActive) return;
    const onMove = (event: PointerEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fromLeft = ((event.clientX - rect.left) / rect.width) * 100;
      const next = Math.min(100, Math.max(0, tafsirFirst ? fromLeft : 100 - fromLeft));
      dragWidthRef.current = next;
      setDragWidth(next);
    };
    const onUp = () => {
      const released = dragWidthRef.current;
      dragWidthRef.current = null;
      setDragWidth(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (released === null) return;
      if (released < SNAP_HIDE_BELOW) {
        setLayout("hidden");
      } else if (released > SNAP_FULL_ABOVE) {
        setLayout("full");
      } else {
        const width = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, released));
        setTafsirWidth(width);
        try {
          localStorage.setItem(SPLIT_STORAGE_KEY, String(width));
        } catch {
          // The split still holds for this session.
        }
        setLayout("split");
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragActive, tafsirFirst, setLayout]);

  /** Starts a drag from wherever the divider currently sits. */
  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = layout === "hidden" ? 0 : layout === "full" ? 100 : tafsirWidth;
    dragWidthRef.current = from;
    setDragWidth(from);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

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
              <Dialog.Title className="sr-only">{t("tafsir.title")}</Dialog.Title>

              <div className="min-h-0 flex-1 pt-[env(safe-area-inset-top)]">{tafsir}</div>

              {/* Bottom-right rather than in a title bar: it is the corner a
                  thumb reaches, and the panel header is already occupied by
                  the edition picker. */}
              <Dialog.Close
                className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 grid size-12 place-items-center rounded-full border border-border bg-surface-2 text-fg shadow-lg active:bg-surface"
                aria-label={t("reader.closeTafsir")}
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
    );
  }

  const dragging = dragActive;
  /** The tafsir's share of the width as drawn right now. */
  const shown = dragWidth !== null ? dragWidth : layout === "hidden" ? 0 : layout === "full" ? 100 : tafsirWidth;
  const snapZone =
    dragWidth !== null
    ? dragWidth < SNAP_HIDE_BELOW
      ? "hide"
      : dragWidth > SNAP_FULL_ABOVE
        ? "full"
        : null
    : null;

  // Hidden, the tafsir folds to a rail at its edge: one click opens it again,
  // and it is still a handle, so dragging out of it works like the divider.
  const rail = layout === "hidden" && !dragging;

  const divider = rail ? (
    <div
      onPointerDown={startDrag}
      className={cn(
        "group flex w-9 shrink-0 cursor-col-resize flex-col items-center gap-2 bg-surface/40 pt-3",
        tafsirFirst ? "border-r border-border" : "border-l border-border",
      )}
    >
      <button
        // A click on the button opens; the drag starts on the rail around it.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setLayout("split")}
        aria-label={t("reader.showTafsir")}
        title={t("reader.showTafsir")}
        className="grid size-7 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <BookOpen className="size-4" aria-hidden />
      </button>
      <span
        className="select-none text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle [writing-mode:vertical-rl]"
        aria-hidden
      >
        {t("tafsir.title")}
      </span>
    </div>
  ) : (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(shown)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={startDrag}
      onDoubleClick={() => setLayout(layout === "split" ? "full" : "split")}
      className={cn(
        "group relative w-px shrink-0 cursor-col-resize touch-none",
        snapZone ? "bg-accent" : "bg-border",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 -left-1.5 -right-1.5 transition-colors",
          dragging ? "bg-accent/25" : "group-hover:bg-accent/20",
        )}
      />
    </div>
  );

  const tafsirPane = (
    <div
      className={cn(
        "min-h-0 min-w-0 shrink-0 overflow-hidden border-border bg-surface/40",
        // A snap about to happen dims the side that is about to go.
        snapZone === "hide" && "opacity-50",
        rail && "hidden",
        // Full is the tafsir alone. The divider stays as a handle on the edge
        // the reader went to, so dragging it back out restores the split.
        layout === "full" && !dragging && "flex-1",
      )}
      style={layout === "full" && !dragging ? undefined : { width: `${shown}%` }}
    >
      {tafsir}
    </div>
  );

  const readerPane = (
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1",
        snapZone === "full" && "opacity-50",
        layout === "full" && !dragging && "hidden",
      )}
    >
      {reader}
    </div>
  );

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1">
      {tafsirFirst ? (
        <>
          {tafsirPane}
          {divider}
          {readerPane}
        </>
      ) : (
        <>
          {readerPane}
          {divider}
          {tafsirPane}
        </>
      )}
    </div>
  );
}

/**
 * The header's switch for the tafsir column: folds it away or brings it back.
 * From fullscreen it returns to the split, which is the state the icon shows.
 */
export function TafsirToggleButton({ tafsirFirst }: { tafsirFirst: boolean }) {
  const t = useT();
  const { layout, toggleOpen } = useTafsirLayout();
  const open = layout !== "hidden";
  const label = open ? t("reader.hideTafsir") : t("reader.showTafsir");
  const Icon = tafsirFirst
    ? open
      ? PanelLeftClose
      : PanelLeftOpen
    : open
      ? PanelRightClose
      : PanelRightOpen;
  return (
    <Tooltip content={label}>
      <Button
        size="icon"
        variant={layout === "hidden" ? "ghost" : "outline"}
        aria-label={label}
        aria-pressed={open}
        onClick={toggleOpen}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    </Tooltip>
  );
}
