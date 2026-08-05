import { createClient } from "@supabase/supabase-js";
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
