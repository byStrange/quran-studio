import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface border border-border rounded-card",
        "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-16px_rgb(0_0_0/0.15)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {description ? (
          <p className="mt-1 text-[0.8125rem] text-fg-subtle leading-relaxed">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

/** A single headline number with a label, used across the dashboard. */
export function StatTile({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className={cn("p-5", accent && "border-accent/30 bg-accent-soft/40")}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.75rem] font-medium uppercase tracking-wider text-fg-subtle">
          {label}
        </span>
        {icon ? <span className={cn("text-fg-subtle", accent && "text-accent")}>{icon}</span> : null}
      </div>
      <div
        className={cn(
          "mt-3 text-3xl font-semibold tracking-tight tabular-nums",
          accent ? "text-accent-soft-fg" : "text-fg",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[0.8125rem] text-fg-subtle">{hint}</div> : null}
    </Card>
  );
}
