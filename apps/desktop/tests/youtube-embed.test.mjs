import assert from "node:assert/strict";
import test from "node:test";

import {
  youtubeEmbedUrl,
  youtubePlayerUrl,
  youtubeVideoId,
} from "../src/shared/lib/youtube-embed.mjs";

test("the links an operator pastes all name the same video", () => {
  for (const link of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?si=abc",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    "  https://youtu.be/dQw4w9WgXcQ  ",
  ]) {
    assert.equal(youtubeVideoId(link), "dQw4w9WgXcQ", link);
  }
});

test("anything that is not a YouTube video is not embedded", () => {
  for (const link of [
    "",
    "not a url",
    "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/channel/UC123",
    "https://www.youtube.com/watch",
    // An id is passed on into a URL, so nothing but an id's characters.
    'https://youtu.be/abc"><script>',
    "https://www.youtube.com/watch?v=../../admin",
  ]) {
    assert.equal(youtubeVideoId(link), null, link);
    assert.equal(youtubeEmbedUrl(link, { via: null }), null, link);
  }
});

test("a packaged build embeds through the website, which has a referrer YouTube accepts", () => {
  // `tauri://localhost` sends none, and YouTube answers a referrer-less embed
  // with Error 153 — the prop that played in development and was blank in the
  // installed app.
  const url = new URL(
    youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ", {
      startSeconds: 12.7,
      via: "https://present.multivrs.space",
    }),
  );
  assert.equal(url.origin, "https://present.multivrs.space");
  assert.equal(url.pathname, "/embed/youtube");
  assert.equal(url.searchParams.get("v"), "dQw4w9WgXcQ");
  assert.equal(url.searchParams.get("start"), "12");
  assert.equal(url.searchParams.get("controls"), null);

  const preview = new URL(
    youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ", {
      controls: true,
      via: "https://present.multivrs.space/",
    }),
  );
  assert.equal(preview.searchParams.get("controls"), "1");
  assert.equal(preview.searchParams.get("start"), null);
});

test("development embeds the player directly, playing, muted and looping", () => {
  const url = new URL(youtubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ", { via: null }));
  assert.equal(url.origin, "https://www.youtube-nocookie.com");
  assert.equal(url.pathname, "/embed/dQw4w9WgXcQ");
  assert.equal(url.searchParams.get("autoplay"), "1");
  assert.equal(url.searchParams.get("mute"), "1");
  assert.equal(url.searchParams.get("loop"), "1");
  // `loop` loops a playlist, so the video must be one of itself.
  assert.equal(url.searchParams.get("playlist"), "dQw4w9WgXcQ");
  assert.equal(url.searchParams.get("controls"), "0");
  assert.equal(youtubePlayerUrl("dQw4w9WgXcQ"), url.toString());
});
