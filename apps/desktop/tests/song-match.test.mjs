import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSongIndex,
  confidentSong,
  createFollower,
  createHeardWords,
  findSongs,
  followSong,
  wordsOf,
} from "../src/features/song-agent/song-match.mjs";

// Public-domain hymns, as a library would hold them.
const amazingGrace = {
  id: "grace",
  title: "Amazing Grace",
  slides: [
    { label: "Verse 1", text: "Amazing grace how sweet the sound\nThat saved a wretch like me" },
    { label: "Verse 1", text: "I once was lost but now am found\nWas blind but now I see" },
    { label: "Verse 2", text: "'Twas grace that taught my heart to fear\nAnd grace my fears relieved" },
    { label: "Verse 2", text: "How precious did that grace appear\nThe hour I first believed" },
  ],
};
const holyHolyHoly = {
  id: "holy",
  title: "Holy, Holy, Holy",
  slides: [
    { label: "Verse 1", text: "Holy holy holy Lord God Almighty\nEarly in the morning our song shall rise to thee" },
    { label: "Chorus", text: "Holy holy holy merciful and mighty\nGod in three persons blessed Trinity" },
    { label: "Verse 2", text: "Holy holy holy all the saints adore thee\nCasting down their golden crowns around the glassy sea" },
    { label: "Chorus", text: "Holy holy holy merciful and mighty\nGod in three persons blessed Trinity" },
  ],
};
const itIsWell = {
  id: "well",
  title: "It Is Well",
  slides: [
    { label: "Verse 1", text: "When peace like a river attendeth my way\nWhen sorrows like sea billows roll" },
    { label: "Chorus", text: "It is well with my soul\nIt is well it is well with my soul" },
  ],
};
const library = [amazingGrace, holyHolyHoly, itIsWell];
const words = (text) => wordsOf(text);

test("words are compared without case, punctuation, apostrophes or section markers", () => {
  assert.deepEqual(wordsOf("[Chorus] 'Twas grace, that TAUGHT my heart…"), ["twas", "grace", "that", "taught", "my", "heart"]);
  assert.deepEqual(wordsOf("¡Cuán grande es Él!"), ["cuán", "grande", "es", "él"]);
});

test("a few sung words find the song and the slide", () => {
  const index = buildSongIndex(library);
  const best = confidentSong(findSongs(index, words("i once was lost but now am found")));
  assert.ok(best, "confident");
  assert.equal(index.songs[best.songIndex].id, "grace");
  assert.equal(best.slideIndex, 1);
});

test("a wrong word or two still finds it", () => {
  const index = buildSongIndex(library);
  const best = confidentSong(findSongs(index, words("when peace lie a river attend with my way when sorrows")));
  assert.ok(best);
  assert.equal(index.songs[best.songIndex].id, "well");
});

test("too little, or words in many songs, is not enough to be sure", () => {
  const index = buildSongIndex(library);
  assert.equal(confidentSong(findSongs(index, words("holy holy"))), null);
  assert.equal(confidentSong(findSongs(index, words("and the good news is"))), null);
});

test("a close call goes to a song in the service", () => {
  const twin = { id: "twin", title: "Grace Again", slides: [{ text: amazingGrace.slides[0].text }] };
  const index = buildSongIndex([amazingGrace, twin]);
  const sung = words("amazing grace how sweet the sound that saved");
  assert.equal(index.songs[findSongs(index, sung, { prefer: new Set(["twin"]) })[0].songIndex].id, "twin");
  assert.equal(index.songs[findSongs(index, sung, { prefer: new Set(["grace"]) })[0].songIndex].id, "grace");
});

test("following finds the slide the latest words are on", () => {
  const index = buildSongIndex(library);
  const slides = index.slidePairs[0];
  const found = followSong(slides, words("saved a wretch like me i once was lost but now"), 0);
  assert.equal(found.slideIndex, 1, "the new slide, though the end of the old one was heard too");
});

test("a chorus that comes round again is the one ahead", () => {
  const index = buildSongIndex(library);
  const slides = index.slidePairs[1];
  const sung = words("merciful and mighty god in three persons");
  assert.equal(followSong(slides, sung, 2).slideIndex, 3, "after verse 2, the second chorus");
  assert.equal(followSong(slides, sung, 0).slideIndex, 1, "after verse 1, the first");
  assert.equal(followSong(slides, sung, 3).slideIndex, 3, "on it already, it stays");
});

test("the follower moves on once the singers are plainly on the next slide", () => {
  const index = buildSongIndex(library);
  const slides = index.slidePairs[0];
  const follower = createFollower();
  let now = 10_000;
  assert.equal(follower.step({ slides, words: words("amazing grace how sweet the sound"), currentIndex: 0, now }), null);
  now += 2000;
  assert.equal(
    follower.step({ slides, words: words("that saved a wretch like me i once was lost"), currentIndex: 0, now }),
    1,
    "three pairs on the very next slide are enough at once",
  );
});

test("a jump elsewhere needs the same answer twice", () => {
  const index = buildSongIndex(library);
  const slides = index.slidePairs[0];
  const follower = createFollower();
  const sung = words("how precious did that grace appear");
  assert.equal(follower.step({ slides, words: sung, currentIndex: 0, now: 5000 }), null);
  assert.equal(follower.step({ slides, words: sung, currentIndex: 0, now: 5600 }), 3);
});

test("right after a move it neither moves again nor goes back", () => {
  const index = buildSongIndex(library);
  const slides = index.slidePairs[0];
  const follower = createFollower();
  assert.equal(follower.step({ slides, words: words("wretch like me i once was lost but"), currentIndex: 0, now: 1000 }), 1);
  const stillEnding = words("that saved a wretch like me");
  assert.equal(follower.step({ slides, words: stillEnding, currentIndex: 1, now: 1500 }), null, "held");
  assert.equal(follower.step({ slides, words: stillEnding, currentIndex: 1, now: 3000 }), null, "not back yet");
  assert.equal(follower.step({ slides, words: stillEnding, currentIndex: 1, now: 3500 }), null);
  assert.equal(follower.step({ slides, words: stillEnding, currentIndex: 1, now: 6000 }), null, "heard once");
  assert.equal(follower.step({ slides, words: stillEnding, currentIndex: 1, now: 6500 }), 0, "back, once it is plain");
});

test("singing nothing like the song leaves the slide alone", () => {
  const index = buildSongIndex(library);
  const follower = createFollower();
  const sung = words("please turn to the person next to you and say good morning");
  assert.equal(follower.step({ slides: index.slidePairs[0], words: sung, currentIndex: 1, now: 1000 }), null);
  assert.equal(follower.step({ slides: index.slidePairs[0], words: sung, currentIndex: 1, now: 9000 }), null);
});

test("heard words keep finished turns and the one being spoken", () => {
  const heard = createHeardWords(6);
  heard.hear("Amazing grace", false);
  heard.hear("Amazing grace how sweet", false);
  assert.deepEqual(heard.words(), ["amazing", "grace", "how", "sweet"]);
  heard.hear("Amazing grace, how sweet the sound.", true);
  heard.hear("amazing grace how sweet the sound", true);
  assert.deepEqual(heard.words(), ["amazing", "grace", "how", "sweet", "the", "sound"], "the turn once, sent twice");
  heard.hear("that saved", false);
  assert.deepEqual(heard.words(), ["how", "sweet", "the", "sound", "that", "saved"]);
});
