/**
 * Uzbek verse translation import.
 *
 *   pnpm seed:translation-uz
 *
 * Fills `quran_verses.translation_uz` with Shaykh Muhammad Sodiq Muhammad
 * Yusuf's translation. Until this runs, the column is null for every verse and
 * an Uzbek reader sees the English translation instead — which is why the
 * script is worth running, and why the app is correct without it.
 *
 * Split out of the main seed for the same reason the Russian one is: the main
 * seed also re-derives the tajweed alignment and re-imports every tafsir
 * edition, which is a long run to redo for one column. `pnpm seed` populates
 * this column too for a database being built from scratch.
 *
 * Safe to re-run: it is an idempotent update keyed on the verse.
 */
import { admin } from "./db.ts";
import { TRANSLATION_ID_UZ } from "./sources.ts";
import { cachedJson, log, mapLimit, normaliseUzbekApostrophes, stripHtml } from "./util.ts";

interface WholeQuranTranslation {
  translations: Array<{ verse_key: string; text: string }>;
}

async function main(): Promise<void> {
  const started = Date.now();

  log("fetch", `downloading translation ${TRANSLATION_ID_UZ} (Muhammad Sodiq, Latin)…`);
  // The whole Quran in one response — this endpoint returns all 6,236 ayahs,
  // so there is no pagination to walk.
  const data = await cachedJson<WholeQuranTranslation>(
    `translation-${TRANSLATION_ID_UZ}`,
    `https://api.quran.com/api/v4/quran/translations/${TRANSLATION_ID_UZ}?fields=verse_key`,
  );
  log("fetch", `got ${data.translations.length} ayahs`);

  if (data.translations.length !== 6236) {
    throw new Error(
      `expected 6236 ayahs, got ${data.translations.length}. Refusing to import a partial translation.`,
    );
  }

  // Keyed on verse_key rather than array position. The response happens to be
  // in mushaf order, but relying on that would make a silent off-by-one the
  // failure mode; a lookup miss is loud instead.
  const byKey = new Map<string, string>();
  for (const entry of data.translations) {
    // `stripHtml` first: this edition carries footnote markers as <sup> tags,
    // and the marker's digits would otherwise survive into the ayah text.
    const text = normaliseUzbekApostrophes(stripHtml(entry.text ?? ""));
    if (text) byKey.set(entry.verse_key, text);
  }
  log("fetch", `${byKey.size} non-empty translations`);

  // A Cyrillic edition would import cleanly and read as gibberish to half the
  // audience, so the script refuses one rather than trusting the resource id.
  const cyrillic = [...byKey.values()].filter((text) => /[Ѐ-ӿ]/.test(text)).length;
  if (cyrillic > 0) {
    throw new Error(
      `${cyrillic} ayahs contain Cyrillic. Resource ${TRANSLATION_ID_UZ} should be the Latin ` +
        `edition; the app's Uzbek interface is Latin, so refusing to import.`,
    );
  }

  log("db", "loading verse ids…");
  const verses: Array<{ id: number; key: string }> = [];
  for (let from = 0; ; from += 1000) {
    const { data: rows, error } = await admin
      .from("quran_verses")
      .select("id,surah_number,ayah_number")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(`reading quran_verses: ${error.message}`);
    if (!rows?.length) break;
    for (const v of rows) verses.push({ id: v.id, key: `${v.surah_number}:${v.ayah_number}` });
    if (rows.length < 1000) break;
  }
  log("db", `${verses.length} verses`);

  const updates: Array<{ id: number; text: string }> = [];
  const missing: string[] = [];
  for (const verse of verses) {
    const text = byKey.get(verse.key);
    if (text) updates.push({ id: verse.id, text });
    else missing.push(verse.key);
  }
  if (missing.length > 0) {
    throw new Error(
      `no Uzbek translation for ${missing.length} verses (${missing.slice(0, 5).join(", ")}…). ` +
        `Refusing to import a partial translation.`,
    );
  }

  log("db", `writing ${updates.length} translations…`);
  let done = 0;
  await mapLimit(updates, 8, async (row) => {
    const { error } = await admin
      .from("quran_verses")
      .update({ translation_uz: row.text })
      .eq("id", row.id);
    if (error) throw new Error(`updating verse ${row.id}: ${error.message}`);
    done++;
    if (done % 1000 === 0) log("db", `${done}/${updates.length}`);
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  log("done", `imported ${updates.length} Uzbek translations in ${elapsed}s`);
}

main().catch((error) => {
  console.error("\nUzbek translation import failed:\n", error);
  process.exit(1);
});
