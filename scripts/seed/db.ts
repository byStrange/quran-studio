import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunk, log } from "./util.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env and fill in the service-role credentials.",
  );
  process.exit(1);
}

/** Service-role client: bypasses RLS, so it is only ever used from these
 *  scripts — never from the app. */
export const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Upserts rows in batches, reporting progress for the long tables.
 *
 * The table name is only known at runtime here, so the generated per-table row
 * types can't be applied; the seed's own interfaces in sources.ts are what
 * keep these payloads honest.
 */
export async function upsertAll<T extends object>(
  table: string,
  rows: readonly T[],
  options: { onConflict: string; size?: number },
): Promise<void> {
  const batches = chunk(rows, options.size ?? 500);
  let done = 0;
  for (const batch of batches) {
    const { error } = await (admin.from(table) as any).upsert(batch, {
      onConflict: options.onConflict,
    });
    if (error) {
      throw new Error(`upsert into ${table} failed: ${error.message}`);
    }
    done += batch.length;
    log("db", `${table}: ${done}/${rows.length}`);
  }
}
