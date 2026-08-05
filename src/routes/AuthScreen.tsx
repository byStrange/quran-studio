import { useState, type FormEvent } from "react";
import { BookOpen } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setNotice("Check your inbox to confirm your address, then sign in.");
          setMode("signin");
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full place-items-center bg-bg px-6">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-accent text-accent-fg">
            <BookOpen className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Quran Studio</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            Memorize the Quran, one ruku at a time.
          </p>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {(["signin", "signup"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setError(null);
                setNotice(null);
              }}
              className={cn(
                "rounded-lg py-2 text-[0.8125rem] font-medium transition-colors",
                mode === value
                  ? "bg-surface text-fg shadow-sm"
                  : "text-fg-subtle hover:text-fg",
              )}
            >
              {value === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            {(props) => (
              <Input
                {...props}
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>

          <Field
            label="Password"
            hint={mode === "signup" ? "At least 6 characters." : undefined}
          >
            {(props) => (
              <Input
                {...props}
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            )}
          </Field>

          {error ? (
            <p className="rounded-lg border border-danger/30 bg-danger-soft/50 px-3 py-2 text-[0.8125rem] text-fg">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="rounded-lg border border-accent/30 bg-accent-soft/50 px-3 py-2 text-[0.8125rem] text-fg">
              {notice}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
            {mode === "signin" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </div>
    </div>
  );
}
