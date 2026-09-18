import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useAuth } from "@/providers/AuthProvider";
import { useTheme } from "@/providers/ThemeProvider";
import { useProfile, useUiPrefs, useUpdateProfile } from "@/hooks/useProfile";
import { useActiveReciter, useReciters } from "@/hooks/useRecitation";
import { useTafsirEditions } from "@/hooks/useQuranData";
import { useDownloadedSurahs } from "@/hooks/useAudioDownloads";
import { describeAiError, getAiStatus, isTauri, setAiApiKey } from "@/lib/ai";
import { editionMatchesLanguage } from "@/lib/language";
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGES, languageInfo } from "@/lib/i18n";
import { useLanguage, useT, type TFunction } from "@/providers/I18nProvider";
import type { ReaderMode } from "@/lib/types";
import { Page } from "@/components/layout/AppShell";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { SelectField, Toggle } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, detectTimezone } from "@/lib/utils";

const themes = (t: TFunction) =>
  [
    { value: "light", label: t("settings.themeLight"), icon: <Sun className="size-3.5" /> },
    { value: "dark", label: t("settings.themeDark"), icon: <Moon className="size-3.5" /> },
    { value: "system", label: t("settings.themeSystem"), icon: <Monitor className="size-3.5" /> },
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
  const t = useT();
  const { user, signOut } = useAuth();
  const { data: reciters } = useReciters();
  const { data: downloaded } = useDownloadedSurahs();
  const { theme, setTheme } = useTheme();
  const { data: profile } = useProfile();
  const prefs = useUiPrefs();
  const language = useLanguage();
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
          ? t("settings.connectedToast", { model: status.model })
          : (status.error ?? t("settings.keySaved")),
        status.model ? "success" : "error",
      );
    },
    // A rejected `invoke` throws the serialized Rust error as a plain string,
    // not an Error, so an `instanceof` check would discard every backend
    // message and report a useless generic failure.
    onError: (error) => toast(describeAiError(error, t), "error"),
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
    <Page title={t("settings.title")} description={t("settings.description")}>
      <div className="space-y-4">
        <Card>
          <CardHeader
            title={t("settings.appearance")}
            description={t("settings.appearanceDescription")}
          />
          <CardBody>
            <div className="flex gap-1 rounded-xl bg-surface-2 p-1">
              {themes(t).map((option) => (
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
            title={t("settings.language")}
            description={t("settings.languageDescription")}
          />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  {t("settings.languageRow")}
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.languageRowDescription", {
                    translator: languageInfo(language).translator,
                  })}
                </p>
              </div>
              <SelectField
                value={language}
                onValueChange={(value) => {
                  const next = isLanguage(value) ? value : DEFAULT_LANGUAGE;
                  // The tafsir edition moves with the language rather than
                  // being left behind on the previous one, which would leave a
                  // reader who switched to Russian with a Russian translation
                  // and an English commentary beside it. It stays a separate
                  // preference, so picking a different edition afterwards
                  // still sticks.
                  const edition = editions?.find((e) => editionMatchesLanguage(e, next))?.slug;
                  updateProfile.mutate({
                    ui_prefs: {
                      language: next,
                      ...(edition ? { tafsirEdition: edition } : {}),
                    },
                  });
                }}
                // Native names only. Someone looking for their own language
                // recognises it written in itself; an English gloss beside it
                // helps nobody who needs the row.
                options={LANGUAGES.map((l) => ({ value: l.code, label: l.nativeLabel }))}
                className="w-44"
              />
            </div>

            {/* Each language says what it does not yet have, rather than the
                picker pretending all three are equally complete. */}
            {language === "ru" ? (
              <p className="border-t border-border pt-4 text-[0.75rem] text-fg-subtle">
                {t("settings.russianGlossNote")}
              </p>
            ) : language === "uz" ? (
              <p className="border-t border-border pt-4 text-[0.75rem] text-fg-subtle">
                {t("settings.uzbekDataNote")}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.reader")}
            description={t("settings.readerDescription")}
          />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  {t("settings.defaultLayout")}
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.defaultLayoutDescription")}
                </p>
              </div>
              <SelectField
                value={prefs.readerMode}
                onValueChange={(value) =>
                  updateProfile.mutate({
                    ui_prefs: { readerMode: value as ReaderMode },
                  })
                }
                options={[
                  { value: "study", label: t("settings.modeStudy") },
                  { value: "surah", label: t("settings.modeSurah") },
                  { value: "mushaf", label: t("settings.modeMushaf") },
                ]}
                className="w-32"
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  {t("settings.tafsirSide")}
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.tafsirSideDescription")}
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
                  { value: "left", label: t("settings.left") },
                  { value: "right", label: t("settings.right") },
                ]}
                className="w-32"
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">{t("settings.tajweed")}</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.tajweedDescription")}
                </p>
              </div>
              <Toggle
                checked={prefs.tajweed}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { tajweed: checked } })
                }
                label={t("settings.tajweed")}
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  {t("settings.expandWords")}
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.expandWordsDescription")}
                </p>
              </div>
              <Toggle
                checked={prefs.wordsExpanded}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { wordsExpanded: checked } })
                }
                label={t("settings.expandWords")}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.recitation")}
            description={t("settings.recitationDescription")}
          />
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0">
                <div className="text-[0.8125rem] font-medium text-fg">{t("settings.reciter")}</div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {reciters?.length ? t("settings.reciterDescription") : t("settings.noReciters")}
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
                  placeholder={t("settings.reciter")}
                  className="w-56 shrink-0"
                />
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  {t("settings.followRecitation")}
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.followRecitationDescription")}
                </p>
              </div>
              <Toggle
                checked={prefs.followRecitation}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { followRecitation: checked } })
                }
                label={t("settings.followRecitation")}
              />
            </div>

            <div className="flex items-center justify-between gap-6 border-t border-border pt-4">
              <div>
                <div className="text-[0.8125rem] font-medium text-fg">
                  {t("settings.highlightWords")}
                </div>
                <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                  {t("settings.highlightWordsDescription")}
                </p>
              </div>
              <Toggle
                checked={prefs.highlightWords}
                onCheckedChange={(checked) =>
                  updateProfile.mutate({ ui_prefs: { highlightWords: checked } })
                }
                label={t("settings.highlightWords")}
              />
            </div>

            {isTauri() ? (
              <div className="border-t border-border pt-4 text-[0.75rem] text-fg-subtle">
                {downloaded?.size
                  ? t("settings.downloadedCount", { count: downloaded.size })
                  : t("settings.nothingDownloaded")}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.timezone")}
            description={t("settings.timezoneDescription")}
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
                  {t("common.saved")}
                </span>
              ) : null}
            </div>
            {profile && profile.timezone !== detected ? (
              <p className="text-[0.75rem] text-fg-subtle">
                {t("settings.machineReports", { timezone: detected })}{" "}
                <button
                  onClick={() => {
                    setTimezone(detected);
                    updateProfile.mutate({ timezone: detected });
                  }}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {t("settings.useIt")}
                </button>
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("settings.ollama")}
            description={t("settings.ollamaDescription")}
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
                ? t("common.checking")
                : aiStatus.data?.model
                  ? t("settings.connected", { model: aiStatus.data.model })
                  : (aiStatus.data?.error ?? t("settings.notConfigured"))}
            </div>

            {isTauri() ? (
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t("settings.apiKeyPlaceholder")}
                  autoComplete="off"
                />
                <Button
                  variant="primary"
                  disabled={!apiKey.trim()}
                  loading={saveKey.isPending}
                  onClick={() => saveKey.mutate()}
                >
                  {t("common.save")}
                </Button>
              </div>
            ) : (
              <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
                {t("settings.keyNeedsDesktop")}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("settings.account")} />
          <CardBody className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="truncate text-[0.8125rem] font-medium text-fg">{user?.email}</div>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                {t("settings.accountDescription")}
              </p>
            </div>
            <Button variant="outline" onClick={() => void signOut()}>
              <LogOut className="size-4" aria-hidden />
              {t("settings.signOut")}
            </Button>
          </CardBody>
        </Card>
      </div>
    </Page>
  );
}
