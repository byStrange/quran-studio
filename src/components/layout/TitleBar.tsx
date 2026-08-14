/**
 * Custom window chrome.
 *
 * Native decorations are disabled in `tauri.conf.json`, so everything the OS
 * used to draw has to be provided here: the title bar itself, the drag region,
 * the minimise/maximise/close controls, and the edge handles that make an
 * undecorated window resizable.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookOpen, Copy, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { appWindow, HAS_WINDOW_CHROME, IS_MOBILE_PLATFORM } from "@/lib/window";

/** Mirrors the OS maximise state so the restore icon stays truthful. */
function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    // Gated on the chrome rather than on the window: mobile has a window
    // object that answers, but asking it to maximise means nothing.
    if (!HAS_WINDOW_CHROME) return;
    const win = appWindow();
    if (!win) return;

    let alive = true;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win.isMaximized().then((value) => {
        if (alive) setMaximized(value);
      });
    };

    sync();
    // Covers the window manager maximising us behind our back (snap, keybind).
    void win.onResized(sync).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return maximized;
}

function ControlButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "grid size-8 place-items-center rounded-lg text-fg-subtle",
        "transition-colors duration-150",
        danger ? "hover:bg-danger hover:text-white" : "hover:bg-surface-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function WindowControls({ maximized }: { maximized: boolean }) {
  const minimize = useCallback(() => void appWindow()?.minimize(), []);
  const toggle = useCallback(() => void appWindow()?.toggleMaximize(), []);
  const close = useCallback(() => void appWindow()?.close(), []);

  return (
    <div className="pointer-events-auto flex items-center gap-0.5">
      <ControlButton label="Minimise" onClick={minimize}>
        <Minus className="size-3.5" aria-hidden />
      </ControlButton>
      <ControlButton label={maximized ? "Restore" : "Maximise"} onClick={toggle}>
        {maximized ? (
          <Copy className="size-3" aria-hidden />
        ) : (
          <Square className="size-3" aria-hidden />
        )}
      </ControlButton>
      <ControlButton label="Close" onClick={close} danger>
        <X className="size-3.5" aria-hidden />
      </ControlButton>
    </div>
  );
}

/**
 * Invisible grab strips along the window border. An undecorated window gets no
 * resize edges from the window manager, so we ask Tauri for them explicitly.
 */
const RESIZE_EDGES = [
  ["North", "top-0 inset-x-0 h-[3px] cursor-n-resize"],
  ["South", "bottom-0 inset-x-0 h-[3px] cursor-s-resize"],
  ["West", "left-0 inset-y-0 w-[3px] cursor-w-resize"],
  ["East", "right-0 inset-y-0 w-[3px] cursor-e-resize"],
  ["NorthWest", "top-0 left-0 size-3 cursor-nwse-resize"],
  ["NorthEast", "top-0 right-0 size-3 cursor-nesw-resize"],
  ["SouthWest", "bottom-0 left-0 size-3 cursor-nesw-resize"],
  ["SouthEast", "bottom-0 right-0 size-3 cursor-nwse-resize"],
] as const;

function ResizeHandles() {
  return (
    <>
      {RESIZE_EDGES.map(([direction, position]) => (
        <div
          key={direction}
          // Above modals (z-50) so a dialog never traps the window at one size.
          className={cn("fixed z-[60]", position)}
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            void appWindow()?.startResizeDragging(direction);
          }}
        />
      ))}
    </>
  );
}

function TitleBar({ maximized }: { maximized: boolean }) {
  return (
    // Hidden below `md`, where the viewport is a phone rather than a window
    // and AppShell supplies its own compact header instead.
    <header className="relative z-30 hidden h-10 shrink-0 items-center border-b border-border bg-bg md:flex">
      {/* A single full-width drag layer: Tauri only drags when the event target
          itself carries the attribute, so the visible row floats above it with
          pointer events off and re-enables them just for the controls. */}
      <div data-tauri-drag-region className="absolute inset-0" />

      <div className="pointer-events-none relative flex h-full w-full items-center gap-2.5 pl-3.5 pr-2">
        <div className="grid size-[1.125rem] place-items-center rounded-[0.3rem] bg-accent text-accent-fg">
          <BookOpen className="size-3" aria-hidden />
        </div>
        <span className="text-[0.8125rem] font-medium tracking-tight text-fg">Quran Studio</span>
        <span className="h-3 w-px bg-border" aria-hidden />
        <span className="text-[0.75rem] text-fg-subtle">Ruku by ruku</span>

        <div className="flex-1" />

        {HAS_WINDOW_CHROME ? <WindowControls maximized={maximized} /> : null}
      </div>
    </header>
  );
}

/** Wraps the whole app: custom title bar on top, everything else below it. */
export function WindowFrame({ children }: { children: ReactNode }) {
  const maximized = useMaximized();

  return (
    <div className="flex h-full flex-col bg-bg">
      {/* On a phone there is no window to title, drag or resize — the OS owns
          all of that, and the screen is too small to spend 40px saying so. */}
      {IS_MOBILE_PLATFORM ? null : <TitleBar maximized={maximized} />}
      <div className="relative min-h-0 flex-1">{children}</div>
      {HAS_WINDOW_CHROME && !maximized ? <ResizeHandles /> : null}
    </div>
  );
}
