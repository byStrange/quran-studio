/**
 * Access to the OS window.
 *
 * Native decorations are disabled, so the title bar drives the window itself —
 * and focus mode needs fullscreen. Under a plain `vite dev` browser tab the
 * Tauri API is absent, so each helper falls back to the closest web equivalent
 * or does nothing at all.
 */
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";

/** False under a plain `vite dev` browser tab, where the window API is absent. */
export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Android and iOS run the same webview, but there is no OS window to minimise,
 * maximise or resize. The Tauri window API still answers there, so this cannot
 * be inferred from `IS_TAURI`, and it is deliberately not a viewport check —
 * a tablet is wide enough for the desktop layout and still has no window
 * chrome.
 */
export const IS_MOBILE_PLATFORM =
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Whether this process draws its own title bar, controls and resize edges. */
export const HAS_WINDOW_CHROME = IS_TAURI && !IS_MOBILE_PLATFORM;

let cached: Window | null = null;

export function appWindow(): Window | null {
  if (!IS_TAURI) return null;
  cached ??= getCurrentWindow();
  return cached;
}

export async function setFullscreen(on: boolean): Promise<void> {
  const win = appWindow();
  if (win) {
    await win.setFullscreen(on);
    return;
  }

  // Browser preview. The request can be refused when it isn't tied to a user
  // gesture; the overlay is still perfectly usable inside the normal viewport.
  try {
    if (on) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* ignored */
  }
}
