import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BookOpen,
  BookMarked,
  Flame,
  GraduationCap,
  Info,
  LayoutDashboard,
  Library,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStreak } from "@/hooks/useProgress";
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
  const { data: streak } = useStreak();
  const current = streak?.current_streak ?? 0;
  const inGrace = Boolean(streak?.grace_expires_on);

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
  return (
    <div className="flex h-full bg-bg">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/50">
        {/* The brand now lives in the window title bar, so the nav starts here. */}
        <nav className="flex-1 space-y-0.5 px-3 pt-4">
          {PRIMARY_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </nav>

        <div className="space-y-0.5 border-t border-border px-3 py-3">
          {SECONDARY_NAV.map((item) => (
            <NavRow key={item.to} item={item} />
          ))}
        </div>

        <div className="px-3 pb-4">
          <StreakBadge />
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
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
    <div className={cn("mx-auto px-8 py-8", wide ? "max-w-6xl" : "max-w-4xl")}>
      <header className="mb-7 flex items-start justify-between gap-6">
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
