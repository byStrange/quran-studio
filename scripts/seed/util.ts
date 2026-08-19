import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(here, ".cache");

/** Fetch with retry + exponential backoff, so a transient 5xx doesn't kill a
 *  20-minute import run. */
export async function fetchJson<T>(url: string, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "quran-studio-seed/0.1 (personal study app)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return (await res.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const backoff = Math.min(500 * 2 ** (attempt - 1), 8_000);
      await sleep(backoff);
    }
  }
  throw new Error(`failed after ${attempts} attempts: ${url}\n  ${String(lastError)}`);
}

/**
 * Disk-cached fetch. Re-running the seed after a failure re-uses everything
 * already downloaded instead of hammering the upstream APIs again.
 *
 * Passing several URLs tries them in order and keeps the first that answers.
 * That is not load balancing — it is for mirrors that are *individually*
 * incomplete: jsDelivr refuses files in a repository over its 50 MB package
 * limit with a 403, so a handful of the tafsir surah files have to come from
 * raw.githubusercontent.com instead. Retrying the same host would never fix
 * that, and hardcoding the slower host for everything would be a needless
 * tax on the ~99% that jsDelivr serves happily.
 */
export async function cachedJson<T>(
  key: string,
  url: string | readonly string[],
): Promise<T> {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    const urls = typeof url === "string" ? [url] : url;
    let lastError: unknown;
    for (const candidate of urls) {
      try {
        // Fewer attempts per host when there is another to fall through to:
        // five rounds of backoff against a host that is answering 403 on
        // purpose only delays reaching the mirror that works.
        const data = await fetchJson<T>(candidate, urls.length > 1 ? 2 : 5);
        await writeFile(file, JSON.stringify(data));
        return data;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** As `fetchJson`, for sources that serve HTML rather than JSON. */
export async function fetchText(url: string, attempts = 5): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "quran-studio-seed/0.1 (personal study app)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const backoff = Math.min(500 * 2 ** (attempt - 1), 8_000);
      await sleep(backoff);
    }
  }
  throw new Error(`failed after ${attempts} attempts: ${url}\n  ${String(lastError)}`);
}

/**
 * Disk-cached fetch for HTML pages.
 *
 * Kept separate from `cachedJson` rather than generalised over it because the
 * cache file is the raw response: a half-finished 6,000-page crawl resumes
 * from disk, and the parser can be fixed and re-run without re-fetching.
 */
export async function cachedText(key: string, url: string): Promise<string> {
  const dir = path.join(CACHE_DIR, "html");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${key}.html`);
  try {
    return await readFile(file, "utf8");
  } catch {
    const body = await fetchText(url);
    await writeFile(file, body);
    return body;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs tasks with bounded concurrency, preserving input order in the result. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Translations arrive with footnote markup (`<sup foot_note=…>1</sup>`).
 * The app shows clean prose, so footnote markers are dropped entirely and any
 * remaining tags are unwrapped.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<sup\b[^>]*>.*?<\/sup>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function log(step: string, message: string): void {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${step.padEnd(10)} ${message}`);
}
