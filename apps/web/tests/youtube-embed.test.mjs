import assert from "node:assert/strict";
import test from "node:test";

const { youtubeEmbedPage, youtubePlayerUrl } = await import("../src/lib/youtube-embed.ts");

const page = (query) =>
  youtubeEmbedPage(new URL(`https://present.multivrs.space/embed/youtube${query}`));

test("the page frames the player from this site's origin, so YouTube has a referrer", () => {
  const { status, headers, body } = page("?v=dQw4w9WgXcQ&start=42");
  assert.equal(status, 200);
  assert.match(headers["content-type"], /^text\/html/);
  assert.equal(headers["referrer-policy"], "strict-origin-when-cross-origin");

  const src = body.match(/<iframe src="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  assert.ok(src, "the page holds the player");
  const player = new URL(src);
  assert.equal(player.origin, "https://www.youtube-nocookie.com");
  assert.equal(player.pathname, "/embed/dQw4w9WgXcQ");
  assert.equal(player.searchParams.get("start"), "42");
  assert.equal(player.searchParams.get("origin"), "https://present.multivrs.space");
  assert.equal(player.searchParams.get("autoplay"), "1");
  assert.equal(player.searchParams.get("mute"), "1");
  assert.equal(player.searchParams.get("controls"), "0");
  assert.match(body, /allow="autoplay; encrypted-media; picture-in-picture"/);
});

test("the app can frame it: nothing forbids being framed", () => {
  // The app frames it from `tauri://localhost`, which a `frame-ancestors`
  // list cannot name: any such list would refuse the one page it is for.
  const { headers } = page("?v=dQw4w9WgXcQ");
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  assert.ok(!names.includes("x-frame-options"));
  assert.ok(!headers["content-security-policy"].includes("frame-ancestors"));
  assert.match(headers["content-security-policy"], /frame-src https:\/\/www\.youtube-nocookie\.com/);
});

test("anything but a video id is refused, so nothing a link carries becomes markup", () => {
  for (const query of ["", "?v=", '?v="><script>alert(1)</script>', "?v=../../x", "?v=a"]) {
    const { status, body } = page(query);
    assert.equal(status, 400, query);
    assert.ok(!body.includes("<script"), query);
  }
});

test("the preview's controls are passed through, and a nonsense start is ignored", () => {
  const withControls = page("?v=dQw4w9WgXcQ&controls=1&start=nope").body;
  assert.match(withControls, /controls=1/);
  assert.doesNotMatch(withControls, /start=/);
  assert.equal(
    youtubePlayerUrl("dQw4w9WgXcQ"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&loop=1&modestbranding=1&mute=1&playsinline=1&playlist=dQw4w9WgXcQ&rel=0",
  );
});
