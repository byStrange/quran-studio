import { useMemo } from "react";
import {
  AudioLines,
  Download,
  Gauge,
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
import { Button } from "@/components/ui/button";
import { MenuButton, SelectField, Tooltip, type MenuAction } from "@/components/ui/primitives";

const RATES = [0.75, 0.9, 1, 1.25, 1.5];

/** Cycles off → repeat the passage → repeat one ayah → off. */
const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = {
  off: "range",
  range: "ayah",
  ayah: "off",
};

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat off",
  range: "Repeating this ruku",
  ayah: "Repeating this ayah",
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
  /** Below md, where the bar keeps only the controls that earn their width. */
  compact?: boolean;
}) {
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

  const RepeatIcon = repeatMode === "ayah" ? Repeat1 : Repeat;

  const overflow: MenuAction[] = [
    {
      label: REPEAT_LABEL[repeatMode],
      icon: <RepeatIcon className="size-4" aria-hidden />,
      active: repeatMode !== "off",
      onSelect: () => onRepeatModeChange(NEXT_REPEAT[repeatMode]),
    },
    {
      label: `Speed ${rate}×`,
      icon: <Gauge className="size-4" aria-hidden />,
      active: rate !== 1,
      onSelect: () => onRateChange(nextRate(rate)),
    },
    ...(download ? [downloadAction(download)] : []),
  ];

  if (!player.available) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface/80 px-3 py-2 text-[0.8125rem] text-fg-subtle backdrop-blur md:px-6">
        <AudioLines className="size-4 shrink-0" aria-hidden />
        {reciters && reciters.length === 0
          ? "No recitations imported yet — run pnpm seed:audio."
          : "No recitation available for this passage."}
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
        <Tooltip content="Previous ayah">
          <Button size="icon" variant="ghost" onClick={player.previous} aria-label="Previous ayah">
            <SkipBack className="size-4" aria-hidden />
          </Button>
        </Tooltip>

        <Button
          size="icon"
          variant="primary"
          onClick={player.toggle}
          aria-label={player.playing ? "Pause recitation" : "Play recitation"}
        >
          {player.loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : player.playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
        </Button>

        <Tooltip content="Next ayah">
          <Button size="icon" variant="ghost" onClick={player.next} aria-label="Next ayah">
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
            <Button size="icon" variant="ghost" aria-label="Recitation options">
              <AudioLines className="size-4" aria-hidden />
            </Button>
          </MenuButton>
        ) : (
          <>
            <Tooltip content={`${REPEAT_LABEL[repeatMode]} — click to change`}>
              <Button
                size="icon"
                variant={repeatMode === "off" ? "ghost" : "outline"}
                aria-label={REPEAT_LABEL[repeatMode]}
                onClick={() => onRepeatModeChange(NEXT_REPEAT[repeatMode])}
              >
                <RepeatIcon className="size-4" aria-hidden />
              </Button>
            </Tooltip>

            <Tooltip content="Playback speed — slower is easier to follow while memorizing">
              <Button
                size="sm"
                variant={rate === 1 ? "ghost" : "outline"}
                className="tabular-nums"
                aria-label={`Playback speed ${rate} times`}
                onClick={() => onRateChange(nextRate(rate))}
              >
                {rate}×
              </Button>
            </Tooltip>

            {download ? <DownloadButton download={download} /> : null}

            <SelectField
              value={reciterId !== null ? String(reciterId) : ""}
              onValueChange={(value) => onReciterChange(Number(value))}
              options={reciterOptions}
              placeholder="Reciter"
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
            placeholder="Reciter"
            className="h-8 w-full px-2.5 text-[0.8125rem]"
          />
        </div>
      ) : null}
    </div>
  );
}

function Scrubber({ player }: { player: RecitationPlayer }) {
  return (
    <label className="min-w-0 flex-1">
      <span className="sr-only">Seek within this passage</span>
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

function DownloadButton({ download }: { download: SurahDownload }) {
  if (download.state === "downloading") {
    return (
      <Tooltip content={`Downloading — ${Math.round(download.progress * 100)}%`}>
        <Button
          size="icon"
          variant="outline"
          onClick={download.cancel}
          aria-label="Cancel download"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </Button>
      </Tooltip>
    );
  }

  if (download.state === "downloaded") {
    return (
      <Tooltip content={`Saved for offline — ${download.sizeLabel}. Click to remove.`}>
        <Button
          size="icon"
          variant="outline"
          onClick={download.remove}
          aria-label="Remove downloaded recitation"
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
          ? `Download this surah for offline listening${
              download.sizeLabel ? ` — ${download.sizeLabel}` : ""
            }`
          : "Downloads need the desktop app"
      }
    >
      <Button
        size="icon"
        variant="ghost"
        disabled={!download.available}
        onClick={download.start}
        aria-label="Download this surah"
      >
        <Download className="size-4" aria-hidden />
      </Button>
    </Tooltip>
  );
}

function downloadAction(download: SurahDownload): MenuAction {
  if (download.state === "downloading") {
    return {
      label: `Downloading… ${Math.round(download.progress * 100)}%`,
      icon: <Loader2 className="size-4 animate-spin" aria-hidden />,
      onSelect: download.cancel,
    };
  }
  if (download.state === "downloaded") {
    return {
      label: `Remove download (${download.sizeLabel})`,
      icon: <Trash2 className="size-4" aria-hidden />,
      onSelect: download.remove,
    };
  }
  return {
    label: download.sizeLabel ? `Download surah (${download.sizeLabel})` : "Download surah",
    icon: <Download className="size-4" aria-hidden />,
    disabled: !download.available,
    onSelect: download.start,
  };
}

function nextRate(current: number): number {
  const index = RATES.indexOf(current);
  return RATES[(index + 1) % RATES.length] ?? 1;
}
