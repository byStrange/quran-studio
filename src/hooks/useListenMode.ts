import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { QuranMatcher, type MatchResult, type MatcherState } from "@/lib/quranMatcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListenModeState {
  /** Current lifecycle state of listen mode. */
  status: "idle" | "requesting" | "listening" | "error";
  /** The verse the matcher currently believes the user is reciting. */
  matchedVerseId: number | null;
  /** How confident the matcher is (0–1). */
  confidence: number;
  /** Internal matcher state, for the UI indicator. */
  matcherState: MatcherState;
  /** Whether local Whisper AI is supported on this platform/target. */
  isSupported: boolean;
  /** Whether the Whisper GGML model is downloaded and ready. */
  modelReady: boolean;
  /** Last recognised text snippet, for visual feedback. */
  transcript: string;
  error: string | null;
  /** Start listening. Requests mic permission and begins recognition. */
  start: () => Promise<void>;
  /** Stop listening. Releases mic and cleans up. */
  stop: () => void;
  /** Download the Whisper model (~75 MB, one-time). */
  downloadModel: () => Promise<boolean>;
  /** 0–1 during model download, null otherwise. */
  modelDownloadProgress: number | null;
}

interface VerseInput {
  id: number;
  surah_number: number;
  ayah_number: number;
  arabic_text: string;
}

interface WhisperStatusResponse {
  downloaded: boolean;
  model_size_bytes: number | null;
  ready: boolean;
  supported?: boolean;
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------

/**
 * Target sample rate for Whisper. The model expects 16 kHz mono f32 PCM.
 * The browser typically captures at 44.1 or 48 kHz, so we resample.
 */
const TARGET_SAMPLE_RATE = 16_000;

/** How many seconds of audio to accumulate before sending a chunk. */
const CHUNK_SECONDS = 3;

/**
 * Downsample a Float32Array from one sample rate to another using simple
 * linear interpolation. Not audiophile quality, but Whisper is tolerant —
 * it just needs roughly correct timing, not perfect spectral fidelity.
 */
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIndex = i * ratio;
    const lo = Math.floor(srcIndex);
    const hi = Math.min(lo + 1, buffer.length - 1);
    const frac = srcIndex - lo;
    result[i] = buffer[lo]! * (1 - frac) + buffer[hi]! * frac;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Listen mode: captures audio from the microphone, runs local Whisper
 * inference via the Tauri backend, and feeds the recognised text to a
 * QuranMatcher to identify which verse the user is reciting.
 *
 * No audio is stored or transmitted — each 3-second chunk is sent to the
 * Rust backend, transcribed in memory, and discarded.
 */
export function useListenMode(verses: VerseInput[]): ListenModeState {
  const [status, setStatus] = useState<ListenModeState["status"]>("idle");
  const [matchedVerseId, setMatchedVerseId] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(0);
  const [matcherState, setMatcherState] = useState<MatcherState>("searching");
  const [isSupported, setIsSupported] = useState(true);
  const [modelReady, setModelReady] = useState(false);
  const modelReadyRef = useRef(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number | null>(null);

  // Refs that persist across renders without triggering re-renders.
  const matcherRef = useRef<QuranMatcher | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const samplesCollected = useRef(0);
  const activeRef = useRef(false);
  /** Prevents overlapping transcription calls. */
  const transcribingRef = useRef(false);

  // Build / rebuild the matcher when the verse set changes.
  useEffect(() => {
    if (verses.length > 0) {
      matcherRef.current = new QuranMatcher(verses);
    }
  }, [verses]);

  // Check model status on mount.
  useEffect(() => {
    invoke<WhisperStatusResponse>("whisper_status")
      .then((s) => {
        setIsSupported(s.supported ?? true);
        setModelReady(s.downloaded);
        modelReadyRef.current = s.downloaded;
      })
      .catch(() => {
        setIsSupported(false);
        setModelReady(false);
        modelReadyRef.current = false;
      });
  }, []);

  // ------------------------------------------------------------------
  // Model download
  // ------------------------------------------------------------------

  const downloadModel = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      setModelDownloadProgress(0);

      // Listen for progress events from the Rust backend.
      const unlisten = await tauriListen<{ received: number; total: number }>(
        "whisper-download-progress",
        (event) => {
          const { received, total } = event.payload;
          if (total > 0) {
            setModelDownloadProgress(received / total);
          }
        },
      );

      await invoke("whisper_download_model");
      unlisten();
      setModelDownloadProgress(null);
      setModelReady(true);
      modelReadyRef.current = true;
      return true;
    } catch (e) {
      setModelDownloadProgress(null);
      setError(`Model download failed: ${e}`);
      return false;
    }
  }, []);

  // ------------------------------------------------------------------
  // Start / stop
  // ------------------------------------------------------------------

  const stop = useCallback(() => {
    activeRef.current = false;

    // Stop all tracks on the media stream.
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }

    // Disconnect the audio processor.
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // Close the audio context.
    if (contextRef.current) {
      void contextRef.current.close();
      contextRef.current = null;
    }

    bufferRef.current = [];
    samplesCollected.current = 0;
    setStatus("idle");
    setTranscript("");
  }, []);

  const start = useCallback(async () => {
    if (status === "listening" || status === "requesting") return;

    // Check model availability.
    if (!modelReadyRef.current) {
      setError("Whisper model not downloaded. Tap to download first.");
      return;
    }

    setError(null);
    setStatus("requesting");
    setMatchedVerseId(null);
    setConfidence(0);
    setMatcherState("searching");
    matcherRef.current?.reset();

    try {
      // Request microphone access.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: { ideal: TARGET_SAMPLE_RATE },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      // Create an AudioContext to process raw PCM.
      const audioCtx = new AudioContext();
      contextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const nativeSampleRate = audioCtx.sampleRate;

      // How many native samples make up one chunk.
      const samplesPerChunk = Math.round(nativeSampleRate * CHUNK_SECONDS);

      // ScriptProcessorNode is deprecated but universally supported in
      // WebKitGTK and Android WebView. AudioWorklet is better but requires
      // a separate JS file served from the same origin, which is extra
      // plumbing inside Tauri's asset protocol. The processor is only
      // active while listening, so the deprecation cost is acceptable.
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      activeRef.current = true;

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!activeRef.current) return;

        const input = e.inputBuffer.getChannelData(0);
        // Copy the data — the buffer is reused by the browser.
        bufferRef.current.push(new Float32Array(input));
        samplesCollected.current += input.length;

        if (samplesCollected.current >= samplesPerChunk) {
          // Concatenate all buffered chunks into one contiguous array.
          const totalSamples = bufferRef.current.reduce((s, b) => s + b.length, 0);
          const full = new Float32Array(totalSamples);
          let offset = 0;
          for (const chunk of bufferRef.current) {
            full.set(chunk, offset);
            offset += chunk.length;
          }
          bufferRef.current = [];
          samplesCollected.current = 0;

          // Downsample to 16 kHz and send to Whisper.
          const pcm16k = downsample(full, nativeSampleRate, TARGET_SAMPLE_RATE);
          void sendToWhisper(pcm16k);
        }
      };

      source.connect(processor);
      // Connect to destination to keep the graph alive (output is silent).
      processor.connect(audioCtx.destination);

      setStatus("listening");
    } catch (e) {
      stop();
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setError("Microphone permission denied. Please allow access and try again.");
      } else if (e instanceof DOMException && e.name === "NotFoundError") {
        setError("No microphone found. Please connect a microphone and try again.");
      } else {
        setError(`Could not start listening: ${e}`);
      }
      setStatus("error");
    }
  }, [status, modelReady, stop]);

  // ------------------------------------------------------------------
  // Transcription pipeline
  // ------------------------------------------------------------------

  /**
   * Send a chunk of 16 kHz mono PCM to the Tauri backend for Whisper
   * transcription, then feed the result to the QuranMatcher.
   */
  const sendToWhisper = async (pcm: Float32Array) => {
    // Don't overlap — if the previous chunk is still being transcribed,
    // drop this one. Better to skip a chunk than queue them up and fall
    // behind real time.
    if (transcribingRef.current || !activeRef.current) return;
    transcribingRef.current = true;

    try {
      // Tauri IPC serialises typed arrays as regular arrays, so we pass
      // the raw f32 samples directly. whisper-rs expects Vec<f32>.
      const text = await invoke<string>("whisper_transcribe", {
        audioPcm: Array.from(pcm),
      });

      if (!activeRef.current) return;

      // Show the last recognised text briefly for user feedback.
      if (text.trim().length > 0) {
        setTranscript(text.trim());
      }

      // Feed to the matcher.
      const matcher = matcherRef.current;
      if (matcher) {
        const result: MatchResult | null = matcher.feed(text);
        setMatcherState(matcher.state);

        if (result) {
          setMatchedVerseId(result.verseId);
          setConfidence(result.confidence);
        }
      }
    } catch (e) {
      console.error("Whisper transcription error:", e);
      // Don't stop listening on a single transcription failure — the next
      // chunk may work fine.
    } finally {
      transcribingRef.current = false;
    }
  };

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      activeRef.current = false;
      stop();
    };
  }, [stop]);

  return {
    status,
    matchedVerseId,
    confidence,
    matcherState,
    isSupported,
    modelReady,
    transcript,
    error,
    start,
    stop,
    downloadModel,
    modelDownloadProgress,
  };
}
