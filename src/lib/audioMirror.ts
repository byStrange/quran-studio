/**
 * The recitation CDN, and the relay that serves the same files when it can't
 * be reached.
 *
 * Some networks block download.quranicaudio.com by name: the connection is
 * reset during the TLS handshake, so every reciter fails at once. The relay
 * (`workers/audio-proxy`, a Cloudflare Worker) serves identical paths from a
 * different hostname. The CDN stays the first choice; the relay is only tried
 * after it fails. Both hosts must also be listed in the CSP in
 * `src-tauri/tauri.conf.json`, and the relay host in `src-tauri/src/audio.rs`.
 */

const RECITATION_HOST = "download.quranicaudio.com";
const MIRROR_ORIGIN = "https://audio.bombaclat.uz";

/** The relay's copy of a CDN URL, or null for any URL that isn't on the CDN. */
export function mirrorAudioUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // The same test as `is_allowed_url` in audio.rs: https on the default port.
  if (parsed.protocol !== "https:" || parsed.hostname !== RECITATION_HOST || parsed.port !== "") {
    return null;
  }
  // Built by concatenation rather than by swapping `host`: some paths contain
  // `//`, which must survive as-is.
  return MIRROR_ORIGIN + parsed.pathname + parsed.search;
}
