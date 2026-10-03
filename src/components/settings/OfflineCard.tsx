import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, CloudDownload, Headphones, Trash2, X } from "lucide-react";
import { useOfflinePacks, type PackState } from "@/hooks/useOfflinePacks";
import { removeDownloadedSurah, useDownloadedSurahs } from "@/hooks/useAudioDownloads";
import { useReciters } from "@/hooks/useRecitation";
import { useSurahs, useTafsirEditions } from "@/hooks/useQuranData";
import { storageEstimate } from "@/lib/offline/db";
import type { PackId } from "@/lib/offline/packs";
import { isTauri } from "@/lib/ai";
import { formatBytes } from "@/lib/utils";
import { useT } from "@/providers/I18nProvider";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/primitives";

/**
 * Everything kept on this device for reading without a connection: the Quran
 * itself, each tafsir edition, and the surahs downloaded for listening.
 *
 * Laid out like a maps app's offline regions — one row per thing that can be
 * downloaded, each with its own state — because that is the question this
 * card answers: what will still work on the plane.
 */
export function OfflineCard() {
  const t = useT();
  const packs = useOfflinePacks();
  const { data: editions } = useTafsirEditions();
  const [usage, setUsage] = useState<number | null>(null);

  const quran = packs.state("quran");
  const anyRunning =
    quran.progress !== null ||
    (editions ?? []).some((e) => packs.state(`tafsir:${e.slug}`).progress !== null);

  // Re-measured as downloads finish or are removed, not on a timer.
  const installedKey = JSON.stringify([quran.info, anyRunning]);
  useEffect(() => {
    void storageEstimate().then(setUsage);
  }, [installedKey]);

  return (
    <Card>
      <CardHeader
        title={t("offline.title")}
        description={t("offline.description")}
        action={
          usage !== null ? (
            <span className="shrink-0 text-[0.75rem] tabular-nums text-fg-subtle">
              {t("offline.storageUsed", { size: formatBytes(usage) })}
            </span>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        <PackRow
          icon={<BookOpen className="size-4" aria-hidden />}
          title={t("offline.quranTitle")}
          description={t("offline.quranDescription")}
          state={quran}
          onDownload={() => packs.download("quran")}
          onCancel={() => packs.cancel("quran")}
          onRemove={() => void packs.remove("quran")}
        />

        <div className="border-t border-border pt-4">
          <div className="mb-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
            {t("offline.tafsirHeading")}
          </div>
          <div className="space-y-3">
            {(editions ?? []).map((edition) => {
              const id: PackId = `tafsir:${edition.slug}`;
              return (
                <PackRow
                  key={edition.slug}
                  title={`${edition.name} · ${edition.language_name}`}
                  state={packs.state(id)}
                  onDownload={() => packs.download(id)}
                  onCancel={() => packs.cancel(id)}
                  onRemove={() => void packs.remove(id)}
                />
              );
            })}
          </div>
        </div>

        <RecitationDownloads />
      </CardBody>
    </Card>
  );
}

function PackRow({
  icon,
  title,
  description,
  state,
  onDownload,
  onCancel,
  onRemove,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  state: PackState;
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const downloading = state.progress !== null;

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon ? <span className="mt-0.5 shrink-0 text-fg-subtle">{icon}</span> : null}
          <div className="min-w-0">
            <div className="truncate text-[0.8125rem] font-medium text-fg">{title}</div>
            <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
              {downloading
                ? t("offline.downloading", { percent: Math.round((state.progress ?? 0) * 100) })
                : state.info
                  ? t("offline.savedOn", {
                      date: new Date(state.info.installedAt).toLocaleDateString(),
                    })
                  : (description ?? t("offline.notSaved"))}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {downloading ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              <X className="size-3.5" aria-hidden />
              {t("common.cancel")}
            </Button>
          ) : state.info ? (
            <>
              <Button size="sm" variant="ghost" onClick={onDownload}>
                {t("offline.update")}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={t("offline.remove")}
                title={t("offline.remove")}
                onClick={onRemove}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={onDownload}>
              <CloudDownload className="size-3.5" aria-hidden />
              {t("offline.download")}
            </Button>
          )}
        </div>
      </div>
      {downloading ? (
        <ProgressBar value={(state.progress ?? 0) * 100} className="mt-2 h-1.5" />
      ) : null}
      {state.error ? (
        <p className="mt-1.5 text-[0.75rem] text-danger">
          {t("offline.failed", { error: state.error })}
        </p>
      ) : null}
    </div>
  );
}

/** The surahs saved for listening, by reciter, each removable. */
function RecitationDownloads() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: downloads } = useDownloadedSurahs();
  const { data: reciters } = useReciters();
  const { data: surahs } = useSurahs();
  const [removing, setRemoving] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byReciter = new Map<number, Array<{ surah: number; bytes: number }>>();
    for (const entry of downloads ?? []) {
      const list = byReciter.get(entry.reciter_id) ?? [];
      list.push({ surah: entry.surah_number, bytes: entry.bytes });
      byReciter.set(entry.reciter_id, list);
    }
    return [...byReciter.entries()].map(([reciterId, list]) => ({
      reciterId,
      name: reciters?.find((r) => r.id === reciterId)?.name ?? `#${reciterId}`,
      surahs: list.sort((a, b) => a.surah - b.surah),
      bytes: list.reduce((sum, item) => sum + item.bytes, 0),
    }));
  }, [downloads, reciters]);

  if (!isTauri()) return null;

  const total = groups.reduce((sum, group) => sum + group.bytes, 0);

  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider text-fg-subtle">
          <Headphones className="size-3.5" aria-hidden />
          {t("offline.audioHeading")}
        </div>
        {total > 0 ? (
          <span className="text-[0.75rem] tabular-nums text-fg-subtle">{formatBytes(total)}</span>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <p className="text-[0.75rem] text-fg-subtle">{t("settings.nothingDownloaded")}</p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.reciterId}>
              <div className="mb-1.5 text-[0.8125rem] font-medium text-fg">
                {group.name}{" "}
                <span className="font-normal text-fg-subtle tabular-nums">
                  · {formatBytes(group.bytes)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.surahs.map(({ surah, bytes }) => {
                  const key = `${group.reciterId}:${surah}`;
                  const name = surahs?.find((s) => s.number === surah)?.name_english ?? String(surah);
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2/50 py-0.5 pr-0.5 pl-2 text-[0.75rem] text-fg-muted"
                      title={formatBytes(bytes)}
                    >
                      {surah}. {name}
                      <button
                        className="grid size-5 place-items-center rounded text-fg-subtle hover:bg-surface-3 hover:text-fg disabled:opacity-50"
                        aria-label={t("offline.removeSurah", { surah: name })}
                        disabled={removing === key}
                        onClick={() => {
                          setRemoving(key);
                          void removeDownloadedSurah(queryClient, group.reciterId, surah).finally(
                            () => setRemoving(null),
                          );
                        }}
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
