/**
 * A narrow relay for recitation audio.
 *
 * Some networks block download.quranicaudio.com by name (the TLS handshake is
 * reset as soon as the hostname is seen), so the app falls back to fetching
 * the same path from this Worker instead. It forwards only to that one host and
 * only for .mp3 paths, so it cannot be used as a general-purpose proxy.
 *
 * Range headers are passed through untouched: the player seeks by asking for
 * byte ranges, and a 200 in place of a 206 would make every seek re-download
 * the surah from the start.
 */

const UPSTREAM = "https://download.quranicaudio.com";

/** The CDN's two path layouts, e.g. /qdc/<reciter>/<style>/1.mp3 and /quran/<reciter>//001.mp3. */
const ALLOWED_PATH = /^\/(?:qdc|quran)\/[A-Za-z0-9_\-./]+\.mp3$/;

const FORWARDED_REQUEST_HEADERS = ["range", "if-range", "if-none-match", "if-modified-since"];

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
  "cache-control",
];

// No CORS headers on purpose. The app plays through an <audio> element and
// downloads from Rust, neither of which needs them; leaving them out keeps
// other sites from reading the files with fetch().

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const { pathname } = new URL(request.url);
    if (!ALLOWED_PATH.test(pathname) || pathname.includes("..")) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + pathname, { method: request.method, headers });
    } catch {
      return new Response("Upstream unavailable", { status: 502 });
    }

    const out = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
