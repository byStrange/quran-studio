import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { useContentLanguage, useProfile, useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useActiveReciter, useReciters } from "@/hooks/useRecitation";
import { useTafsirEditions } from "@/hooks/useQuranData";
import { useDownloadedSurahs } from "@/hooks/useAudioDownloads";
import { describeAiError, getAiStatus, isTauri, setAiApiKey } from "@/lib/ai";
import {
  CONTENT_LANGUAGES,
  contentLanguageInfo,
  DEFAULT_CONTENT_LANGUAGE,
  editionMatchesLanguage,
  isContentLanguage,
} from "@/lib/language";
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
  const { data: reciters } = useReciters();
  const { data: downloaded } = useDownloadedSurahs();
  const { theme, setTheme } = useTheme();
  const { data: profile } = useProfile();
  const prefs = useUiPrefs();
  const language = useContentLanguage();
  const { data: editions } = useTafsirEditions();
  const updateProfile = useUpdateProfile();
  // Resolved rather than read straight from prefs, so the picker shows the
  // reciter that will actually play when nothing has been chosen yet.
  const reciter = useActiveReciter(prefs.reciterId);
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
    // A rejected `invoke` throws the serialized Rust error as a plain string,
    // not an Error, so an `instanceof` check would discard every backend
    // message and report a useless generic failure.
    onError: (error) => toast(describeAiError(error), "error"),
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
          <CardHeader
            title="Language"
            description="The language of the scripture material. The interface stays in English."
          />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">Translation and study</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Sets the verse translation, the word-by-word glosses, the tafsir edition, and the
                  language the AI writes its explanations in. Currently reading{" "}
                  {contentLanguageInfo(language).translator}.
                </p>
              </div>
              <SelectField
                value={language}
                onValueChange={(value) => {
                  const next = isContentLanguage(value) ? value : DEFAULT_CONTENT_LANGUAGE;
                  // The tafsir edition moves with the language rather than
                  // being left behind on the previous one, which would leave a
                  // reader who switched to Russian with a Russian translation
                  // and an English commentary beside it. It stays a separate
                  // preference, so picking a different edition afterwards
                  // still sticks.
                  const edition = editions?.find((e) => editionMatchesLanguage(e, next))?.slug;
                  updateProfile.mutate({
                    ui_prefs: {
                      contentLanguage: next,
                      ...(edition ? { tafsirEdition: edition } : {}),
                    },
                  });
                }}
                options={CONTENT_LANGUAGES.map((l) => ({
                  value: l.code,
                  label: l.code === "en" ? l.label : `${l.label} · ${l.nativeLabel}`,
                }))}
                className="w-44"
              />
            </div>

            {language === "ru" ? (
              <p className="border-t border-border pt-4 text-[0.75rem] text-fg-subtle">
                About 1.5% of words have no Russian gloss in the upstream corpus and show the
                English one instead.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reader" description="How the lesson view is laid out." />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">Default layout</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Study shows translation and word-by-word. Mushaf reproduces the printed Madani
                  page, for revising from the layout you memorised.
                </p>
              </div>
              <SelectField
                value={prefs.readerMode}
                onValueChange={(value) =>
                  updateProfile.mutate({
                    ui_prefs: { readerMode: value as "study" | "mushaf" },
                  })
                }
                options={[
                  { value: "study", label: "Study" },
                  { value: "mushaf", label: "Mushaf" },
                ]}
                className="w-32"
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
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
                <div className="text-[0.8125rem] font-medium text-fg">Tajweed colouring</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Colour the Arabic by recitation rule, with a legend in the reader. Colour only —
                  the text itself is unchanged.
                </p>
              </div>
              <Toggle
                checked={prefs.tajweed}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { tajweed: checked } })
                }
                label="Tajweed colouring"
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
            title="Recitation"
            description="Which reciter plays, and how closely the reader follows along."
          />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[0.8125rem] font-medium text-fg">Reciter</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {reciters?.length
                    ? "Each recitation is one continuous file per surah, so phrasing across " +
                      "ayah boundaries is the reciter's own."
                    : "No recitations imported yet — run `pnpm seed:audio`."}
                </p>
              </div>
              {reciters?.length ? (
                <SelectField
                  value={reciter ? String(reciter.id) : ""}
                  onValueChange={(value) =>
                    updateProfile.mutate({ ui_prefs: { reciterId: Number(value) } })
                  }
                  options={reciters.map((r) => ({
                    value: String(r.id),
                    label: r.style ? `${r.name} · ${r.style}` : r.name,
                  }))}
                  placeholder="Reciter"
                  className="w-56 shrink-0"
                />
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">Follow the recitation</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Scroll to the ayah being recited as it plays. Turn off to read one place while
                  listening to another.
                </p>
              </div>
              <Toggle
                checked={prefs.followRecitation}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { followRecitation: checked } })
                }
                label="Follow the recitation"
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">Highlight words</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  Light up each word in the word-by-word row as it is recited.
                </p>
              </div>
              <Toggle
                checked={prefs.highlightWords}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { highlightWords: checked } })
                }
                label="Highlight words"
              />
            </div>

            {isTauri() ? (
              <div className="border-t border-border pt-4 text-[0.75rem] text-fg-subtle">
                {downloaded?.size
                  ? `${downloaded.size} ${
                      downloaded.size === 1 ? "surah is" : "surahs are"
                    } saved for offline listening. Remove one from the player bar in the reader.`
                  : "Nothing saved for offline yet — use the download button in the reader's player bar."}
              </div>
            ) : null}
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
