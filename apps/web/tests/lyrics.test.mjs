import assert from "node:assert/strict";
import test from "node:test";

const { lyricsFromSlides, parseLyricsToSlides, slidesFromLyrics } = await import("../../../packages/shared/src/lyrics.ts");

const song = `[Verse 1]
Amazing grace, how sweet the sound
That saved a wretch like me

[Chorus x2]
My chains are gone
I've been set free

Unending love [x2]`;

test("lyrics become slides and come back as the same lyrics", () => {
  const slides = parseLyricsToSlides(song);
  assert.deepEqual(
    slides.map((slide) => [slide.label, slide.sectionRepeat ?? null, slide.modifier ?? null]),
    [
      ["Verse 1", null, null],
      ["Chorus", "x2", null],
      ["Chorus", "x2", "x2"],
    ],
  );
  assert.deepEqual(parseLyricsToSlides(lyricsFromSlides(slides)), slides);
});

test("editing lyrics keeps each slide's look", () => {
  let counter = 0;
  const makeId = () => `new_${(counter += 1)}`;
  const styled = {
    id: "s1",
    type: "text",
    content: "old words",
    textBody: { paragraphs: [{ runs: [{ text: "old words" }] }] },
    richTextHtml: "<p>old words</p>",
    style: { color: "#f5c95a", fontFamily: "Playfair Display" },
    x: 0,
    y: 0,
  };
  const previous = [
    { id: "a", text: "old words", label: "Verse 1", labelColor: "#f00", backgroundColor: "#111", useBackgroundColor: true, elements: [styled, { id: "logo", type: "image", content: "logo.png" }] },
  ];

  const next = slidesFromLyrics(`[Verse 1]\nnew words\n\n[Chorus]\nmore words`, previous, makeId);

  assert.equal(next[0].id, "a", "the first slide keeps its id");
  assert.equal(next[0].labelColor, "#f00");
  assert.equal(next[0].elements.length, 2, "its image stays");
  assert.equal(next[0].elements[0].content, "new words");
  assert.deepEqual(next[0].elements[0].style, styled.style);
  assert.equal(next[0].elements[0].textBody, undefined, "the old structured text would show the old words");
  assert.equal(next[0].elements[0].richTextHtml, undefined);

  assert.equal(next[1].id, "new_1");
  assert.equal(next[1].backgroundColor, "#111", "a new slide takes the last one's background");
  assert.equal(next[1].labelColor, undefined, "a different section keeps no colour");
  assert.equal(next[1].elements.length, 1, "and only its text box");
  assert.equal(next[1].elements[0].id, "new_1_text_0");
  assert.deepEqual(next[1].elements[0].style, styled.style);
});

test("a slide that had no styled text box isn't given another slide's", () => {
  const previous = [
    { id: "plain", text: "one" },
    { id: "gold", text: "two", elements: [{ id: "e", type: "text", content: "two", style: { color: "gold" } }] },
  ];
  const next = slidesFromLyrics("one again\n\ntwo again\n\nthree", previous, () => "made");
  assert.equal(next[0].elements, undefined);
  assert.equal(next[1].elements[0].content, "two again");
  assert.equal(next[2].elements[0].style.color, "gold", "the new third slide copies the last styled one");
});

test("a song with no styled slides stays unstyled for the app to fill in", () => {
  const next = slidesFromLyrics("one\n\ntwo", [], () => "id");
  assert.equal(next.length, 2);
  assert.equal(next[0].elements, undefined);
});
