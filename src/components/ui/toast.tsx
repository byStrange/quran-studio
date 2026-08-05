import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, Info, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  toast: (message: string, kind?: ToastKind) => void;
} | null>(null);

const ICONS: Record<ToastKind, ReactNode> = {
  success: <Check className="size-4 text-success" aria-hidden />,
  error: <AlertTriangle className="size-4 text-danger" aria-hidden />,
  info: <Info className="size-4 text-fg-subtle" aria-hidden />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, kind, message }]);
      window.setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3",
              "bg-surface border-border shadow-lg shadow-black/10",
              "animate-rise",
            )}
          >
            <span className="mt-0.5 shrink-0">{ICONS[t.kind]}</span>
            <p className="flex-1 text-[0.8125rem] leading-snug text-fg">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-fg-subtle transition-colors hover:text-fg"
              aria-label="Dismiss"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx.toast;
}
