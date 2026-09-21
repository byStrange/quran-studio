import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Dialog } from "radix-ui";
import {
  BookOpen,
  BookMarked,
  Flame,
  GraduationCap,
  Info,
  LayoutDashboard,
  Library,
  Menu,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { useT, type TFunction } from "@/providers/I18nProvider";
import { useStreakStatus } from "@/hooks/useProgress";
import { TafsirNudge } from "./TafsirNudge";
import { Tooltip } from "@/components/ui/primitives";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

// Built per render rather than at module scope: the label is a translation,
// and a module constant would freeze whichever language happened to load first.
const primaryNav = (t: TFunction): NavItem[] => [
  { to: "/", label: t("nav.dashboard"), icon: <LayoutDashboard className="size-[1.125rem]" /> },
  { to: "/browse", label: t("nav.read"), icon: <BookOpen className="size-[1.125rem]" /> },
  { to: "/vocabulary", label: t("nav.vocabulary"), icon: <Library className="size-[1.125rem]" /> },
  { to: "/quiz", label: t("nav.quiz"), icon: <GraduationCap className="size-[1.125rem]" /> },
  {
    to: "/memorization",
    label: t("nav.memorization"),
    icon: <BookMarked className="size-[1.125rem]" />,
  },
];

const secondaryNav = (t: TFunction): NavItem[] => [
  { to: "/settings", label: t("nav.settings"), icon: <SettingsIcon className="size-[1.125rem]" /> },
  { to: "/about", label: t("nav.about"), icon: <Info className="size-[1.125rem]" /> },
];

/** The reader lives under /read/:n but belongs to the "Read" nav entry. */
function useIsActive(to: string): boolean {
  const location = useLocation();
  return to === "/browse" && location.pathname.startsWith("/read/");
}

// --- desktop -----------------------------------------------------------------

/**
 * One destination in the rail.
 *
 * Icon only, with the label in a tooltip. Five destinations, each with a shape
 * of its own, is a set worth learning once — and a labelled column down the
 * side of a window is the one thing that makes a desktop app read as a web
 * page embedded in a frame.
 */
function RailItem({ item }: { item: NavItem }) {
  const secondaryActive = useIsActive(item.to);

  return (
    <Tooltip content={item.label} side="right">
      <NavLink
        to={item.to}
        end={item.to === "/"}
        className={({ isActive }) =>
          cn(
            "relative grid size-10 place-items-center rounded-xl transition-colors",
            isActive || secondaryActive
              ? "bg-accent-soft text-accent-soft-fg"
              : "text-fg-subtle hover:bg-surface-2 hover:text-fg",
          )
        }
      >
        {({ isActive }) => (
          <>
            {/* The rail is narrow enough that the tint alone can be missed at
                a glance, so the active row also marks the window edge. */}
            <span
              className={cn(
                "absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-accent",
                "transition-opacity",
                isActive || secondaryActive ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
            {item.icon}
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}

function StreakRail() {
  const t = useT();
  const { streak, inGrace } = useStreakStatus();
  const current = streak?.current_streak ?? 0;

  return (
    <Tooltip
      side="right"
      content={
        inGrace
          ? t("streak.paused")
          : current > 0
            ? t("streak.keepGoing", { count: current })
            : t("streak.start")
      }
    >
      <div
        className={cn(
          "flex w-10 flex-col items-center gap-0.5 rounded-xl py-1.5",
          inGrace ? "bg-gold-soft/60" : current > 0 ? "bg-accent-soft/60" : "bg-surface-2",
        )}
      >
        <Flame
          className={cn(
            "size-4",
            inGrace ? "text-warning" : current > 0 ? "text-accent" : "text-fg-subtle",
          )}
          aria-hidden
        />
        <span className="text-[0.6875rem] font-semibold tabular-nums leading-none text-fg">
          {current}
        </span>
      </div>
    </Tooltip>
  );
}

function DesktopRail() {
  const t = useT();

  return (
    <aside className="hidden w-14 shrink-0 flex-col items-center border-r border-border bg-surface/50 py-3 md:flex">
      <nav className="flex flex-col items-center gap-1">
        {primaryNav(t).map((item) => (
          <RailItem key={item.to} item={item} />
        ))}
      </nav>

      <div className="flex-1" />

      <div className="flex w-full flex-col items-center gap-1 border-t border-border pt-3">
        {secondaryNav(t).map((item) => (
          <RailItem key={item.to} item={item} />
        ))}
        <div className="pt-1">
          <StreakRail />
        </div>
      </div>
    </aside>
  );
}

// --- phone -------------------------------------------------------------------

/** One destination in the full-screen menu: a real row, at a thumb's scale. */
function MenuRow({ item, index }: { item: NavItem; index: number }) {
  const secondaryActive = useIsActive(item.to);

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      style={{ "--i": index } as React.CSSProperties}
      className={({ isActive }) =>
        cn(
          "menu-row flex items-center gap-4 rounded-2xl px-4 py-3.5 text-[1.0625rem]",
          "transition-colors active:bg-surface-2",
          isActive || secondaryActive ? "bg-surface-2 font-medium text-fg" : "text-fg-muted",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-xl",
              isActive || secondaryActive
                ? "bg-accent text-accent-fg"
                : "bg-surface-2 text-fg-subtle",
            )}
          >
            {item.icon}
          </span>
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function StreakPanel() {
  const t = useT();
  const { streak, inGrace } = useStreakStatus();
  const current = streak?.current_streak ?? 0;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3.5",
        inGrace
          ? "border-warning/40 bg-gold-soft/60"
          : current > 0
            ? "border-accent/30 bg-accent-soft/50"
            : "border-border bg-surface-2",
      )}
    >
      <Flame
        className={cn(
          "size-5 shrink-0",
          inGrace ? "text-warning" : current > 0 ? "text-accent" : "text-fg-subtle",
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-[0.9375rem] font-semibold tabular-nums text-fg">
          {current} {inGrace ? t("streak.inGrace") : t("streak.unitDay", { count: current })}
        </div>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-fg-subtle">
          {inGrace
            ? t("streak.paused")
            : current > 0
              ? t("streak.keepGoing", { count: current })
              : t("streak.start")}
        </p>
      </div>
    </div>
  );
}

/**
 * Navigation on a phone.
 *
 * A 240px column pinned to the left of a 390px screen is a desktop sidebar
 * that has been made to fit rather than a phone's navigation: it leaves a
 * useless strip of the page showing beside it, and its rows are sized for a
 * pointer. This takes the whole screen for the moment it is open, gives every
 * destination a thumb-sized row, and gets out of the way again.
 */
function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  // Where a horizontal drag began, so a swipe back towards the left edge can
  // dismiss the menu the same way the swipe from that edge opened it.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-bg",
            "data-[state=open]:animate-[var(--animate-menu-in)]",
            "data-[state=closed]:animate-[var(--animate-menu-out)]",
          )}
          aria-describedby={undefined}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            swipeStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
          }}
          onTouchEnd={(event) => {
            const start = swipeStart.current;
            const touch = event.changedTouches[0];
            swipeStart.current = null;
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            // Left, decisively, and more sideways than down — so a scroll or a
            // tap never closes the menu by accident.
            if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) onOpenChange(false);
          }}
        >
          <div className="flex items-center gap-2.5 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-6">
            <div className="grid size-7 place-items-center rounded-lg bg-accent text-accent-fg">
              <BookOpen className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <Dialog.Title className="text-[0.9375rem] font-semibold tracking-tight text-fg">
                {t("app.name")}
              </Dialog.Title>
              <p className="text-[0.75rem] text-fg-subtle">{t("app.tagline")}</p>
            </div>
            <span className="flex-1" />
            <Dialog.Close
              aria-label={t("common.close")}
              className="grid size-11 place-items-center rounded-full text-fg-muted active:bg-surface-2"
            >
              <X className="size-5" aria-hidden />
            </Dialog.Close>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3">
            {primaryNav(t).map((item, index) => (
              <MenuRow key={item.to} item={item} index={index} />
            ))}

            <div className="my-3 h-px bg-border" aria-hidden />

            {secondaryNav(t).map((item, index) => (
              <MenuRow key={item.to} item={item} index={primaryNav(t).length + index} />
            ))}
          </nav>

          <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <StreakPanel />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Opening the menu by dragging in from the left edge of the screen.
 *
 * The gesture every phone app has: it costs no chrome and it is the only way
 * to reach navigation from a screen that shows none. Bound to the edge rather
 * than the whole surface so it can never fight a horizontal scroll inside the
 * page.
 */
function useEdgeSwipe(onOpen: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number; t: number } | null = null;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || touch.clientX > 24) {
        start = null;
        return;
      }
      start = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };

    const onEnd = (event: TouchEvent) => {
      const began = start;
      const touch = event.changedTouches[0];
      start = null;
      if (!began || !touch) return;
      const dx = touch.clientX - began.x;
      const dy = touch.clientY - began.y;
      // Rightward, far enough to be deliberate, flatter than it is vertical,
      // and finished briskly — a slow drift down the edge is not this gesture.
      if (dx > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - began.t < 600) onOpen();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [onOpen, enabled]);
}

// --- shell -------------------------------------------------------------------

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const [navOpen, setNavOpen] = useState(false);

  /**
   * Reading takes the whole phone screen.
   *
   * The reader draws its own header — a way back, the passage, its controls —
   * so the shell's bar on top of it would be a second row of chrome above the
   * Quran saying only the app's name. The edge swipe still reaches the menu.
   */
  const immersive = location.pathname.startsWith("/read/");

  // Tapping a destination should leave the menu behind.
  useEffect(() => setNavOpen(false), [location.pathname]);

  useEdgeSwipe(() => setNavOpen(true), !isDesktop);

  return (
    <div className="flex h-full bg-bg">
      <DesktopRail />

      <div className="flex min-w-0 flex-1 flex-col">
        {immersive ? null : (
          <header className="flex shrink-0 items-center gap-2 border-b border-border bg-bg px-2 pt-[env(safe-area-inset-top)] md:hidden">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              aria-label={t("app.openNavigation")}
              aria-expanded={navOpen}
              // 44px: the smallest reliable touch target.
              className="grid size-11 place-items-center rounded-lg text-fg-muted active:bg-surface-2"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <span className="text-[0.8125rem] font-medium tracking-tight text-fg">
              {t("app.name")}
            </span>
          </header>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Mounted only where it applies, so a wide window can never end up
          holding focus inside a menu it does not show. */}
      {isDesktop ? null : <MobileMenu open={navOpen} onOpenChange={setNavOpen} />}

      {/* Mounted once at the shell, so it raises on the app's first render and
          never again until the app is reopened. */}
      <TafsirNudge />
    </div>
  );
}

/** Consistent page framing for every non-reader route. */
export function Page({
  title,
  description,
  action,
  children,
  wide,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto px-5 py-6 md:px-8 md:py-9",
        // Clears the home indicator on a phone, where this scrolls to the very
        // bottom of the screen.
        "pb-[max(2rem,calc(env(safe-area-inset-bottom)+1.5rem))]",
        wide ? "max-w-6xl" : "max-w-4xl",
      )}
    >
      <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </div>
  );
}
