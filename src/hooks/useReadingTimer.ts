import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

/** Stop counting after this long without any interaction. */
const IDLE_AFTER_MS = 90_000;
/** How often accumulated time is written to the server. */
const FLUSH_EVERY_MS = 60_000;
const TICK_MS = 1_000;

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "scroll", "touchstart"];

interface ReadingTimer {
  /** Seconds counted during this mount, for the live display. */
  sessionSeconds: number;
  /** True when the timer has paused itself because the user went quiet. */
  idle: boolean;
}

/**
 * Counts time the user actually spends reading and rolls it up server-side.
 *
 * The timer only advances while the window is visible and the user has
 * interacted recently, so leaving the app open overnight does not manufacture
 * a reading streak. Accumulated seconds are flushed periodically and on
 * unmount, since an unflushed desktop session would otherwise be lost on quit.
 */
export function useReadingTimer(rukuNumber: number | null): ReadingTimer {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [idle, setIdle] = useState(false);

  const lastActivity = useRef(Date.now());
  const pending = useRef(0);
  const startedAt = useRef(new Date());
  // Kept in a ref so the flush on unmount reports the ruku that was open.
  const currentRuku = useRef(rukuNumber);
  currentRuku.current = rukuNumber;

  useEffect(() => {
    if (!user) return;

    const markActive = () => {
      lastActivity.current = Date.now();
      setIdle(false);
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const flush = async () => {
      const seconds = Math.floor(pending.current);
      if (seconds <= 0) return;
      pending.current -= seconds;
      try {
        await supabase.rpc("log_reading", {
          p_seconds: seconds,
          p_ruku_number: currentRuku.current ?? undefined,
          p_started_at: startedAt.current.toISOString(),
        });
        startedAt.current = new Date();
        queryClient.invalidateQueries({ queryKey: ["streak"] });
        queryClient.invalidateQueries({ queryKey: ["reading-overview"] });
        queryClient.invalidateQueries({ queryKey: ["reading-history"] });
      } catch {
        // Put the time back so a network blip doesn't silently lose it.
        pending.current += seconds;
      }
    };

    const tick = window.setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - lastActivity.current > IDLE_AFTER_MS) {
        setIdle(true);
        return;
      }
      pending.current += TICK_MS / 1000;
      setSessionSeconds((s) => s + TICK_MS / 1000);
    }, TICK_MS);

    const flushTimer = window.setInterval(flush, FLUSH_EVERY_MS);
    // A desktop window close fires pagehide, not unmount.
    const onHide = () => void flush();
    window.addEventListener("pagehide", onHide);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
      window.removeEventListener("pagehide", onHide);
      window.clearInterval(tick);
      window.clearInterval(flushTimer);
      void flush();
    };
  }, [user, queryClient]);

  return { sessionSeconds, idle };
}
