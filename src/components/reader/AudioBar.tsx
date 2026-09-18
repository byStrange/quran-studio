import { useMemo } from "react";
import {
  AudioLines,
  Download,
  Gauge,
  GraduationCap,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import type { Reciter, RepeatMode } from "@/lib/types";
import type { RecitationPlayer } from "@/hooks/useRecitationPlayer";
import type { SurahDownload } from "@/hooks/useAudioDownloads";
import { cn, formatClock } from "@/lib/utils";
import { useT, type TFunction } from "@/providers/I18nProvider";
import { Button } from "@/components/ui/button";
import { MenuButton, SelectField, Tooltip, type MenuAction } from "@/components/ui/primitives";

const RATES = [0.75, 0.9, 1, 1.25, 1.5];

/** Cycles off → repeat the passage → repeat one ayah → only unmemorized → off. */
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = {
  off: "range",
  range: "ayah",
  ayah: "unmemorized",
  unmemorized: "off",
};

const REPEAT_KEY: Record<
  RepeatMode,
  "audio.repeatOff" | "audio.repeatRange" | "audio.repeatAyah" | "audio.repeatUnmemorized"
> = {
  off: "audio.repeatOff",
  range: "audio.repeatRange",
  ayah: "audio.repeatAyah",
  unmemorized: "audio.repeatUnmemorized",
};

export function AudioBar({
  player,
  reciters,
  reciterId,
  onReciterChange,
  rate,
  onRateChange,
  repeatMode,
  onRepeatModeChange,
  download,
  unmemorizedCount = 0,
  compact,
}: {
  player: RecitationPlayer;
  reciters: Reciter[] | undefined;
  reciterId: number | null;
  onReciterChange: (id: number) => void;
  rate: number;
  onRateChange: (rate: number) => void;
  repeatMode: RepeatMode;
  onRepeatModeChange: (mode: RepeatMode) => void;
  download: SurahDownload | null;
  /** How many ayahs the "unmemorized only" mode has to loop. */
  unmemorizedCount?: number;
  /** Below md, where the bar keeps only the controls that earn their width. */
  compact?: boolean;
}) {
  const t = useT();
  const reciterOptions = useMemo(
    () =>
      (reciters ?? []).map((reciter) => ({
        value: String(reciter.id),
        // The style is what separates two entries by the same reciter, so it
        // is part of the label rather than a detail behind a tooltip.
        label: reciter.style ? `${reciter.name} · ${reciter.style}` : reciter.name,
      })),
    [reciters],
  );

  const RepeatIcon =
    repeatMode === "ayah" ? Repeat1 : repeatMode === "unmemorized" ? GraduationCap : Repeat;

  /**
   * A mode with nothing to loop is the one case where the control has to say
   * so: "repeat unmemorized ayahs" on a fully memorized ruku would otherwise
   * look identical to the passage repeat.
   */
  const repeatLabel =
    repeatMode === "unmemorized" && unmemorizedCount === 0
      ? t("audio.repeatNothingLeft")
      : repeatMode === "unmemorized"
        ? t("audio.repeatingCount", { count: unmemorizedCount })
        : t("audio.repeatClickToChange", { mode: t(REPEAT_KEY[repeatMode]) });

  const overflow: MenuAction[] = [
    {
      label: repeatLabel,
      icon: <RepeatIcon className="size-4" aria-hidden />,
      active: repeatMode !== "off",
      onSelect: () => onRepeatModeChange(NEXT_REPEAT[repeatMode]),
    },
    {
      label: t("audio.speed", { rate }),
      icon: <Gauge className="size-4" aria-hidden />,
      active: rate !== 1,
      onSelect: () => onRateChange(nextRate(rate)),
    },
    ...(download ? [downloadAction(download, t)] : []),
  ];

  if (!player.available) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface/80 px-3 py-2 text-[0.8125rem] text-fg-subtle backdrop-blur md:px-6">
        <AudioLines className="size-4 shrink-0" aria-hidden />
        {reciters && reciters.length === 0
          ? t("audio.noneImported")
          : t("audio.noneForPassage")}
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-surface/80 backdrop-blur">
      {player.error ? (
        <div className="border-b border-border bg-danger-soft/40 px-3 py-1.5 text-[0.75rem] text-danger-soft-fg md:px-6">
          {player.error}
        </div>
      ) : null}

      <div className="flex items-center gap-2 px-3 py-2 md:gap-3 md:px-6 md:py-2.5">
        <Tooltip content={t("audio.previousAyah")}>
          <Button
            size="icon"
            variant="ghost"
            onClick={player.previous}
            aria-label={t("audio.previousAyah")}
          >
            <SkipBack className="size-4" aria-hidden />
          </Button>
        </Tooltip>

        <Button
          size="icon"
          variant="primary"
          onClick={player.toggle}
          aria-label={player.playing ? t("audio.pause") : t("audio.play")}
        >
          {player.loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : player.playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
        </Button>

        <Tooltip content={t("audio.nextAyah")}>
          <Button
            size="icon"
            variant="ghost"
            onClick={player.next}
            aria-label={t("audio.nextAyah")}
          >
            <SkipForward className="size-4" aria-hidden />
          </Button>
        </Tooltip>

        <span className="hidden shrink-0 text-[0.75rem] tabular-nums text-fg-subtle sm:inline">
          {formatClock(Math.round(player.elapsed))}
        </span>

        <Scrubber player={player} />

        <span className="hidden shrink-0 text-[0.75rem] tabular-nums text-fg-subtle sm:inline">
          {formatClock(Math.round(player.duration))}
        </span>

        {compact ? (
          <MenuButton actions={overflow}>
            <Button size="icon" variant="ghost" aria-label={t("audio.options")}>
              <AudioLines className="size-4" aria-hidden />
            </Button>
          </MenuButton>
        ) : (
          <>
            <Tooltip content={repeatLabel}>
              <Button
                size="icon"
                variant={repeatMode === "off" ? "ghost" : "outline"}
                aria-label={repeatLabel}
                onClick={() => onRepeatModeChange(NEXT_REPEAT[repeatMode])}
              >
                <RepeatIcon className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content={t("audio.speedHint")}>
              <Button
                size="sm"
                variant={rate === 1 ? "ghost" : "outline"}
                className="tabular-nums"
                aria-label={t("audio.speedLabel", { rate })}
                onClick={() => onRateChange(nextRate(rate))}
              >
                {rate}×
              </Button>
            </Tooltip>

            {download ? <DownloadButton download={download} t={t} /> : null}

            <SelectField
              value={reciterId !== null ? String(reciterId) : ""}
              onValueChange={(value) => onReciterChange(Number(value))}
              options={reciterOptions}
              placeholder={t("audio.reciter")}
              className="h-8 w-auto max-w-[15rem] shrink-0 px-2.5 text-[0.8125rem]"
            />
          </>
        )}
      </div>

      {compact ? (
        <div className="px-3 pb-2">
          <SelectField
            value={reciterId !== null ? String(reciterId) : ""}
            onValueChange={(value) => onReciterChange(Number(value))}
            options={reciterOptions}
            placeholder={t("audio.reciter")}
            className="h-8 w-full px-2.5 text-[0.8125rem]"
          />
        </div>
      ) : null}
    </div>
  );
}

function Scrubber({ player }: { player: RecitationPlayer }) {
  const t = useT();
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{t("audio.seek")}</span>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(player.progress * 1000)}
        onChange={(event) => player.seekFraction(Number(event.target.value) / 1000)}
        className={cn(
          "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-2",
          "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent",
          "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-accent",
        )}
        style={{
          background: `linear-gradient(to right, var(--accent) ${
            player.progress * 100
          }%, var(--surface-2) ${player.progress * 100}%)`,
        }}
      />
    </label>
  );
}

function DownloadButton({ download, t }: { download: SurahDownload; t: TFunction }) {
  if (download.state === "downloading") {
    return (
      <Tooltip content={t("audio.downloading", { percent: Math.round(download.progress * 100) })}>
        <Button
          size="icon"
          variant="outline"
          onClick={download.cancel}
          aria-label={t("audio.cancelDownload")}
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </Button>
      </Tooltip>
    );
  }

  if (download.state === "downloaded") {
    return (
      <Tooltip content={t("audio.savedOffline", { size: download.sizeLabel })}>
        <Button
          size="icon"
          variant="outline"
          onClick={download.remove}
          aria-label={t("audio.removeDownload")}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      content={
        download.available
          ? download.sizeLabel
            ? t("audio.downloadHintSized", { size: download.sizeLabel })
            : t("audio.downloadHint")
          : t("audio.downloadNeedsDesktop")
      }
    >
      <Button
        size="icon"
        variant="ghost"
        disabled={!download.available}
        onClick={download.start}
        aria-label={t("audio.download")}
      >
        <Download className="size-4" aria-hidden />
      </Button>
    </Tooltip>
  );
}

function downloadAction(download: SurahDownload, t: TFunction): MenuAction {
  if (download.state === "downloading") {
    return {
      label: t("audio.downloadingMenu", { percent: Math.round(download.progress * 100) }),
      icon: <Loader2 className="size-4 animate-spin" aria-hidden />,
      onSelect: download.cancel,
    };
  }
  if (download.state === "downloaded") {
    return {
      label: t("audio.removeDownloadMenu", { size: download.sizeLabel }),
      icon: <Trash2 className="size-4" aria-hidden />,
      onSelect: download.remove,
    };
  }
  return {
    label: download.sizeLabel
      ? t("audio.downloadMenuSized", { size: download.sizeLabel })
      : t("audio.downloadMenu"),
    icon: <Download className="size-4" aria-hidden />,
    disabled: !download.available,
    onSelect: download.start,
  };
}

function nextRate(current: number): number {
  const index = RATES.indexOf(current);
  return RATES[(index + 1) % RATES.length] ?? 1;
}
