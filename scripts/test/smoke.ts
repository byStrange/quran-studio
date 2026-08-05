/**
 * End-to-end data-layer smoke test.
 *
 *   pnpm test:smoke
 *
 * Signs in as a throwaway user with the *publishable* key — exactly what the
 * app ships with — and exercises every query and RPC the UI depends on. This
 * catches RLS policy mistakes that a service-role script would sail straight
 * through, and confirms the content tables really are read-only to users.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { admin } from "../seed/db.ts";
import type { Database } from "../../src/lib/database.types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const url = process.env.VITE_SUPABASE_URL!;
const publishableKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;

let passed = 0;
const failures: string[] = [];

async function check(name: string, run: () => Promise<string | null>): Promise<void> {
  try {
    const problem = await run();
    if (problem === null) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.log(`  ✗ ${name} — ${problem}`);
      failures.push(name);
    }
  } catch (error) {
    console.log(`  ✗ ${name} — threw: ${String(error)}`);
    failures.push(name);
  }
}

async function main(): Promise<void> {
  const email = `smoke-${Date.now()}@quran-studio.test`;
  const password = `test-${Math.random().toString(36).slice(2)}!A1`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) throw new Error(`createUser: ${createError?.message}`);
  const userId = created.user.id;

  // From here on we use the same client configuration the desktop app uses.
  const client = createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn: ${signInError.message}`);

  console.log(`signed in as ${email}\n`);

  try {
    // --- content reads -----------------------------------------------------
    await check("reads the surah index", async () => {
      const { data, error } = await client.from("quran_surahs").select("*").order("number");
      if (error) return error.message;
      return data.length === 114 ? null : `got ${data.length} surahs`;
    });

    await check("reads ruku metadata", async () => {
      const { data, error } = await client.from("quran_rukus").select("*").order("ruku_number");
      if (error) return error.message;
      return data.length === 558 ? null : `got ${data.length} rukus`;
    });

    await check("reads a ruku's verses with word-by-word data", async () => {
      const { data, error } = await client
        .from("quran_verses")
        .select("*, words:quran_words(*)")
        .eq("ruku_number", 1)
        .order("ayah_number");
      if (error) return error.message;
      if (data.length === 0) return "no verses returned";
      const words = (data[0] as any).words ?? [];
      if (words.length === 0) return "first verse has no words";
      if (!data[0]!.translation_en) return "translation missing";
      return null;
    });

    await check("verses carry tajweed spans the reader can slice", async () => {
      const { data, error } = await client
        .from("quran_verses")
        .select("arabic_text, tajweed")
        .eq("ruku_number", 1)
        .order("ayah_number");
      if (error) return error.message;
      if (data.length === 0) return "no verses returned";

      for (const verse of data) {
        const spans = verse.tajweed as Array<{ r: string; s: number; e: number }> | null;
        if (!Array.isArray(spans)) return "tajweed is missing or not an array";
        // The reader slices arabic_text with these offsets, so a bad range
        // would silently drop or repeat part of the ayah.
        let cursor = 0;
        for (const span of spans) {
          if (span.s < cursor || span.e <= span.s || span.e > verse.arabic_text.length) {
            return `bad span ${span.s}..${span.e} on a ${verse.arabic_text.length}-char verse`;
          }
          cursor = span.e;
        }
      }
      return null;
    });

    await check("finds tafsir covering a specific ayah", async () => {
      const { data, error } = await client
        .from("tafsir_ibn_kathir")
        .select("*")
        .eq("surah_number", 2)
        .lte("ayah_start", 3)
        .gte("ayah_end", 3)
        .maybeSingle();
      if (error) return error.message;
      return data && data.content.length > 0 ? null : "no tafsir found for 2:3";
    });

    // --- the content tables must stay read-only ----------------------------
    await check("cannot modify Quran content", async () => {
      const { error } = await client
        .from("quran_verses")
        .update({ translation_en: "tampered" })
        .eq("id", 1);
      // RLS with no UPDATE policy: the write is rejected or matches no rows.
      const { data: after } = await client
        .from("quran_verses")
        .select("translation_en")
        .eq("id", 1)
        .single();
      if (after?.translation_en === "tampered") return "a user was able to edit scripture!";
      return error || after ? null : "unexpected state";
    });

    // --- per-user writes ---------------------------------------------------
    await check("marks a verse memorized and reads it back", async () => {
      const { error } = await client
        .from("memorized_verses")
        .insert({ user_id: userId, verse_id: 1 });
      if (error) return error.message;
      const { data, error: readError } = await client
        .from("memorized_verses")
        .select("verse_id");
      if (readError) return readError.message;
      return data.some((r) => r.verse_id === 1) ? null : "row not returned";
    });

    await check("records word progress", async () => {
      const { data: word } = await client.from("quran_words").select("id").limit(1).single();
      const { error } = await client
        .from("user_word_progress")
        .upsert(
          { user_id: userId, word_id: word!.id, status: "learning" },
          { onConflict: "user_id,word_id" },
        );
      return error ? error.message : null;
    });

    await check("caches an AI word explanation", async () => {
      const { data: word } = await client.from("quran_words").select("id").limit(1).single();
      const { error } = await client.from("word_ai_context").upsert(
        {
          word_id: word!.id,
          explanation: "smoke-test explanation",
          model_used: "smoke-test",
        },
        { onConflict: "word_id" },
      );
      return error ? error.message : null;
    });

    // --- RPCs the UI calls -------------------------------------------------
    await check("logs a reading session and updates the streak", async () => {
      const { data, error } = await client.rpc("log_reading", {
        p_seconds: 3600,
        p_ruku_number: 1,
      });
      if (error) return error.message;
      const state = data as unknown as { current_streak: number } | null;
      return state && state.current_streak >= 1
        ? null
        : `streak did not advance (${JSON.stringify(state)})`;
    });

    await check("reading_overview reflects the logged time", async () => {
      const { data, error } = await client.rpc("reading_overview");
      if (error) return error.message;
      const overview = data as unknown as { today_seconds: number; total_seconds: number };
      return overview.today_seconds >= 3600 ? null : `today_seconds = ${overview.today_seconds}`;
    });

    await check("memorization_overview counts the marked verse", async () => {
      const { data, error } = await client.rpc("memorization_overview");
      if (error) return error.message;
      const overview = data as unknown as { verses_memorized: number; total_verses: number };
      if (overview.total_verses !== 6236) return `total_verses = ${overview.total_verses}`;
      return overview.verses_memorized === 1 ? null : `memorized = ${overview.verses_memorized}`;
    });

    await check("vocabulary_overview derives encountered words", async () => {
      const { data, error } = await client.rpc("vocabulary_overview");
      if (error) return error.message;
      const overview = data as unknown as { encountered: number; rukus_read: number };
      // One reading session was logged against ruku 1, so its words count.
      return overview.encountered > 0 && overview.rukus_read === 1
        ? null
        : `encountered=${overview.encountered} rukus_read=${overview.rukus_read}`;
    });

    await check("quiz_pool returns the user's words", async () => {
      const { data, error } = await client.rpc("quiz_pool", { p_limit: 5 });
      if (error) return error.message;
      return (data ?? []).length > 0 ? null : "empty pool despite tracked words";
    });

    await check("quiz_distractors returns wrong answers", async () => {
      const { data, error } = await client.rpc("quiz_distractors", {
        p_exclude: ["In (the) name"],
        p_limit: 3,
      });
      if (error) return error.message;
      const glosses = ((data ?? []) as Array<{ gloss_en: string }>).map((d) => d.gloss_en);
      if (glosses.length !== 3) return `got ${glosses.length} distractors`;
      return glosses.includes("In (the) name") ? "excluded gloss leaked through" : null;
    });

    await check("memorized_by_surah reports per-surah progress", async () => {
      const { data, error } = await client.rpc("memorized_by_surah");
      if (error) return error.message;
      const rows = (data ?? []) as Array<{ surah_number: number; memorized_count: number }>;
      if (rows.length !== 114) return `got ${rows.length} rows`;
      const first = rows.find((r) => r.surah_number === 1);
      return first?.memorized_count === 1 ? null : `surah 1 count = ${first?.memorized_count}`;
    });

    await check("profile was created automatically at signup", async () => {
      const { data, error } = await client.from("profiles").select("*").eq("user_id", userId);
      if (error) return error.message;
      return data.length === 1 ? null : `found ${data.length} profile rows`;
    });

    // --- isolation ---------------------------------------------------------
    await check("cannot see another user's progress", async () => {
      const otherEmail = `smoke-other-${Date.now()}@quran-studio.test`;
      const { data: other } = await admin.auth.admin.createUser({
        email: otherEmail,
        password: "another-password!A1",
        email_confirm: true,
      });
      const otherId = other.user!.id;
      await admin.from("memorized_verses").insert({ user_id: otherId, verse_id: 500 });

      const { data, error } = await client.from("memorized_verses").select("verse_id");
      await admin.auth.admin.deleteUser(otherId);

      if (error) return error.message;
      return data.some((r) => r.verse_id === 500)
        ? "RLS leak: another user's row was visible"
        : null;
    });
  } finally {
    await client.auth.signOut();
    await admin.auth.admin.deleteUser(userId);
    // The AI cache is shared content and users cannot delete from it, so the
    // placeholder row has to be removed with the service role.
    await admin.from("word_ai_context").delete().eq("model_used", "smoke-test");
  }

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nSmoke test failed:\n", error);
  process.exit(1);
});
