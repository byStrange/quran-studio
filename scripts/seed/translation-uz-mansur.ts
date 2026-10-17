/**
 * Alouddin Mansur's Uzbek verse translation import.
 *
 *   pnpm seed:translation-uz-mansur
 *
 * Fills `quran_verses.translation_uz_mansur` with Alouddin Mansur's
 * translation. Until this runs, the column is null for every verse and a reader
 * who selects this translation sees the English one instead — which is why the
 * script is worth running, and why the app is correct without it.
 *
 * The sibling of `seed/translation-uz.ts`, with one inversion: that script
 * *refuses* Cyrillic because `translation_uz` stands in for the Latin interface;
 * this one *requires* it, because the only published Alouddin Mansur edition is
 * Cyrillic and the picker offers it as such. A Latin edition here would mean the
 * import had silently fetched the wrong resource.
 *
 * Split out of the main seed for the same reason the others are: the main seed
 * also re-derives the tajweed alignment and re-imports every tafsir edition,
 * which is a long run to redo for one column. `pnpm seed` populates this column
 * too for a database being built from scratch.
 *
 * Safe to re-run: it is an idempotent update keyed on the verse.
 */
import { admin } from "./db.ts";
import { TRANSLATION_ID_UZ_MANSUR } from "./sources.ts";
import { cachedJson, log, mapLimit, stripHtml } from "./util.ts";

interface WholeQuranTranslation {
  translations: Array<{ verse_key: string; text: string }>;
}

async function main(): Promise<void> {
  const started = Date.now();

  log("fetch", `downloading translation ${TRANSLATION_ID_UZ_MANSUR} (Alouddin Mansur, Cyrillic)…`);
  // The whole Quran in one response — this endpoint returns all 6,236 ayahs,
  // so there is no pagination to walk.
  const data = await cachedJson<WholeQuranTranslation>(
    `translation-${TRANSLATION_ID_UZ_MANSUR}`,
    `https://api.quran.com/api/v4/quran/translations/${TRANSLATION_ID_UZ_MANSUR}?fields=verse_key`,
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
    // `stripHtml` only — no Latin-apostrophe normalisation, since this edition
    // is Cyrillic. Footnote markers still arrive as <sup> tags and are stripped
    // the same way.
    const text = stripHtml(entry.text ?? "");
    if (text) byKey.set(entry.verse_key, text);
  }
  log("fetch", `${byKey.size} non-empty translations`);

  // The inverse of the Latin guard in `translation-uz.ts`: this column is the
  // one place Cyrillic is intended, so a *Latin* edition here would mean the
  // wrong resource was fetched. Requiring Cyrillic throughout makes that loud.
  const latinOnly = [...byKey.values()].filter((text) => !/[Ѐ-ӿ]/.test(text)).length;
  if (latinOnly > 0) {
    throw new Error(
      `${latinOnly} ayahs contain no Cyrillic. Resource ${TRANSLATION_ID_UZ_MANSUR} should be the ` +
        `Cyrillic Alouddin Mansur edition; refusing to import what looks like the wrong resource.`,
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
      `no Uzbek (Mansur) translation for ${missing.length} verses (${missing.slice(0, 5).join(", ")}…). ` +
        `Refusing to import a partial translation.`,
    );
  }

  log("db", `writing ${updates.length} translations…`);
  let done = 0;
  await mapLimit(updates, 8, async (row) => {
    const { error } = await admin
      .from("quran_verses")
      .update({ translation_uz_mansur: row.text })
      .eq("id", row.id);
    if (error) throw new Error(`updating verse ${row.id}: ${error.message}`);
    done++;
    if (done % 1000 === 0) log("db", `${done}/${updates.length}`);
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);
  log("done", `imported ${updates.length} Uzbek (Mansur) translations in ${elapsed}s`);
}

main().catch((error) => {
  console.error("\nUzbek (Mansur) translation import failed:\n", error);
  process.exit(1);
});
