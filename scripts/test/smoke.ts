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

    await check("lists the tafsir editions", async () => {
      const { data, error } = await client.from("tafsir_editions").select("*").order("sort_order");
      if (error) return error.message;
      if (!data?.length) return "no editions returned";
      const missing = ["en-tafisr-ibn-kathir", "uzbek-mokhtasar"].filter(
        (slug) => !data.some((e) => e.slug === slug),
      );
      return missing.length === 0 ? null : `missing editions: ${missing.join(", ")}`;
    });

    // The reader's tafsir lookup, run once per edition: a missing row for one
    // edition is invisible in a single-edition check.
    await check("every edition has commentary covering 2:3", async () => {
      const { data: editions, error: editionError } = await client
        .from("tafsir_editions")
        .select("slug");
      if (editionError) return editionError.message;

      const empty: string[] = [];
      for (const { slug } of editions ?? []) {
        const { data, error } = await client
          .from("tafsir")
          .select("*")
          .eq("edition", slug)
          .eq("surah_number", 2)
          .lte("ayah_start", 3)
          .gte("ayah_end", 3)
          .maybeSingle();
        if (error) return `${slug}: ${error.message}`;
        if (!data || data.content.length === 0) empty.push(slug);
      }
      return empty.length === 0 ? null : `no tafsir for 2:3 in: ${empty.join(", ")}`;
    });

    // Uzbek content is Cyrillic; a mojibake or transcoding fault upstream
    // would still be a non-empty string, so the script itself is asserted.
    await check("the Uzbek edition returns Cyrillic text", async () => {
      const { data, error } = await client
        .from("tafsir")
        .select("content")
        .eq("edition", "uzbek-mokhtasar")
        .eq("surah_number", 18)
        .lte("ayah_start", 1)
        .gte("ayah_end", 1)
        .maybeSingle();
      if (error) return error.message;
      if (!data?.content) return "no Uzbek tafsir for 18:1";
      return /\p{Script=Cyrillic}/u.test(data.content)
        ? null
        : `expected Cyrillic, got: ${data.content.slice(0, 40)}`;
    });

    // --- recitation --------------------------------------------------------
    await check("lists the reciters", async () => {
      const { data, error } = await client.from("reciters").select("*").order("sort_order");
      if (error) return error.message;
      if (!data?.length) return "no reciters returned — run pnpm seed:audio";
      const slugs = new Set(data.map((r) => r.slug));
      return slugs.size === data.length ? null : "duplicate reciter slugs";
    });

    /**
     * The player's whole contract in one check.
     *
     * It seeks into a continuous surah recording using these offsets, so a
     * timing past the end of the file, or one that starts before the ayah
     * before it, would send the playhead somewhere the reader did not ask for.
     * Word segments have to sit inside their own ayah for the same reason.
     */
    await check("ayah timings index into the surah recording", async () => {
      const { data: reciter } = await client
        .from("reciters")
        .select("id, name")
        .order("sort_order")
        .limit(1)
        .maybeSingle();
      if (!reciter) return "no reciters to check";

      const { data: file, error: fileError } = await client
        .from("recitation_files")
        .select("audio_url, duration_ms")
        .eq("reciter_id", reciter.id)
        .eq("surah_number", 18)
        .maybeSingle();
      if (fileError) return fileError.message;
      if (!file) return `no surah 18 recording for ${reciter.name}`;
      if (!file.audio_url.startsWith("http")) return `bad audio url: ${file.audio_url}`;

      const { data: verses } = await client
        .from("quran_verses")
        .select("id, ayah_number")
        .eq("surah_number", 18)
        .order("ayah_number");
      const verseIds = (verses ?? []).map((v) => v.id);

      const { data: timings, error } = await client
        .from("recitation_timings")
        .select("verse_id, start_ms, end_ms, segments")
        .eq("reciter_id", reciter.id)
        .in("verse_id", verseIds);
      if (error) return error.message;
      if (!timings?.length) return `no timings for ${reciter.name} on surah 18`;

      const byVerse = new Map(timings.map((t) => [t.verse_id, t]));
      let previousEnd = -1;
      for (const id of verseIds) {
        const timing = byVerse.get(id);
        if (!timing) continue;
        if (timing.start_ms < previousEnd) return `ayah ${id} starts before the previous one ends`;
        if (timing.end_ms <= timing.start_ms) return `ayah ${id} has an empty span`;
        // Upstream reports durations to whole seconds, and the final ayah's
        // end tends to include the tail of the recitation dying away, so a
        // few seconds of overrun is normal — across the whole seeded set the
        // worst is 3s on 42 of ~81,000 rows. The fault this guards against is
        // a timing on the wrong scale or the wrong file, which is minutes out.
        if (timing.end_ms > file.duration_ms + 5000) {
          return `ayah ${id} ends at ${timing.end_ms}ms, past the ${file.duration_ms}ms file`;
        }
        previousEnd = timing.end_ms;

        const segments = timing.segments as number[][] | null;
        for (const segment of segments ?? []) {
          const [, startMs, endMs] = segment;
          if (startMs === undefined || endMs === undefined) return `ayah ${id} has a short segment`;
          if (startMs < timing.start_ms || endMs > timing.end_ms) {
            return `ayah ${id} has a word segment outside its own span`;
          }
        }
      }
      return null;
    });

    // --- the content tables must stay read-only ----------------------------
    await check("cannot modify recitation data", async () => {
      const { error } = await client
        .from("recitation_files")
        .update({ audio_url: "https://evil.example/tampered.mp3" })
        .eq("surah_number", 18);
      const { data: after } = await client
        .from("recitation_files")
        .select("audio_url")
        .eq("surah_number", 18)
        .limit(1)
        .maybeSingle();
      if (after?.audio_url.includes("evil.example")) {
        return "a user was able to repoint a recitation!";
      }
      return error || after ? null : "unexpected state";
    });

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

    await check("cannot modify tafsir or its editions", async () => {
      const { error: contentError } = await client
        .from("tafsir")
        .update({ content: "tampered" })
        .eq("edition", "en-tafisr-ibn-kathir")
        .eq("surah_number", 2)
        .eq("ayah_start", 1);
      const { data: after } = await client
        .from("tafsir")
        .select("content")
        .eq("edition", "en-tafisr-ibn-kathir")
        .eq("surah_number", 2)
        .eq("ayah_start", 1)
        .maybeSingle();
      if (after?.content === "tampered") return "a user was able to edit the tafsir!";

      // The editions table drives the reader's picker; a user who could insert
      // into it could point the panel at an edition with no content.
      const { error: insertError } = await client.from("tafsir_editions").insert({
        slug: "smoke-test",
        name: "smoke",
        author_name: "smoke",
        language_code: "xx",
        language_name: "smoke",
      });
      if (!insertError) {
        await admin.from("tafsir_editions").delete().eq("slug", "smoke-test");
        return "a user was able to register a tafsir edition!";
      }
      return contentError || after ? null : "unexpected state";
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

    // The second marker is deliberately independent of the first, so this
    // marks a *different* verse from the memorized one above — ruku_progress
    // below then has a ruku where the two counts genuinely disagree.
    await check("marks the tafsir read on a verse", async () => {
      const { error } = await client
        .from("tafsir_read_verses")
        .insert({ user_id: userId, verse_id: 2 });
      if (error) return error.message;
      const { data, error: readError } = await client
        .from("tafsir_read_verses")
        .select("verse_id");
      if (readError) return readError.message;
      return data.some((r) => r.verse_id === 2) ? null : "row not returned";
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
          language: "en",
          explanation: "smoke-test explanation",
          model_used: "smoke-test",
        },
        { onConflict: "word_id,language" },
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

    await check("quiz_pool draws a ruku's words, asked or not", async () => {
      const { data, error } = await client.rpc("quiz_pool", {
        p_scope: "ruku",
        p_ruku: 1,
        p_limit: 30,
      });
      if (error) return error.message;
      const rows = (data ?? []) as Array<{
        ruku_number: number;
        tracked: boolean;
        verse_arabic: string;
        translation_en: string;
        pool_size: number;
      }>;
      if (rows.length === 0) return "no words for ruku 1";
      if (rows.some((r) => r.ruku_number !== 1)) return "words leaked in from outside the ruku";
      if (rows.some((r) => !r.verse_arabic || !r.translation_en)) {
        return "a word came without the ayah a miss has to show";
      }
      if (!rows.some((r) => r.pool_size > 0)) return "pool_size missing";
      // Only one word in ruku 1 was ever marked, so a pool of the ruku's words
      // must contain words that were never touched — that is the point of
      // scoping the round to the ruku rather than to the marked list.
      return rows.some((r) => !r.tracked) ? null : "every word was already tracked";
    });

    await check("quiz_pool asks only memorized ayahs outside ruku scope", async () => {
      const { data, error } = await client.rpc("quiz_pool", { p_scope: "global", p_limit: 30 });
      if (error) return error.message;
      const rows = (data ?? []) as Array<{ surah_number: number; ayah_number: number }>;
      if (rows.length === 0) return "no words from the one memorized ayah";
      const stray = rows.filter((r) => r.surah_number !== 1 || r.ayah_number !== 1);
      return stray.length === 0 ? null : `${stray.length} words came from unmemorized ayahs`;
    });

    await check("record_quiz_attempt teaches, then demotes, a word", async () => {
      const { data: pool, error: poolError } = await client.rpc("quiz_pool", {
        p_scope: "ruku",
        p_ruku: 1,
        p_limit: 30,
      });
      if (poolError) return poolError.message;
      const fresh = (pool ?? []).find((w) => !w.tracked);
      if (!fresh) return "no untracked word to answer";

      const statusOf = async (): Promise<string | undefined> => {
        const { data } = await client
          .from("user_word_progress")
          .select("status")
          .eq("word_id", fresh.word_id)
          .maybeSingle();
        return data?.status;
      };

      // A miss is how a word gets onto the list in the first place.
      const miss = await client.rpc("record_quiz_attempt", {
        p_word_id: fresh.word_id,
        p_correct: false,
      });
      if (miss.error) return miss.error.message;
      const afterMiss = await statusOf();
      if (afterMiss !== "learning") return `a miss left status ${afterMiss}`;

      const hit = await client.rpc("record_quiz_attempt", {
        p_word_id: fresh.word_id,
        p_correct: true,
      });
      if (hit.error) return hit.error.message;
      const afterHit = await statusOf();
      if (afterHit !== "learned") return `knowing a word left status ${afterHit}`;

      // Knowing it once is not forever: missing it again drops it back.
      const lapse = await client.rpc("record_quiz_attempt", {
        p_word_id: fresh.word_id,
        p_correct: false,
      });
      if (lapse.error) return lapse.error.message;
      const afterLapse = await statusOf();
      return afterLapse === "learning" ? null : `a learned word did not demote (${afterLapse})`;
    });

    await check("word_progress_by_ruku totals a ruku's words", async () => {
      const { data, error } = await client.rpc("word_progress_by_ruku");
      if (error) return error.message;
      const rows = (data ?? []) as Array<{
        ruku_number: number;
        word_count: number;
        learned_count: number;
        learning_count: number;
        untouched_count: number;
      }>;
      if (rows.length !== 558) return `got ${rows.length} rukus`;
      const first = rows.find((r) => r.ruku_number === 1);
      if (!first) return "ruku 1 missing";
      if (first.word_count === 0) return "ruku 1 has no words";
      const counted = first.learned_count + first.learning_count + first.untouched_count;
      return counted === first.word_count ? null : `counts sum to ${counted}, expected ${first.word_count}`;
    });

    // --- knowledge quizzes -------------------------------------------------

    await check("quiz_verse_pool draws a ruku's ayahs", async () => {
      const { data, error } = await client.rpc("quiz_verse_pool", {
        p_scope: "ruku",
        p_ruku: 1,
        p_limit: 10,
      });
      if (error) return error.message;
      const rows = data ?? [];
      if (rows.length === 0) return "ruku 1 drew no ayahs";
      if (rows.some((v) => v.ruku_number !== 1)) return "an ayah from another ruku was drawn";
      if (rows.some((v) => !v.arabic_text || !v.translation_en)) return "an ayah came back unusable";
      if (rows.some((v) => !v.surah_name)) return "an ayah came back without its surah name";
      return rows[0]!.pool_size >= rows.length ? null : "pool_size is smaller than the page";
    });

    await check("record_quiz_attempt keeps the claim beside the confirmation", async () => {
      const { data: pool, error: poolError } = await client.rpc("quiz_pool", {
        p_scope: "ruku",
        p_ruku: 1,
        p_limit: 30,
      });
      if (poolError) return poolError.message;
      const word = (pool ?? [])[0];
      if (!word) return "no word to answer";

      // Claimed, then conceded at the reveal: the concession is what scores.
      const { error } = await client.rpc("record_quiz_attempt", {
        p_word_id: word.word_id,
        p_correct: false,
        p_claimed: true,
      });
      if (error) return error.message;

      const { data: attempt } = await client
        .from("quiz_attempts")
        .select("claimed, correct")
        .eq("word_id", word.word_id)
        .order("answered_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!attempt) return "no attempt was recorded";
      if (attempt.claimed !== true) return `claim stored as ${attempt.claimed}`;
      if (attempt.correct !== false) return `confirmation stored as ${attempt.correct}`;

      const { data: progress } = await client
        .from("user_word_progress")
        .select("status")
        .eq("word_id", word.word_id)
        .maybeSingle();
      return progress?.status === "learning"
        ? null
        : `a withdrawn claim left status ${progress?.status}`;
    });

    let knowledgeSession: string | null = null;

    await check("a knowledge round records answers and totals them", async () => {
      const { data: verses, error: verseError } = await client.rpc("quiz_verse_pool", {
        p_scope: "ruku",
        p_ruku: 1,
        p_limit: 2,
      });
      if (verseError) return verseError.message;
      const drawn = verses ?? [];
      if (drawn.length < 2) return "ruku 1 drew fewer than two ayahs";

      const { data: sessionId, error: startError } = await client.rpc("start_knowledge_quiz", {
        p_scope: "ruku",
        p_question_count: 2,
        p_ruku: 1,
        p_model: "smoke-test",
      });
      if (startError) return startError.message;
      knowledgeSession = sessionId;

      const answer = (position: number, index: number, claimed: boolean, correct: boolean) =>
        client.rpc("record_knowledge_answer", {
          p_session_id: sessionId,
          p_position: position,
          p_verse_id: drawn[index]!.verse_id,
          p_kind: "locate",
          p_question: `smoke question ${position}`,
          p_expected: "smoke answer",
          p_claimed: claimed,
          p_correct: correct,
        });

      const first = await answer(0, 0, true, true);
      if (first.error) return first.error.message;
      const second = await answer(1, 1, true, false);
      if (second.error) return second.error.message;

      const { data: session } = await client
        .from("knowledge_quiz_sessions")
        .select("answered_count, correct_count, revised_count, completed_at")
        .eq("id", sessionId)
        .maybeSingle();
      if (!session) return "the session row is not readable";
      if (session.answered_count !== 2) return `answered_count is ${session.answered_count}`;
      if (session.correct_count !== 1) return `correct_count is ${session.correct_count}`;
      // One answer was claimed and then conceded.
      if (session.revised_count !== 1) return `revised_count is ${session.revised_count}`;

      // Changing your mind corrects the answer rather than adding a second one.
      const again = await answer(1, 1, true, true);
      if (again.error) return again.error.message;
      const { data: revised } = await client
        .from("knowledge_quiz_sessions")
        .select("answered_count, correct_count, revised_count")
        .eq("id", sessionId)
        .maybeSingle();
      if (revised?.answered_count !== 2) return `a revision changed the count to ${revised?.answered_count}`;
      if (revised?.correct_count !== 2) return `a revision left correct_count at ${revised?.correct_count}`;
      if (revised?.revised_count !== 0) return `revised_count is ${revised?.revised_count} after the change`;

      const finished = await client.rpc("finish_knowledge_quiz", { p_session_id: sessionId });
      if (finished.error) return finished.error.message;
      const { data: closed } = await client
        .from("knowledge_quiz_sessions")
        .select("completed_at")
        .eq("id", sessionId)
        .maybeSingle();
      return closed?.completed_at ? null : "the round did not close";
    });

    await check("cannot record into another user's knowledge round", async () => {
      const otherEmail = `smoke-quiz-${Date.now()}@quran-studio.test`;
      const { data: other } = await admin.auth.admin.createUser({
        email: otherEmail,
        password: "another-password!A1",
        email_confirm: true,
      });
      const otherId = other.user!.id;
      const { data: theirs } = await admin
        .from("knowledge_quiz_sessions")
        .insert({ user_id: otherId, scope: "global", question_count: 1 })
        .select("id")
        .single();

      const { error } = await client.rpc("record_knowledge_answer", {
        p_session_id: theirs!.id,
        p_position: 0,
        p_verse_id: 1,
        p_kind: "locate",
        p_question: "smoke",
        p_expected: "smoke",
        p_claimed: true,
        p_correct: true,
      });
      await admin.auth.admin.deleteUser(otherId);
      return error ? null : "wrote an answer into a session belonging to someone else";
    });

    await check("quiz_scoreboard reports both quiz types", async () => {
      const { data, error } = await client.rpc("quiz_scoreboard");
      if (error) return error.message;
      const row = (data ?? [])[0];
      if (!row) return "no scoreboard row";
      if (row.vocab_attempts === 0) return "vocabulary attempts were not counted";
      if (row.vocab_overclaimed === 0) return "the withdrawn claim was not counted";
      if (row.knowledge_answered !== 2) return `knowledge_answered is ${row.knowledge_answered}`;
      if (row.knowledge_correct !== 2) return `knowledge_correct is ${row.knowledge_correct}`;
      const kinds = (row.knowledge_by_kind ?? []) as Array<{ kind: string; answered: number }>;
      return kinds.some((k) => k.kind === "locate" && k.answered === 2)
        ? null
        : "the per-kind breakdown does not match the answers";
    });

    await check("knowledge_quiz_history lists the round just played", async () => {
      const { data, error } = await client.rpc("knowledge_quiz_history", { p_limit: 5 });
      if (error) return error.message;
      const rows = data ?? [];
      if (!knowledgeSession) return "no session was opened";
      const mine = rows.find((r) => r.id === knowledgeSession);
      if (!mine) return "the finished round is not in the history";
      return mine.scope === "ruku" && mine.ruku_number === 1
        ? null
        : "the round came back with the wrong scope";
    });

    await check("next_unread_tafsir offers a memorized ayah's commentary", async () => {
      // 2:3 is memorized here and nothing in its range has been marked read.
      // Al-Fatiha's entry may or may not collapse across ayah 2, which is
      // marked read above — 2:3 keeps this check independent of that.
      const { error: memorizeError } = await client
        .from("memorized_verses")
        .insert({ user_id: userId, verse_id: 10 });
      if (memorizeError) return memorizeError.message;

      const { data, error } = await client.rpc("next_unread_tafsir", {
        p_edition: "en-tafisr-ibn-kathir",
      });
      if (error) return error.message;
      const row = (data ?? [])[0];
      if (!row) return "no pending tafsir despite a memorized ayah with unread commentary";
      if (!row.content) return "the offered entry has no text";
      if (!row.verse_ids.includes(row.verse_id)) return "verse_ids does not cover the offered ayah";
      if (row.ayah_number < row.ayah_start || row.ayah_number > row.ayah_end) {
        return "the offered ayah falls outside its own entry's range";
      }

      // And it must not offer a passage that has already been read.
      const { data: alreadyRead } = await client
        .from("tafsir_read_verses")
        .select("verse_id")
        .in("verse_id", row.verse_ids);
      return (alreadyRead ?? []).length === 0 ? null : "offered an entry that is already marked read";
    });

    await check("memorized_by_surah reports per-surah progress", async () => {
      const { data, error } = await client.rpc("memorized_by_surah");
      if (error) return error.message;
      const rows = (data ?? []) as Array<{ surah_number: number; memorized_count: number }>;
      if (rows.length !== 114) return `got ${rows.length} rows`;
      const first = rows.find((r) => r.surah_number === 1);
      return first?.memorized_count === 1 ? null : `surah 1 count = ${first?.memorized_count}`;
    });

    // Verse 1 is memorized and verse 2 has its tafsir read, both in ruku 1 —
    // so this also asserts the two markers are counted separately rather than
    // one being derived from the other.
    await check("ruku_progress counts both markers", async () => {
      const { data, error } = await client.rpc("ruku_progress");
      if (error) return error.message;
      const rows = (data ?? []) as Array<{
        ruku_number: number;
        verse_count: number;
        memorized_count: number;
        tafsir_read_count: number;
      }>;
      if (rows.length !== 558) return `got ${rows.length} rukus`;
      const first = rows.find((r) => r.ruku_number === 1);
      if (!first) return "ruku 1 missing";
      if (first.verse_count !== 7) return `ruku 1 has ${first.verse_count} verses, expected 7`;
      if (first.memorized_count !== 1) return `memorized_count = ${first.memorized_count}`;
      if (first.tafsir_read_count !== 1) return `tafsir_read_count = ${first.tafsir_read_count}`;
      const total = rows.reduce((n, r) => n + r.verse_count, 0);
      return total === 6236 ? null : `rukus cover ${total} verses, expected 6236`;
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
