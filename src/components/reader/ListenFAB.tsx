import { useEffect, useRef, useState } from "react";
import { Download, Mic, MicOff, AlertCircle } from "lucide-react";
import { useListenMode } from "@/hooks/useListenMode";
import type { VerseWithWords } from "@/lib/types";

/**
 * Floating action button for the Listen & Follow feature.
 *
 * Sits in the bottom-right corner above the audio bar. Tapping it starts
 * listening via the microphone, running local Whisper inference, and matching
 * the recognised text against the Quran to follow the user's recitation.
 *
 * The component manages the full lifecycle: first-use model download,
 * microphone permission, listening state, and the transcript badge.
 */
export function ListenFAB({
  verses,
  onVerseMatch,
  disabled,
}: {
  /** The current ruku's verses — needed by the matcher. */
  verses: VerseWithWords[];
  /** Called when the matcher identifies a verse. Drives auto-scroll. */
  onVerseMatch: (verseId: number | null) => void;
  /** True when the recitation player is active (mutual exclusion). */
  disabled: boolean;
}) {
  const listenMode = useListenMode(verses);
  const { status, matchedVerseId, matcherState, isSupported, modelReady, transcript, error } = listenMode;
  const [showUnsupportedNotice, setShowUnsupportedNotice] = useState(false);

  // Forward matched verse to the parent Reader.
  const prevMatchedRef = useRef<number | null>(null);
  useEffect(() => {
    if (matchedVerseId !== prevMatchedRef.current) {
      prevMatchedRef.current = matchedVerseId;
      onVerseMatch(matchedVerseId);
    }
  }, [matchedVerseId, onVerseMatch]);

  // Clear the parent's matched verse when listening stops.
  useEffect(() => {
    if (status === "idle") {
      onVerseMatch(null);
    }
  }, [status, onVerseMatch]);

  // Show/hide the transcript badge with a fade timer.
  const [showBadge, setShowBadge] = useState(false);
  const badgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (transcript) {
      setShowBadge(true);
      clearTimeout(badgeTimer.current);
      badgeTimer.current = setTimeout(() => setShowBadge(false), 4000);
    }
    return () => clearTimeout(badgeTimer.current);
  }, [transcript]);

  // Prompt for model download on first use.
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);

  const handleDownload = async () => {
    setShowDownloadPrompt(false);
    const success = await listenMode.downloadModel();
    if (success) {
      await listenMode.start();
    }
  };

  const handleClick = async () => {
    if (disabled) return;

    if (!isSupported) {
      setShowUnsupportedNotice(true);
      setTimeout(() => setShowUnsupportedNotice(false), 4000);
      return;
    }

    // Currently listening — stop.
    if (status === "listening") {
      listenMode.stop();
      return;
    }

    // Model not downloaded — start download.
    if (!modelReady) {
      if (listenMode.modelDownloadProgress !== null) {
        // Already downloading — do nothing.
        return;
      }
      // Start model download directly
      await handleDownload();
      return;
    }

    // Ready — start listening.
    await listenMode.start();
  };

  const isListening = status === "listening";
  const isDownloading = listenMode.modelDownloadProgress !== null;

  // --- FAB class ---
  let fabClass = "listen-fab";
  if (isListening) {
    fabClass += ` listen-fab--${matcherState}`;
  } else if (error) {
    fabClass += " listen-fab--error";
  }

  // --- Status label ---
  const statusLabel = isListening
    ? matcherState === "searching"
      ? "Listening…"
      : matcherState === "following"
        ? "Following"
        : "Re-searching…"
    : null;

  // --- Progress ring (for model download) ---
  const circumference = 2 * Math.PI * 24; // radius = 24 (of the 54px SVG)
  const dashOffset =
    isDownloading && listenMode.modelDownloadProgress !== null
      ? circumference * (1 - listenMode.modelDownloadProgress)
      : circumference;

  return (
    <>
      {/* Transcript badge */}
      {showBadge && transcript && isListening ? (
        <div className="listen-badge" key={transcript}>
          {transcript}
        </div>
      ) : null}

      {/* Status label */}
      {statusLabel ? (
        <div className={`listen-status listen-status--${matcherState}`}>
          {statusLabel}
        </div>
      ) : null}

      {/* Download prompt tooltip */}
      {showDownloadPrompt && !modelReady && !isDownloading && !error ? (
        <div
          className="fixed right-16 bottom-[5.75rem] z-50 max-w-[13rem] rounded-xl border border-border bg-surface p-3 text-[0.75rem] text-fg-muted shadow-lg"
          style={{ animation: "var(--animate-rise)" }}
        >
          <p className="mb-2 font-medium text-fg">
            Download speech model?
          </p>
          <p className="mb-2.5 text-[0.6875rem] leading-relaxed">
            A one-time ~75 MB download is needed for offline voice recognition. Tap the mic again to start.
          </p>
          <button
            className="w-full rounded-lg bg-accent px-3 py-1.5 text-[0.75rem] font-medium text-accent-fg transition-colors hover:bg-accent-hover"
            onClick={handleDownload}
          >
            <Download className="mr-1.5 inline size-3" aria-hidden />
            Download
          </button>
        </div>
      ) : null}

      {/* Error tooltip */}
      {error && !showUnsupportedNotice ? (
        <div
          className="fixed right-16 bottom-[5.75rem] z-50 max-w-[15rem] rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-[0.75rem] text-red-500 shadow-lg backdrop-blur-md"
          style={{ animation: "var(--animate-rise)" }}
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="leading-relaxed">{error}</p>
          </div>
        </div>
      ) : null}

      {/* Unsupported platform notice */}
      {showUnsupportedNotice ? (
        <div
          className="fixed right-16 bottom-[5.75rem] z-50 max-w-[15rem] rounded-xl border border-accent/20 bg-surface/90 p-3 text-[0.75rem] text-fg shadow-lg backdrop-blur-md"
          style={{ animation: "var(--animate-rise)" }}
        >
          <div className="flex items-start gap-2">
            <Mic className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            <p className="leading-relaxed">
              Listen & Follow (Offline Speech Recognition) is currently supported on Desktop platforms.
            </p>
          </div>
        </div>
      ) : null}

      {/* FAB */}
      <button
        className={fabClass}
        onClick={handleClick}
        disabled={disabled}
        aria-label={
          isListening
            ? "Stop listening"
            : isDownloading
              ? "Downloading speech model…"
              : "Listen & follow my recitation"
        }
        title={
          disabled
            ? "Stop playback first to use Listen & Follow"
            : error ?? undefined
        }
      >
        {/* Progress ring during download */}
        {isDownloading ? (
          <svg className="listen-progress-ring" viewBox="0 0 54 54">
            <circle className="listen-progress-ring__track" cx="27" cy="27" r="24" />
            <circle
              className="listen-progress-ring__fill"
              cx="27"
              cy="27"
              r="24"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
            />
          </svg>
        ) : null}

        {/* Icon */}
        {error ? (
          <AlertCircle className="size-5" aria-hidden />
        ) : isDownloading ? (
          <Download className="size-5 animate-pulse" aria-hidden />
        ) : isListening ? (
          <Mic className="size-5" aria-hidden />
        ) : (
          <MicOff className="size-5" aria-hidden />
        )}
      </button>
    </>
  );
}
