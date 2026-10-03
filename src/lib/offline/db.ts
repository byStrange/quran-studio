/**
 * The app's local database: one IndexedDB holding everything kept on this
 * device for offline use.
 *
 * - `kv`        small values by name — whole small tables (surahs, rukus,
 *               editions, reciters), pack manifests, the persisted query cache
 * - `verses`    every ayah with its words, indexed by ruku, surah and page
 * - `mushaf`    one row per mushaf page: its lines and glyphs
 * - `tafsir`    tafsir entries, indexed by edition+surah
 * - `timings`   recitation timings, keyed by reciter+verse
 *
 * IndexedDB rather than files beside the audio, because the readers need to
 * ask questions of it ("the verses of ruku 40", "the entry covering 2:255")
 * and an index answers those without loading a 30MB tafsir into memory.
 */

const DB_NAME = "quran-studio-offline";
const DB_VERSION = 1;

export type StoreName = "kv" | "verses" | "mushaf" | "tafsir" | "timings";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("verses")) {
        const verses = db.createObjectStore("verses", { keyPath: "id" });
        verses.createIndex("ruku_number", "ruku_number");
        verses.createIndex("surah_number", "surah_number");
        verses.createIndex("page_number", "page_number");
      }
      if (!db.objectStoreNames.contains("mushaf")) {
        db.createObjectStore("mushaf", { keyPath: "page_number" });
      }
      if (!db.objectStoreNames.contains("tafsir")) {
        const tafsir = db.createObjectStore("tafsir", { keyPath: "id" });
        tafsir.createIndex("edition_surah", ["edition", "surah_number"]);
        tafsir.createIndex("edition", "edition");
      }
      if (!db.objectStoreNames.contains("timings")) {
        const timings = db.createObjectStore("timings", { keyPath: ["reciter_id", "verse_id"] });
        timings.createIndex("reciter_surah", ["reciter_id", "surah_number"]);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab (or a dev reload) upgrading the schema closes this one.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Could not open the offline database"));
    };
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return promisify(db.transaction("kv").objectStore("kv").get(key)) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put(value, key);
  await done(tx);
}

export async function kvDelete(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").delete(key);
  await done(tx);
}

export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function getMany<T>(store: StoreName, keys: IDBValidKey[]): Promise<T[]> {
  const db = await openDb();
  const objectStore = db.transaction(store).objectStore(store);
  const rows = await Promise.all(keys.map((key) => promisify(objectStore.get(key))));
  return rows.filter((row): row is T => row !== undefined);
}

export async function getAllByIndex<T>(
  store: StoreName,
  index: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<T[]> {
  const db = await openDb();
  return promisify(
    db.transaction(store).objectStore(store).index(index).getAll(query),
  ) as Promise<T[]>;
}

/** Writes a batch of rows in one transaction. */
export async function putAll(store: StoreName, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const objectStore = tx.objectStore(store);
  for (const row of rows) objectStore.put(row);
  await done(tx);
}

export async function clearStore(store: StoreName): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).clear();
  await done(tx);
}

/** Deletes every row an index matches. */
export async function deleteByIndex(
  store: StoreName,
  index: string,
  query: IDBValidKey | IDBKeyRange,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const request = tx.objectStore(store).index(index).openKeyCursor(query);
  const objectStore = tx.objectStore(store);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    objectStore.delete(cursor.primaryKey);
    cursor.continue();
  };
  await done(tx);
}

/** Approximate bytes used by this origin, where the browser will say. */
export async function storageEstimate(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate?.usage ?? null;
  } catch {
    return null;
  }
}
