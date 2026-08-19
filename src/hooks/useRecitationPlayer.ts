import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecitationTiming, RepeatMode } from "@/lib/types";

export interface RecitationPlayer {
  /** Whether there is audio to play at all. */
  available: boolean;
  loading: boolean;
  error: string | null;
  playing: boolean;
  /** The ayah being recited, or null before playback starts. */
  currentVerseId: number | null;
  /** Position of the word being recited within `currentVerseId`. */
  currentWordPosition: number | null;
  /** Progress through the selected passage, 0–1. */
  progress: number;
  /** Seconds elapsed and total, for the passage rather than the whole surah. */
  elapsed: number;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jumps to an ayah and plays from there. */
  playVerse: (verseId: number) => void;
  next: () => void;
  previous: () => void;
  /** Seeks within the passage, 0–1. */
  seekFraction: (fraction: number) => void;
}

/**
 * Plays a passage out of one continuous surah recording.
 *
 * The recording is the whole surah, but a lesson is a ruku, so "the passage"
 * is a window into the file: seek to the first ayah's offset, stop at the last
 * ayah's. Nothing is cut or concatenated, which is the point — the reciter's
 * phrasing across ayah boundaries survives, and a ruku that begins mid-breath
 * sounds the way the reciter actually recited it.
 *
 * Following along is driven by an animation frame rather than the element's
 * own `timeupdate`, which fires about four times a second — fine for a
 * progress bar, far too coarse to light up individual words.
 */
export function useRecitationPlayer({
  src,
  verseIds,
  timings,
  rate,
  repeatMode,
  onVerseChange,
}: {
  src: string | null;
  /** The passage's ayahs, in recitation order. */
  verseIds: number[];
  timings: Map<number, RecitationTiming> | undefined;
  rate: number;
  repeatMode: RepeatMode;
  onVerseChange?: (verseId: number) => void;
}): RecitationPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [currentVerseId, setCurrentVerseId] = useState<number | null>(null);
  const [currentWordPosition, setCurrentWordPosition] = useState<number | null>(null);

  /** The passage's timings in play order, with any missing ayah dropped. */
  const ordered = useMemo(() => {
    if (!timings) return [];
    return verseIds
      .map((id) => timings.get(id))
      .filter((timing): timing is RecitationTiming => timing !== undefined);
  }, [verseIds, timings]);

  const start = ordered[0]?.startMs ?? 0;
  const end = ordered[ordered.length - 1]?.endMs ?? 0;
  const available = Boolean(src) && ordered.length > 0;

  // Mirrors `currentVerseId` for the animation loop, which reads it every
  // frame and must not re-subscribe on every ayah change.
  const currentVerseIdRef = useRef<number | null>(null);
  currentVerseIdRef.current = currentVerseId;

  // Which ayah is being drilled when repeat is set to a single ayah. Pinned on
  // the ayah that was playing when the mode was chosen, so turning repeat on
  // mid-ayah loops that one rather than whichever the playhead drifts into.
  // Deliberately keyed on the mode alone: re-pinning as the playhead moves
  // would make "repeat this ayah" mean "repeat whichever ayah is current",
  // which never stops on the one the reader picked.
  const repeatVerseRef = useRef<number | null>(null);
  useEffect(() => {
    repeatVerseRef.current = repeatMode === "ayah" ? currentVerseIdRef.current : null;
  }, [repeatMode]);

  // A seek asked for before the element knows its duration is silently
  // dropped, so it is held until metadata arrives.
  const pendingSeekRef = useRef<number | null>(null);

  const seekMs = useCallback((ms: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.readyState === 0) {
      pendingSeekRef.current = ms;
      return;
    }
    audio.currentTime = ms / 1000;
    setCurrentMs(ms);
  }, []);

  // --- the element ---------------------------------------------------------

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onLoaded = () => {
      setLoading(false);
      const pending = pendingSeekRef.current;
      if (pending !== null) {
        pendingSeekRef.current = null;
        audio.currentTime = pending / 1000;
      }
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onError = () =>
      setError("Couldn't load this recitation. Check your connection and try again.");

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      audioRef.current = null;
    };
  }, []);

  // Changing reciter or surah swaps the file underneath; playback stops and
  // the playhead returns to the top of the passage rather than keeping an
  // offset that meant something in the previous recording.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    setError(null);
    setLoading(true);
    setPlaying(false);
    audio.pause();
    audio.src = src;
    audio.load();
    pendingSeekRef.current = start;
    setCurrentMs(start);
    setCurrentVerseId(null);
    setCurrentWordPosition(null);
  }, [src, start]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
  }, [rate]);

  // --- the follow loop -----------------------------------------------------

  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const repeatRef = useRef(repeatMode);
  repeatRef.current = repeatMode;
  const boundsRef = useRef({ start, end });
  boundsRef.current = { start, end };
  const verseChangeRef = useRef(onVerseChange);
  verseChangeRef.current = onVerseChange;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const audio = audioRef.current;
      if (!audio) return;

      const ms = audio.currentTime * 1000;
      const spans = orderedRef.current;
      const bounds = boundsRef.current;
      if (spans.length === 0) return;

      // Repeat of a single ayah loops that ayah's own span, which is a
      // tighter boundary than the passage's and so is checked first.
      const repeatVerse = repeatVerseRef.current;
      if (repeatRef.current === "ayah" && repeatVerse !== null) {
        const span = spans.find((s) => s.verseId === repeatVerse);
        if (span && ms >= span.endMs) {
          audio.currentTime = span.startMs / 1000;
          return;
        }
      }

      if (ms >= bounds.end) {
        if (repeatRef.current === "range") {
          audio.currentTime = bounds.start / 1000;
          return;
        }
        audio.pause();
        setPlaying(false);
        audio.currentTime = bounds.start / 1000;
        setCurrentMs(bounds.start);
        setCurrentVerseId(null);
        setCurrentWordPosition(null);
        return;
      }

      setCurrentMs(ms);

      // The last ayah to have started, rather than the one strictly containing
      // the playhead: recordings leave small gaps between ayahs, and holding
      // the highlight through them beats blinking it off and on.
      let active: RecitationTiming | null = null;
      for (const span of spans) {
        if (span.startMs <= ms) active = span;
        else break;
      }

      if (active) {
        if (active.verseId !== currentVerseIdRef.current) {
          currentVerseIdRef.current = active.verseId;
          setCurrentVerseId(active.verseId);
          verseChangeRef.current?.(active.verseId);
        }
        // Spans can revisit a position when the reciter repeats a phrase, so
        // this asks which span contains the playhead rather than assuming
        // positions only move forward.
        const word = active.segments.find((s) => ms >= s.startMs && ms < s.endMs);
        setCurrentWordPosition(word ? word.position : null);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // --- controls ------------------------------------------------------------

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !available) return;
    const { start: from, end: to } = boundsRef.current;
    // Landing outside the passage means the playhead belongs to a previous
    // selection; restart rather than play something the reader did not choose.
    const ms = audio.currentTime * 1000;
    if (ms < from || ms >= to) {
      seekMs(from);
    }
    void audio.play().catch(() => {
      setError("Playback was blocked. Try pressing play again.");
      setPlaying(false);
    });
    setPlaying(true);
  }, [available, seekMs]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, pause, play]);

  const playVerse = useCallback(
    (verseId: number) => {
      const span = orderedRef.current.find((s) => s.verseId === verseId);
      if (!span) return;
      if (repeatRef.current === "ayah") repeatVerseRef.current = verseId;
      currentVerseIdRef.current = verseId;
      setCurrentVerseId(verseId);
      seekMs(span.startMs);
      const audio = audioRef.current;
      if (!audio) return;
      void audio.play().catch(() => setPlaying(false));
      setPlaying(true);
    },
    [seekMs],
  );

  const step = useCallback(
    (delta: number) => {
      const spans = orderedRef.current;
      if (spans.length === 0) return;
      const index = spans.findIndex((s) => s.verseId === currentVerseIdRef.current);
      const nextIndex = Math.min(Math.max((index < 0 ? 0 : index) + delta, 0), spans.length - 1);
      playVerse(spans[nextIndex]!.verseId);
    },
    [playVerse],
  );

  const next = useCallback(() => step(1), [step]);
  const previous = useCallback(() => step(-1), [step]);

  const seekFraction = useCallback(
    (fraction: number) => {
      const { start: from, end: to } = boundsRef.current;
      const clamped = Math.min(Math.max(fraction, 0), 1);
      seekMs(from + (to - from) * clamped);
    },
    [seekMs],
  );

  const span = Math.max(end - start, 1);
  const elapsedMs = Math.min(Math.max(currentMs - start, 0), span);

  return {
    available,
    loading,
    error,
    playing,
    currentVerseId,
    currentWordPosition,
    progress: elapsedMs / span,
    elapsed: elapsedMs / 1000,
    duration: span / 1000,
    play,
    pause,
    toggle,
    playVerse,
    next,
    previous,
    seekFraction,
  };
}
