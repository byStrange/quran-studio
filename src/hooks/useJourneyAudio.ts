import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mirrorAudioUrl } from "@/lib/audioMirror";
import { useSurahDownload } from "@/hooks/useAudioDownloads";
import {
  useActiveReciter,
  useRecitationFile,
  useRecitationTimings,
  useReciters,
} from "@/hooks/useRecitation";
import { useUiPrefs } from "@/hooks/useProfile";
import type { RecitationTiming } from "@/lib/types";

/**
 * The reciter, as a Journey scene uses them.
 *
 * The reader's player (`useRecitationPlayer`) is a transport: one passage, a
 * playhead, repeat modes. A lesson wants something else — "recite these ayahs
 * and tell me when you are done", "say this one word" — asked for over and
 * over by different scenes, each of which needs to know when the clip ended so
 * it can move on. So this plays *clips* out of the same continuous surah
 * recording and answers each request with a promise.
 */
export interface JourneyAudio {
  /**
   * Whether it is known yet if there is a recording. False only while that is
   * still being looked up; a lesson waits for it, so that "play" pressed in
   * the first second is not mistaken for a passage with no sound.
   */
  ready: boolean;
  /** There is a recording and timings for this passage. */
  available: boolean;
  /** A clip was asked for and is not audible yet. */
  loading: boolean;
  playing: boolean;
  /** The recording could not be loaded from anywhere. */
  failed: boolean;
  /** The ayah being recited, while a clip of whole ayahs plays. */
  currentVerseId: number | null;
  /** Position of the word being recited within `currentVerseId`. */
  currentWordPosition: number | null;
  rate: number;
  setRate: (rate: number) => void;
  /**
   * Recites consecutive ayahs. Resolves true when the clip played to its end,
   * false when it was interrupted, replaced by another clip, or failed.
   */
  playVerses: (verseIds: number[]) => Promise<boolean>;
  /** Says one word. Resolves like `playVerses`. */
  playWord: (verseId: number, position: number) => Promise<boolean>;
  /** Whether `playWord` has anything to play for this word. */
  hasWord: (verseId: number, position: number) => boolean;
  stop: () => void;
}

/**
 * A single word's span is cut tight to the word, and played exactly it sounds
 * clipped. A little air on each side is what makes it sound said.
 */
const WORD_LEAD_MS = 40;
const WORD_TAIL_MS = 90;

/** How long the CDN gets to produce the recording's header before the relay is tried. */
const CDN_PATIENCE_MS = 4000;

/** Once the CDN has failed and the relay worked, later surahs start there. */
let preferRelay = false;

interface Clip {
  startMs: number;
  endMs: number;
  /** The ayahs to follow along with, for a clip of whole ayahs. */
  spans: RecitationTiming[];
  /** What to show as current for a clip of one word. */
  fixed: { verseId: number; position: number } | null;
  resolve: (finished: boolean) => void;
}

export function useJourneyAudio(surahNumber: number | null, verseIds: number[]): JourneyAudio {
  const prefs = useUiPrefs();
  const reciter = useActiveReciter(prefs.reciterId);
  const reciterId = reciter?.id ?? null;
  const reciters = useReciters();
  const recitationQuery = useRecitationFile(reciterId, surahNumber);
  const timingsQuery = useRecitationTimings(reciterId, verseIds);
  const recitation = recitationQuery.data;
  const timings = timingsQuery.data;
  const download = useSurahDownload({
    reciterId,
    surahNumber,
    url: recitation?.audio_url ?? null,
    fileSize: recitation?.file_size ?? null,
  });

  // A downloaded copy is the first choice — it is what works with no network.
  const src = download.ready ? (download.localSrc ?? recitation?.audio_url ?? null) : null;
  const relay = useMemo(() => mirrorAudioUrl(src), [src]);
  const [cdnFailedFor, setCdnFailedFor] = useState<string | null>(null);
  const [relayFailedFor, setRelayFailedFor] = useState<string | null>(null);
  const useRelay = relay !== null && relayFailedFor !== src && (cdnFailedFor === src || preferRelay);
  const activeSrc = useRelay ? relay : src;

  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [currentVerseId, setCurrentVerseId] = useState<number | null>(null);
  const [currentWordPosition, setCurrentWordPosition] = useState<number | null>(null);
  const [rate, setRateState] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipRef = useRef<Clip | null>(null);
  const timingsRef = useRef(timings);
  timingsRef.current = timings;
  const sourcesRef = useRef({ src, relay, activeSrc, cdnFailedFor, relayFailedFor });
  sourcesRef.current = { src, relay, activeSrc, cdnFailedFor, relayFailedFor };
  // Whether the loaded source has delivered metadata: before that a seek is
  // dropped, and an error means the host is unreachable rather than the
  // stream having broken mid-clip.
  const metadataRef = useRef(false);
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const finish = useCallback((finished: boolean) => {
    const clip = clipRef.current;
    clipRef.current = null;
    setPlaying(false);
    setLoading(false);
    setCurrentVerseId(null);
    setCurrentWordPosition(null);
    clip?.resolve(finished);
  }, []);

  /** Starts (or restarts, after a change of source) the clip in `clipRef`. */
  const begin = useCallback(() => {
    const audio = audioRef.current;
    const clip = clipRef.current;
    if (!audio || !clip) return;
    if (!metadataRef.current) {
      // `loadedmetadata` calls back in here once seeking means something.
      setLoading(true);
      return;
    }
    audio.currentTime = clip.startMs / 1000;
    audio.playbackRate = rateRef.current;
    setLoading(true);
    void audio.play().catch(() => {
      // Autoplay refused, or the clip was replaced before it began. Only the
      // clip this play() belonged to is ended by it.
      if (clipRef.current === clip && audio.paused) finish(false);
    });
  }, [finish]);

  // --- the element ---------------------------------------------------------

  useEffect(() => {
    const audio = new Audio();
    // The whole file, not just its header: a lesson jumps around the recording
    // a word at a time, and each jump into an unbuffered part is a pause
    // exactly where the scene wants a word to answer a tap.
    audio.preload = "auto";
    audioRef.current = audio;

    const onLoaded = () => {
      metadataRef.current = true;
      const { src: cdn, relay: alternate, activeSrc: current, cdnFailedFor: cdnFailed } =
        sourcesRef.current;
      if (alternate !== null && current === alternate && cdnFailed === cdn) preferRelay = true;
      if (clipRef.current) begin();
    };
    const onPlaying = () => {
      setLoading(false);
      if (clipRef.current) setPlaying(true);
    };
    const onWaiting = () => {
      if (clipRef.current) setLoading(true);
    };
    const onEnded = () => {
      if (clipRef.current) finish(true);
    };
    const onError = () => {
      const {
        src: cdn,
        relay: alternate,
        activeSrc: current,
        cdnFailedFor: cdnFailed,
        relayFailedFor: relayFailed,
      } = sourcesRef.current;
      if (!metadataRef.current && cdn !== null && alternate !== null) {
        // The pending clip is kept: the source effect loads the other route
        // and `loadedmetadata` starts the clip from there.
        if (current === cdn && relayFailed !== cdn) {
          setCdnFailedFor(cdn);
          return;
        }
        if (current === alternate && cdnFailed !== cdn) {
          preferRelay = false;
          setRelayFailedFor(cdn);
          return;
        }
      }
      setFailed(true);
      finish(false);
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
      const clip = clipRef.current;
      clipRef.current = null;
      clip?.resolve(false);
    };
  }, [begin, finish]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeSrc) return;
    metadataRef.current = false;
    setFailed(false);
    audio.src = activeSrc;
    audio.load();

    // A blocked CDN does not always refuse the connection; on some networks it
    // simply never answers, and the element waits the better part of a minute
    // before reporting an error. A child will not. If the CDN has said nothing
    // by then, go to the relay without waiting to be told.
    const { src: cdn, relay: alternate, relayFailedFor: relayFailed } = sourcesRef.current;
    if (activeSrc !== cdn || alternate === null || relayFailed === cdn) return;
    const timer = window.setTimeout(() => {
      if (!metadataRef.current) setCdnFailedFor(cdn);
    }, CDN_PATIENCE_MS);
    return () => window.clearTimeout(timer);
  }, [activeSrc]);

  // --- following along -----------------------------------------------------

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const audio = audioRef.current;
      const clip = clipRef.current;
      if (!audio || !clip) return;
      const ms = audio.currentTime * 1000;

      if (ms >= clip.endMs) {
        audio.pause();
        finish(true);
        return;
      }

      if (clip.fixed) return;

      // The last ayah to have started, so the highlight holds through the
      // small silences recordings leave between ayahs instead of blinking.
      let active: RecitationTiming | null = null;
      for (const span of clip.spans) {
        if (span.startMs <= ms) active = span;
        else break;
      }
      if (!active) return;
      setCurrentVerseId(active.verseId);
      // Which span contains the playhead, not "the next one along": a reciter
      // who repeats a phrase revisits positions already sung.
      const word = active.segments.find((s) => ms >= s.startMs && ms < s.endMs);
      // Between two words the last one stays lit; going dark for the length of
      // a breath reads as a flicker.
      if (word) setCurrentWordPosition(word.position);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, finish]);

  // --- clips ---------------------------------------------------------------

  const start = useCallback(
    (clip: Omit<Clip, "resolve">): Promise<boolean> => {
      const audio = audioRef.current;
      if (!audio || !sourcesRef.current.activeSrc) return Promise.resolve(false);
      // A new clip replaces the one in flight, which reports "not finished".
      const previous = clipRef.current;
      clipRef.current = null;
      if (previous) {
        audio.pause();
        previous.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        clipRef.current = { ...clip, resolve };
        setCurrentVerseId(clip.fixed?.verseId ?? clip.spans[0]?.verseId ?? null);
        setCurrentWordPosition(clip.fixed?.position ?? null);
        // After a failed load, asking again is the retry.
        if (audio.error) {
          metadataRef.current = false;
          setFailed(false);
          setLoading(true);
          audio.load();
          return;
        }
        begin();
      });
    },
    [begin],
  );

  const playVerses = useCallback(
    (ids: number[]): Promise<boolean> => {
      const map = timingsRef.current;
      if (!map) return Promise.resolve(false);
      const spans = ids
        .map((id) => map.get(id))
        .filter((span): span is RecitationTiming => span !== undefined);
      if (spans.length === 0) return Promise.resolve(false);
      return start({
        startMs: spans[0]!.startMs,
        endMs: spans[spans.length - 1]!.endMs,
        spans,
        fixed: null,
      });
    },
    [start],
  );

  const findWord = useCallback((verseId: number, position: number) => {
    const span = timingsRef.current?.get(verseId);
    const segment = span?.segments.find((s) => s.position === position);
    return span && segment ? { span, segment } : null;
  }, []);

  const playWord = useCallback(
    (verseId: number, position: number): Promise<boolean> => {
      const found = findWord(verseId, position);
      if (!found) return Promise.resolve(false);
      return start({
        // Padded, but never out of the ayah: the neighbouring ayah's last
        // syllable is not part of this word.
        startMs: Math.max(found.segment.startMs - WORD_LEAD_MS, found.span.startMs),
        endMs: Math.min(found.segment.endMs + WORD_TAIL_MS, found.span.endMs),
        spans: [],
        fixed: { verseId, position },
      });
    },
    [findWord, start],
  );

  const hasWord = useCallback(
    (verseId: number, position: number) => findWord(verseId, position) !== null,
    [findWord],
  );

  const stop = useCallback(() => {
    audioRef.current?.pause();
    if (clipRef.current) finish(false);
  }, [finish]);

  const setRate = useCallback((next: number) => {
    setRateState(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  const available =
    Boolean(activeSrc) && Boolean(timings) && verseIds.some((id) => timings!.has(id));
  // Settled either way: found, found to be missing, or failed to load.
  const ready =
    !reciters.isPending &&
    (reciterId === null ||
      verseIds.length === 0 ||
      (!recitationQuery.isPending && !timingsQuery.isPending && download.ready));

  return useMemo(
    () => ({
      ready,
      available,
      loading,
      playing,
      failed,
      currentVerseId,
      currentWordPosition,
      rate,
      setRate,
      playVerses,
      playWord,
      hasWord,
      stop,
    }),
    [
      ready,
      available,
      loading,
      playing,
      failed,
      currentVerseId,
      currentWordPosition,
      rate,
      setRate,
      playVerses,
      playWord,
      hasWord,
      stop,
    ],
  );
}
