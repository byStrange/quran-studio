import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg",
          "placeholder:text-fg-subtle transition-colors",
          "focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--ring)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-invalid": boolean }) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[0.8125rem] font-medium text-fg">
        {label}
      </label>
      {children({ id, "aria-invalid": Boolean(error) })}
      {error ? (
        <p className="text-[0.8125rem] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[0.8125rem] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
