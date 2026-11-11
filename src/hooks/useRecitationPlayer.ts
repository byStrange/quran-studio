import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mirrorAudioUrl } from "@/lib/audioMirror";
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
 * Set once the CDN has failed and the relay worked around it, so later surahs
 * go straight to the relay rather than each waiting on a connection that is
 * going to be refused (Chromium takes about five seconds to give up on one).
 * Cleared again if the relay fails and the CDN then works, so neither an
 * outage of the relay nor moving to an unblocked network strands the reader.
 * Module-level so it lasts the session rather than one reader.
 */
let preferRelay = false;

const LOAD_FAILED = "Couldn't load this recitation. Check your connection and try again.";

/** MediaError.MEDIA_ERR_DECODE: the file arrived but is broken — the relay serves the same bytes. */
const MEDIA_ERR_DECODE = 3;

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
  sourceKey,
  verseIds,
  timings,
  rate,
  repeatMode,
  repeatUnmemorizedVerseIds,
  onVerseChange,
}: {
  /**
   * The recording: a CDN URL, or a local file. A CDN URL that fails to load
   * is retried through the relay (see `mirrorAudioUrl`).
   */
  src: string | null;
  /**
   * Names the recording `src` points at, independent of where it is served
   * from. When `src` changes but this doesn't — a stream replaced by the copy
   * just downloaded — playback carries on from the same place.
   */
  sourceKey?: string;
  /** The passage's ayahs, in recitation order. */
  verseIds: number[];
  timings: Map<number, RecitationTiming> | undefined;
  rate: number;
  repeatMode: RepeatMode;
  /**
   * The passage's ayahs that are not marked memorized, in recitation order.
   * Only consulted by `repeatMode: "unmemorized"`, which loops these and
   * skips everything else.
   */
  repeatUnmemorizedVerseIds?: number[];
  onVerseChange?: (verseId: number) => void;
}): RecitationPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [currentVerseId, setCurrentVerseId] = useState<number | null>(null);
  const [currentWordPosition, setCurrentWordPosition] = useState<number | null>(null);

  // --- which source --------------------------------------------------------

  // Which `src` each route has already failed for. Keyed by `src` so a new
  // surah starts with a clean slate.
  const [cdnFailedFor, setCdnFailedFor] = useState<string | null>(null);
  const [relayFailedFor, setRelayFailedFor] = useState<string | null>(null);
  // Bumped by pressing play after a failed load, to reload the same source.
  const [retry, setRetry] = useState(0);
  const relay = useMemo(() => mirrorAudioUrl(src), [src]);
  const useRelay =
    relay !== null && relayFailedFor !== src && (cdnFailedFor === src || preferRelay);
  const activeSrc = useRelay ? relay : src;

  // Read by the element's handlers, which are attached once.
  const sourcesRef = useRef({ src, relay, activeSrc, cdnFailedFor, relayFailedFor });
  sourcesRef.current = { src, relay, activeSrc, cdnFailedFor, relayFailedFor };
  // Set between one route failing and the other being loaded, so the failure
  // is not reported and a play that was under way carries on.
  const switchingRef = useRef(false);
  // Bumped whenever a route fails over. A `play()` promise rejects a moment
  // after the error event that caused it — sometimes after React has already
  // loaded the other route — so a rejection is only acted on if no failover
  // has happened since that `play()` was called.
  const failoverRef = useRef(0);
  const playAttempt = useCallback((onRejected: () => void) => {
    const audio = audioRef.current;
    if (!audio) return;
    const attempt = failoverRef.current;
    void audio.play().catch(() => {
      if (failoverRef.current === attempt) onRejected();
    });
  }, []);
  // Whether the current source has delivered metadata. An error after that is
  // a stream dropping mid-recitation, not a host that can't be reached, and
  // switching routes would not be the fix.
  const metadataRef = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = playing;

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
      metadataRef.current = true;
      const { src: cdn, relay: alternate, activeSrc: current, cdnFailedFor: cdnFailed } =
        sourcesRef.current;
      if (alternate !== null && current === alternate && cdnFailed === cdn) preferRelay = true;
      setLoading(false);
      const pending = pendingSeekRef.current;
      if (pending !== null) {
        pendingSeekRef.current = null;
        audio.currentTime = pending / 1000;
      }
    };
    const onWaiting = () => setLoading(true);
    const onPlaying = () => setLoading(false);
    const onError = () => {
      const {
        src: cdn,
        relay: alternate,
        activeSrc: current,
        cdnFailedFor: cdnFailed,
        relayFailedFor: relayFailed,
      } = sourcesRef.current;
      const unreachable = !metadataRef.current && audio.error?.code !== MEDIA_ERR_DECODE;
      if (unreachable && cdn !== null && alternate !== null) {
        // The CDN failed: try the relay, unless it has already failed too.
        if (current === cdn && relayFailed !== cdn) {
          switchingRef.current = true;
          failoverRef.current += 1;
          setCdnFailedFor(cdn);
          return;
        }
        // The relay failed without the CDN having been tried for this surah
        // (it was skipped on the session's say-so): try the CDN after all.
        if (current === alternate && cdnFailed !== cdn) {
          preferRelay = false;
          switchingRef.current = true;
          failoverRef.current += 1;
          setRelayFailedFor(cdn);
          return;
        }
      }
      switchingRef.current = false;
      setLoading(false);
      setError(LOAD_FAILED);
    };

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
  const loadedRef = useRef<{ sourceKey: string | undefined; start: number } | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeSrc) return;
    const previous = loadedRef.current;
    // A play that was cut short by one route failing should resume on the
    // other.
    const resume = switchingRef.current && playingRef.current;
    switchingRef.current = false;
    loadedRef.current = { sourceKey, start };
    setError(null);

    // Same recording from a new place: keep the playhead and keep playing.
    if (
      previous &&
      sourceKey !== undefined &&
      previous.sourceKey === sourceKey &&
      previous.start === start
    ) {
      const wasPlaying = !audio.paused || resume;
      // Before metadata, currentTime is a meaningless 0 and the real target
      // is the seek still waiting for it (the passage start, or the reader's).
      if (audio.readyState > 0) pendingSeekRef.current = audio.currentTime * 1000;
      metadataRef.current = false;
      audio.src = activeSrc;
      audio.load();
      if (wasPlaying) {
        setLoading(true);
        playAttempt(() => setPlaying(false));
      }
      return;
    }

    setLoading(true);
    setPlaying(false);
    audio.pause();
    metadataRef.current = false;
    audio.src = activeSrc;
    audio.load();
    pendingSeekRef.current = start;
    setCurrentMs(start);
    setCurrentVerseId(null);
    setCurrentWordPosition(null);
  }, [activeSrc, start, sourceKey, retry, playAttempt]);

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
  const unmemorizedRef = useRef<number[]>([]);
  unmemorizedRef.current = repeatUnmemorizedVerseIds ?? [];

  /** The passage's not-yet-memorized ayahs, as spans, in play order. */
  const unmemorizedSpans = useCallback(() => {
    const spans = orderedRef.current;
    const ids = unmemorizedRef.current;
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return spans.filter((s) => wanted.has(s.verseId));
  }, []);

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

      // "Unmemorized" hops over the ayahs already known and loops the rest. A
      // jump rather than a skip is what makes it a drill: the reciter's voice
      // resumes exactly at the ayah being learned.
      if (repeatRef.current === "unmemorized") {
        const targets = unmemorizedSpans();
        if (targets.length > 0) {
          let current: RecitationTiming | null = null;
          for (const target of targets) {
            if (target.startMs <= ms) current = target;
          }
          // Playhead before the first one, or past the end of the one it is in.
          if (current === null) {
            audio.currentTime = targets[0]!.startMs / 1000;
            return;
          }
          if (ms >= current.endMs) {
            const at = targets.indexOf(current);
            audio.currentTime = targets[(at + 1) % targets.length]!.startMs / 1000;
            return;
          }
        }
      }

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
        // "Unmemorized" with nothing left to drill is the passage loop — the
        // alternative would be stopping at the end while the control claims to
        // repeat, which is the one thing a repeat control must not do.
        const loopsPassage =
          repeatRef.current === "range" ||
          (repeatRef.current === "unmemorized" && unmemorizedSpans().length === 0);
        if (loopsPassage) {
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
  }, [playing, unmemorizedSpans]);

  // --- controls ------------------------------------------------------------

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !available) return;
    const { start: from, end: to } = boundsRef.current;
    // Landing outside the passage means the playhead belongs to a previous
    // selection; restart rather than play something the reader did not choose.
    const ms = audio.currentTime * 1000;
    const targets = repeatRef.current === "unmemorized" ? unmemorizedSpans() : [];
    if (targets.length > 0 && !targets.some((t) => ms >= t.startMs && ms < t.endMs)) {
      // The mode means "drill what isn't memorized", so play starts on the
      // first such ayah whenever the playhead is sitting on a known one.
      seekMs(targets[0]!.startMs);
    } else if (ms < from || ms >= to) {
      seekMs(from);
    }
    // After a failed load, pressing play is the "try again" the error asks
    // for: forget which routes failed and have the source effect load afresh
    // and resume, rather than calling play() on an element that can only
    // reject. Loading here directly would race that effect, which may be
    // about to swap routes and would abort this play.
    if (audio.error) {
      setCdnFailedFor(null);
      setRelayFailedFor(null);
      switchingRef.current = true;
      failoverRef.current += 1;
      setRetry((n) => n + 1);
      setPlaying(true);
      return;
    }
    playAttempt(() => {
      setError(audio.error ? LOAD_FAILED : "Playback was blocked. Try pressing play again.");
      setPlaying(false);
    });
    setPlaying(true);
  }, [available, seekMs, unmemorizedSpans, playAttempt]);

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
      playAttempt(() => setPlaying(false));
      setPlaying(true);
    },
    [seekMs, playAttempt],
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
