/**
 * The page the desktop app embeds a YouTube prop through.
 *
 * The installed app serves its windows from `tauri://localhost`, which sends
 * no `Referer`, and YouTube answers a referrer-less embed with "Error 153:
 * video player configuration error" (tauri-apps/tauri#14422). This page is
 * the player's immediate parent instead: it is on this site's https origin,
 * so YouTube sees a referrer it accepts, while the app frames it as before.
 *
 * It takes a video id and nothing that could become markup. The desktop half
 * is `apps/desktop/src/shared/lib/youtube-embed.mjs`; the player address is
 * built the same way on both sides, so keep the two in step.
 */

/** What a YouTube video id looks like. Anything else is refused. */
const VIDEO_ID = /^[A-Za-z0-9_-]{6,20}$/;

export type EmbedPage = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/** The YouTube player for a video: playing, muted, looping, unadorned. */
export const youtubePlayerUrl = (
  id: string,
  { start = 0, controls = false, origin }: { start?: number; controls?: boolean; origin?: string } = {},
): string => {
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
  if (start > 0) params.set("start", String(start));
  if (origin) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
};

const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * The response for `/embed/youtube?v=<id>[&start=<seconds>][&controls=1]`.
 *
 * No `frame-ancestors` and no `X-Frame-Options`: framing this page is the
 * whole point, and the app that does it is on a scheme (`tauri:`) that a
 * `frame-ancestors` source list cannot name. It shows a public video and
 * takes no input, so there is nothing for a framing page to trick anyone
 * into.
 */
export const youtubeEmbedPage = (requestUrl: URL): EmbedPage => {
  const id = requestUrl.searchParams.get("v") ?? "";
  if (!VIDEO_ID.test(id)) {
    return {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "Not a YouTube video id.",
    };
  }

  const start = Math.max(0, Math.floor(Number(requestUrl.searchParams.get("start")) || 0));
  const controls = requestUrl.searchParams.get("controls") === "1";
  const player = youtubePlayerUrl(id, { start, controls, origin: requestUrl.origin });

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>YouTube</title>
<style>
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<iframe src="${escapeAttribute(player)}" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body>
</html>
`;

  return {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // The page may frame YouTube's player and style itself, and nothing
      // else: no scripts of its own at all.
      "content-security-policy":
        "default-src 'none'; frame-src https://www.youtube-nocookie.com; style-src 'unsafe-inline'",
      // The origin, which is what YouTube checks, and never the query.
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-robots-tag": "noindex",
      // The same address always answers the same page.
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
    body,
  };
};
