import type { CSSProperties, ReactNode } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cn("skeleton rounded-md", className)} style={style} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-fg-subtle", className)} aria-hidden />;
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-16 text-sm text-fg-subtle">
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in">
      {icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-surface-2 text-fg-subtle">
          {icon}
        </div>
      ) : null}
      <h3 className="text-[0.9375rem] font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-fg-subtle">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * Failure surface for anything the user can meaningfully retry. Reading
 * content must never be blocked by one of these — they stand in for a single
 * panel, not the page.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  compact,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger-soft/50",
        compact ? "p-3.5" : "p-5",
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
        <div>
          <p className="text-sm font-medium text-fg">{title}</p>
          {message ? (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-fg-muted">{message}</p>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry} className="ml-6.5">
          <RefreshCw className="size-3.5" aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
