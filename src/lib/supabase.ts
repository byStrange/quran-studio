import { createClient, type Session } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. " +
      "Copy .env.example to .env and fill it in.",
  );
}

/**
 * The only Supabase client the app uses. It carries the publishable key, so
 * every query is subject to Row Level Security and can only ever touch the
 * signed-in user's own rows.
 */
export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // desktop app: no OAuth redirect handling in v1
  },
});

/** Where supabase-js keeps the session, by its default naming. */
const SESSION_STORAGE_KEY = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;

/**
 * The session as stored on disk, without asking the server about it.
 *
 * Offline, an expired access token can't be refreshed, and `getSession()`
 * answers "no session" — which would put the sign-in screen in front of a
 * reader who downloaded the Quran precisely to read it without a connection.
 * The stored session is still the user's; the client keeps it and refreshes
 * it once the network is back, so reading it here only bridges the gap.
 */
export function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session | { currentSession?: Session };
    const session = "access_token" in parsed ? parsed : parsed.currentSession;
    return session?.user ? session : null;
  } catch {
    return null;
  }
}
