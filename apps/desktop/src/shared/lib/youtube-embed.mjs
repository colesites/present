/**
 * YouTube props: which video a link means, and where to embed it from.
 *
 * A packaged build serves its pages from `tauri://localhost`, and a request
 * from that scheme carries no `Referer`. YouTube has refused embeds without
 * one since 2025 — "Error 153: video player configuration error" — which is
 * why a YouTube prop played in development, where the page is on
 * `http://localhost`, and showed nothing in the app people install
 * (tauri-apps/tauri#14422). The audience output and the operator's preview
 * were both affected.
 *
 * So a packaged build embeds the website's `/embed/youtube` page, and that
 * page embeds the player from a real https origin YouTube accepts.
 * Development embeds the player directly: it has a referrer of its own, and
 * should not need the website running to show a video.
 *
 * `.mjs`, like its neighbours, so a `node --test` suite can pin it. The
 * website's half is `apps/web/src/lib/youtube-embed.ts`; the two take the same
 * parameters and build the same player address.
 */

/** What a YouTube video id looks like. Anything else is not passed on. */
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

const PRODUCTION_WEB_APP = "https://present.multivrs.space";

/**
 * The video a link points at, or `null` if it is not a YouTube video.
 *
 * Accepts what an operator pastes: `watch?v=`, `youtu.be/`, and the `embed`,
 * `shorts` and `live` paths.
 *
 * @param {string} value
 * @returns {string | null}
 */
export const youtubeVideoId = (value) => {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  let id = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host === "www.youtube-nocookie.com"
  ) {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v");
    } else {
      const [kind, candidate] = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(kind ?? "")) {
        id = candidate ?? null;
      }
    }
  }
  return id && VIDEO_ID.test(id) ? id : null;
};

/**
 * The YouTube player for a video, as the audience sees it: playing, muted,
 * looping, and without YouTube's own furniture.
 *
 * @param {string} id
 * @param {{ start?: number, controls?: boolean }} [options]
 * @returns {string}
 */
export const youtubePlayerUrl = (id, { start = 0, controls = false } = {}) => {
  const params = new URLSearchParams({
    autoplay: "1",
    controls: controls ? "1" : "0",
    disablekb: "1",
    fs: "0",
    iv_load_policy: "3",
    loop: "1",
    modestbranding: "1",
    mute: "1",
    playsinline: "1",
    // `loop` only loops a playlist, so the video is a playlist of itself.
    playlist: id,
    rel: "0",
  });
  if (start > 0) {
    params.set("start", String(start));
  }
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
};

/**
 * Where a packaged build's wrapper page lives, or `null` to embed directly.
 *
 * Both are build-time constants in the renderer (`vite.config.ts` defines
 * them), so this is decided once, when the app is built.
 *
 * @returns {string | null}
 */
const defaultWrapper = () =>
  process.env.NODE_ENV === "production"
    ? process.env.WEB_APP_URL || PRODUCTION_WEB_APP
    : null;

/**
 * The address to put in a YouTube prop's `<iframe>`, or `null` if the link is
 * not a YouTube video.
 *
 * `startSeconds` resumes a video that was already playing when the window
 * opened. `via` is the website to embed through; left out, it is the one this
 * build talks to in production and nothing in development.
 *
 * @param {string} value
 * @param {{ startSeconds?: number, controls?: boolean, via?: string | null }} [options]
 * @returns {string | null}
 */
export const youtubeEmbedUrl = (value, options = {}) => {
  const id = youtubeVideoId(value);
  if (!id) return null;

  const start = Math.max(0, Math.floor(Number(options.startSeconds) || 0));
  const controls = options.controls === true;
  const via = options.via === undefined ? defaultWrapper() : options.via;

  if (!via) {
    return youtubePlayerUrl(id, { start, controls });
  }
  const url = new URL("/embed/youtube", via);
  url.searchParams.set("v", id);
  if (controls) url.searchParams.set("controls", "1");
  if (start > 0) url.searchParams.set("start", String(start));
  return url.toString();
};
