/**
 * Thin, styled wrappers over Radix primitives. Keeping them here means the
 * rest of the app imports one consistent surface rather than raw Radix.
 */
import type { ReactNode } from "react";
import { Dialog, Select, Switch, Tooltip as RadixTooltip, Progress } from "radix-ui";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

// --- Modal -----------------------------------------------------------------

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2 animate-rise",
            "rounded-2xl border border-border bg-surface p-6 shadow-2xl shadow-black/30",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold tracking-tight text-fg">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close className="rounded-lg p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg">
              <X className="size-4" aria-hidden />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          {children ? <div className="mt-5">{children}</div> : null}
          {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// --- Select ----------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  className,
  id,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        id={id}
        className={cn(
          "inline-flex h-10 w-full items-center justify-between gap-2 rounded-lg",
          "border border-border bg-surface px-3 text-sm text-fg transition-colors",
          "hover:bg-surface-2 focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--ring)]",
          className,
        )}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown className="size-4 text-fg-subtle" aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-xl border border-border bg-surface shadow-xl shadow-black/20",
          )}
        >
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "relative flex cursor-pointer select-none items-center rounded-lg",
                  "py-2 pl-8 pr-3 text-sm text-fg outline-none",
                  "data-[highlighted]:bg-surface-2 data-[state=checked]:text-accent-soft-fg",
                )}
              >
                <Select.ItemIndicator className="absolute left-2.5">
                  <Check className="size-3.5" aria-hidden />
                </Select.ItemIndicator>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// --- Switch ----------------------------------------------------------------

export function Toggle({
  checked,
  onCheckedChange,
  id,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  label?: string;
}) {
  return (
    <Switch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        "border border-border data-[state=checked]:border-accent",
        "bg-surface-3 data-[state=checked]:bg-accent",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--ring)]",
      )}
    >
      <Switch.Thumb
        className={cn(
          "block size-4.5 translate-x-[3px] rounded-full bg-white shadow-sm",
          "transition-transform data-[state=checked]:translate-x-[23px]",
        )}
      />
    </Switch.Root>
  );
}

// --- Progress --------------------------------------------------------------

export function ProgressBar({
  value,
  className,
  tone = "accent",
}: {
  /** 0–100 */
  value: number;
  className?: string;
  tone?: "accent" | "gold";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <Progress.Root
      value={clamped}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <Progress.Indicator
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          tone === "accent" ? "bg-accent" : "bg-gold",
        )}
        style={{ width: `${clamped}%` }}
      />
    </Progress.Root>
  );
}

// --- Tooltip ---------------------------------------------------------------

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={6}
            className={cn(
              "z-50 max-w-xs rounded-lg border border-border bg-surface px-2.5 py-1.5",
              "text-[0.8125rem] leading-snug text-fg shadow-lg shadow-black/20",
              "animate-fade-in",
            )}
          >
            {content}
            <RadixTooltip.Arrow className="fill-[var(--surface)]" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
