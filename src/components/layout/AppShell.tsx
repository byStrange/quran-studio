import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStreakStatus } from "@/hooks/useProgress";
import { Tooltip } from "@/components/ui/primitives";

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const PRIMARY_NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
  { to: "/browse", label: "Read", icon: <BookOpen className="size-4" /> },
  { to: "/vocabulary", label: "Vocabulary", icon: <Library className="size-4" /> },
  { to: "/quiz", label: "Quiz", icon: <GraduationCap className="size-4" /> },
  { to: "/memorization", label: "Memorization", icon: <BookMarked className="size-4" /> },
];

const SECONDARY_NAV: NavItem[] = [
  { to: "/settings", label: "Settings", icon: <SettingsIcon className="size-4" /> },
  { to: "/about", label: "About", icon: <Info className="size-4" /> },
];

function NavRow({ item }: { item: NavItem }) {
  const location = useLocation();
  // The reader lives under /read/:n but belongs to the "Read" nav entry.
  const isReaderActive = item.to === "/browse" && location.pathname.startsWith("/read/");

  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive || isReaderActive
            ? "bg-surface-2 font-medium text-fg"
            : "text-fg-muted hover:bg-surface-2/60 hover:text-fg",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-accent",
              "transition-opacity",
              isActive || isReaderActive ? "opacity-100" : "opacity-0",
            )}
            aria-hidden
          />
          <span className={cn(isActive || isReaderActive ? "text-accent" : "text-fg-subtle")}>
            {item.icon}
          </span>
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function StreakBadge() {
  const { streak, inGrace } = useStreakStatus();
  const current = streak?.current_streak ?? 0;

  return (
    <Tooltip
      content={
        inGrace
          ? "Your streak is paused. Read for a full hour in one day to restore it."
          : current > 0
            ? `${current} day streak — keep it going.`
            : "Read today to start a streak."
      }
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2",
          inGrace
            ? "border-warning/40 bg-gold-soft/60"
            : current > 0
              ? "border-accent/30 bg-accent-soft/50"
              : "border-border bg-surface-2",
        )}
      >
        <Flame
          className={cn(
            "size-4",
            inGrace ? "text-warning" : current > 0 ? "text-accent" : "text-fg-subtle",
          )}
          aria-hidden
        />
        <span className="text-sm font-semibold tabular-nums text-fg">{current}</span>
        <span className="text-[0.8125rem] text-fg-subtle">
          {inGrace ? "in grace" : current === 1 ? "day" : "days"}
        </span>
      </div>
    </Tooltip>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Tapping a destination should leave the drawer behind. The sidebar is the
  // same element at both sizes, so this runs harmlessly on desktop too.
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <div className="flex h-full bg-bg">
      {navOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          // Translucent without a blur reads as a rendering fault, and as a
          // drawer this sits directly over the page content.
          "flex w-60 shrink-0 flex-col border-r border-border bg-surface/80 backdrop-blur-xl",
          // Off-canvas drawer below md; an ordinary column from md up, where
          // the translate and the fixed positioning are both undone.
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200",
          "md:static md:z-auto md:translate-x-0 md:transition-none",
          // `invisible` keeps the off-screen links out of the tab order below
          // md without hiding the permanent sidebar above it.
          navOpen ? "translate-x-0" : "invisible -translate-x-full md:visible",
        )}
      >
        {/* The brand lives in the window title bar on desktop, which the phone
            layout drops — so the drawer restates it above the nav. */}
        <div className="flex items-center gap-2.5 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 md:hidden">
          <div className="grid size-[1.125rem] place-items-center rounded-[0.3rem] bg-accent text-accent-fg">
            <BookOpen className="size-3" aria-hidden />
          </div>
          <span className="text-[0.8125rem] font-medium tracking-tight text-fg">Quran Studio</span>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 pt-0 md:pt-4">
          {PRIMARY_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-border px-3 py-3">
          {SECONDARY_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </div>

        <div className="px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <StreakBadge />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border bg-bg px-2 pt-[env(safe-area-inset-top)] md:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            // 44px: the smallest reliable touch target.
            className="grid size-11 place-items-center rounded-lg text-fg-muted active:bg-surface-2"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="text-[0.8125rem] font-medium tracking-tight text-fg">Quran Studio</span>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
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
    <div className={cn("mx-auto px-4 py-6 md:px-8 md:py-8", wide ? "max-w-6xl" : "max-w-4xl")}>
      <header className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {children}
    </div>
  );
}
