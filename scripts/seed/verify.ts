/**
 * Seed-data integrity checks.
 *
 *   pnpm seed:verify
 *
 * Runs against whatever is currently in Supabase, so it doubles as a way to
 * confirm the database is healthy without re-importing.
 */
import { admin } from "./db.ts";

const EXPECTED_VERSES = 6236;
const EXPECTED_SURAHS = 114;

interface Check {
  name: string;
  run: () => Promise<string | null>; // null = pass, string = failure reason
}

async function count(table: string, filter?: (q: any) => any): Promise<number> {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count: n, error } = await query;
  if (error) throw new Error(`counting ${table}: ${error.message}`);
  return n ?? 0;
}

/**
 * PostgREST caps a response at 1000 rows. Any check that reasons about a whole
 * table has to page through it explicitly, or it silently validates only the
 * first page and reports phantom gaps.
 */
async function selectAll<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const page = 1000;
  const rows: T[] = [];
  for (let offset = 0; ; offset += page) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .order(orderBy)
      .range(offset, offset + page - 1);
    if (error) throw new Error(`reading ${table}: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < page) return rows;
  }
}

const checks: Check[] = [
  {
    name: "all 114 surahs present",
    run: async () => {
      const n = await count("quran_surahs");
      return n === EXPECTED_SURAHS ? null : `expected ${EXPECTED_SURAHS}, found ${n}`;
    },
  },
  {
    name: "all 6236 verses present",
    run: async () => {
      const n = await count("quran_verses");
      return n === EXPECTED_VERSES ? null : `expected ${EXPECTED_VERSES}, found ${n}`;
    },
  },
  {
    name: "every verse has a ruku number",
    run: async () => {
      const n = await count("quran_verses", (q) => q.is("ruku_number", null));
      return n === 0 ? null : `${n} verses missing ruku_number`;
    },
  },
  {
    name: "every verse has a non-empty translation",
    run: async () => {
      const n = await count("quran_verses", (q) => q.eq("translation_en", ""));
      return n === 0 ? null : `${n} verses have an empty translation`;
    },
  },
  {
    name: "verse ayah counts match surah metadata",
    run: async () => {
      const { data, error } = await admin
        .from("quran_surahs")
        .select("number, ayah_count")
        .order("number");
      if (error) throw new Error(error.message);
      const mismatches: string[] = [];
      for (const surah of data ?? []) {
        const actual = await count("quran_verses", (q) => q.eq("surah_number", surah.number));
        if (actual !== surah.ayah_count) {
          mismatches.push(`surah ${surah.number}: expected ${surah.ayah_count}, found ${actual}`);
        }
      }
      return mismatches.length === 0 ? null : mismatches.join("; ");
    },
  },
  {
    name: "ruku coverage is complete and contiguous",
    run: async () => {
      const data = await selectAll<{ ruku_number: number }>(
        "quran_rukus",
        "ruku_number",
        "ruku_number",
      );
      const numbers = data.map((r) => r.ruku_number);
      if (numbers.length === 0) return "no rukus found";
      const gaps: number[] = [];
      for (let i = 1; i <= numbers[numbers.length - 1]!; i++) {
        if (!numbers.includes(i)) gaps.push(i);
      }
      return gaps.length === 0
        ? null
        : `missing ruku numbers: ${gaps.slice(0, 10).join(", ")}${gaps.length > 10 ? "…" : ""}`;
    },
  },
  {
    name: "sampled verses all have word-by-word data",
    run: async () => {
      // Spot-check across the whole mushaf rather than only the opening pages:
      // one window of verses from each juz.
      const offsets = Array.from({ length: 30 }, (_, i) => i * 200);
      const empty: number[] = [];
      for (const offset of offsets) {
        const { data, error } = await admin
          .from("quran_verses")
          .select("id, quran_words(id)")
          .order("id")
          .range(offset, offset + 19);
        if (error) throw new Error(error.message);
        for (const verse of data ?? []) {
          if (((verse as any).quran_words ?? []).length === 0) empty.push(verse.id);
        }
      }
      return empty.length === 0
        ? null
        : `${empty.length} sampled verses have no words (e.g. verse ${empty[0]})`;
    },
  },
  {
    name: "word count is in the expected range",
    run: async () => {
      // The Quran has roughly 77k words in this segmentation; a wildly
      // different number means a truncated or duplicated import.
      const n = await count("quran_words");
      return n > 70_000 && n < 90_000 ? null : `found ${n} words, expected ~77k`;
    },
  },
  {
    name: "tafsir rows reference real ayahs",
    run: async () => {
      const data = await selectAll<{
        surah_number: number;
        ayah_start: number;
        ayah_end: number;
      }>("tafsir_ibn_kathir", "surah_number, ayah_start, ayah_end", "id");
      const { data: surahs, error: surahError } = await admin
        .from("quran_surahs")
        .select("number, ayah_count");
      if (surahError) throw new Error(surahError.message);
      const limits = new Map((surahs ?? []).map((s) => [s.number, s.ayah_count]));
      const bad = data.filter((t) => {
        const max = limits.get(t.surah_number);
        return max === undefined || t.ayah_start < 1 || t.ayah_end > max;
      });
      return bad.length === 0 ? null : `${bad.length} tafsir rows fall outside their surah`;
    },
  },
  {
    name: "tafsir covers every surah",
    run: async () => {
      const data = await selectAll<{ surah_number: number }>(
        "tafsir_ibn_kathir",
        "surah_number",
        "id",
      );
      const covered = new Set(data.map((t) => t.surah_number));
      const missing = Array.from({ length: EXPECTED_SURAHS }, (_, i) => i + 1).filter(
        (n) => !covered.has(n),
      );
      return missing.length === 0 ? null : `no tafsir for surahs: ${missing.join(", ")}`;
    },
  },
];

export async function runValidation(): Promise<boolean> {
  let passed = 0;
  const failures: string[] = [];

  for (const check of checks) {
    try {
      const failure = await check.run();
      if (failure === null) {
        console.log(`  ✓ ${check.name}`);
        passed++;
      } else {
        console.log(`  ✗ ${check.name} — ${failure}`);
        failures.push(check.name);
      }
    } catch (error) {
      console.log(`  ✗ ${check.name} — threw: ${String(error)}`);
      failures.push(check.name);
    }
  }

  console.log(`\n${passed}/${checks.length} checks passed`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
  }
  return failures.length === 0;
}

// Allow running standalone: `pnpm seed:verify`
const isMain = process.argv[1]?.endsWith("verify.ts");
if (isMain) {
  runValidation().then((ok) => process.exit(ok ? 0 : 1));
}
