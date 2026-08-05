import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { useProfile, useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { getAiStatus, isTauri, setAiApiKey } from "@/lib/ai";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SelectField, Toggle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, detectTimezone } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: <Sun className="size-3.5" /> },
  { value: "dark", label: "Dark", icon: <Moon className="size-3.5" /> },
  { value: "system", label: "System", icon: <Monitor className="size-3.5" /> },
] as const;

/** A short list covers the common cases; anything else can be typed in. */
const TIMEZONES = [
  "UTC",
  "Asia/Tashkent",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kuala_Lumpur",
  "Asia/Jakarta",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
];

export function Settings() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { data: profile } = useProfile();
  const prefs = useUiPrefs();
  const updateProfile = useUpdateProfile();
  const toast = useToast();

  const [apiKey, setApiKey] = useState("");

  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: getAiStatus,
    retry: false,
  });

  const saveKey = useMutation({
    mutationFn: () => setAiApiKey(apiKey.trim()),
    onSuccess: (status) => {
      setApiKey("");
      void aiStatus.refetch();
      toast(
        status.model
          ? `Connected to Ollama Cloud using ${status.model}.`
          : status.error ?? "Key saved.",
        status.model ? "success" : "error",
      );
    },
    onError: (error) =>
      toast(error instanceof Error ? error.message : "Could not save the key.", "error"),
  });

  // Offer to correct a profile timezone that no longer matches the machine.
  const detected = detectTimezone();
  const [timezone, setTimezone] = useState(profile?.timezone ?? detected);
  useEffect(() => {
    if (profile?.timezone) setTimezone(profile.timezone);
  }, [profile?.timezone]);

  const timezoneOptions = Array.from(new Set([...TIMEZONES, detected, timezone]))
    .sort()
    .map((tz) => ({ value: tz, label: tz }));

  return (
    <Page title="Settings" description="Appearance, reading layout, account, and AI.">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Appearance" description="Theme applies immediately." />
          <CardBody>
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setTheme(option.value);
                    updateProfile.mutate({ ui_prefs: { theme: option.value } });
                  }}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg py-2",
                    "text-[0.8125rem] font-medium transition-colors",
                    theme === option.value
                      ? "bg-surface text-fg shadow-sm"
                      : "text-fg-subtle hover:text-fg",
                  )}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reader" description="How the lesson view is laid out." />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">Tafsir panel side</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Which side of the reader the commentary sits on.
                </p>
              </div>
              <SelectField
                value={prefs.tafsirSide}
                onValueChange={(value) =>
                  updateProfile.mutate({
                    ui_prefs: { tafsirSide: value as "left" | "right" },
                  })
                }
                options={[
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ]}
                className="w-32"
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  Expand word-by-word by default
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Show every word breakdown as soon as a ruku opens.
                </p>
              </div>
              <Toggle
                checked={prefs.wordsExpanded}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { wordsExpanded: checked } })
                }
                label="Expand word-by-word by default"
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Timezone"
            description="Sets the day boundary used for reading streaks."
          />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3">
              <SelectField
                value={timezone}
                onValueChange={(value) => {
                  setTimezone(value);
                  updateProfile.mutate({ timezone: value });
                }}
                options={timezoneOptions}
                className="max-w-xs"
              />
              {profile?.timezone === timezone ? (
                <span className="flex items-center gap-1 text-[0.75rem] text-fg-subtle">
                  <Check className="size-3.5 text-accent" aria-hidden />
                  Saved
                </span>
              ) : null}
            </div>
            {profile && profile.timezone !== detected ? (
              <p className="text-[0.75rem] text-fg-subtle">
                This machine reports <strong className="text-fg-muted">{detected}</strong>.{" "}
                <button
                  onClick={() => {
                    setTimezone(detected);
                    updateProfile.mutate({ timezone: detected });
                  }}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Use it
                </button>
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Ollama Cloud"
            description="Powers word explanations and ruku summaries. The key stays in the desktop backend and never reaches the interface."
          />
          <CardBody className="space-y-3">
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-[0.8125rem]",
                aiStatus.data?.model
                  ? "border-accent/30 bg-accent-soft/40 text-fg"
                  : "border-border bg-surface-2 text-fg-muted",
              )}
            >
              <KeyRound className="size-3.5 shrink-0" aria-hidden />
              {aiStatus.isLoading
                ? "Checking…"
                : aiStatus.data?.model
                  ? `Connected · ${aiStatus.data.model}`
                  : (aiStatus.data?.error ?? "Not configured")}
            </div>

            {isTauri() ? (
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste your Ollama Cloud API key"
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  disabled={!apiKey.trim()}
                  loading={saveKey.isPending}
                  onClick={() => saveKey.mutate()}
                >
                  Save
                </Button>
              </div>
            ) : (
              <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
                Run the desktop app (<code className="text-fg-muted">pnpm app:dev</code>) to
                configure the key, or set <code className="text-fg-muted">OLLAMA_API_KEY</code>{" "}
                in your <code className="text-fg-muted">.env</code>.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Account" />
          <CardBody className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="truncate text-[0.8125rem] font-medium text-fg">{user?.email}</div>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                All your progress is scoped to this account.
              </p>
            </div>
            <Button variant="outline" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              Sign out
            </Button>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
