import assert from "node:assert/strict";
import test from "node:test";

import {
  alignHeard,
  buildLibraryIndex,
  createCatchUp,
  createFollower,
  createHeardWords,
  cueOf,
  findOtherSong,
  heardWord,
  identifySong,
  libraryCandidates,
  likeness,
  prepareSong,
  songKeyterms,
  soundOf,
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
// The chorus kept once, as many libraries keep it: the operator goes back.
const itIsWell = {
  id: "well",
  title: "It Is Well",
  slides: [
    { label: "Verse 1", text: "When peace like a river attendeth my way\nWhen sorrows like sea billows roll" },
    { label: "Verse 1", text: "Whatever my lot thou hast taught me to say\nIt is well it is well with my soul" },
    { label: "Chorus", text: "It is well with my soul\nIt is well it is well with my soul" },
    { label: "Verse 2", text: "Though Satan should buffet though trials should come\nLet this blest assurance control" },
    { label: "Verse 2", text: "That Christ has regarded my helpless estate\nAnd hath shed his own blood for my soul" },
    { label: "Verse 3", text: "My sin oh the bliss of this glorious thought\nMy sin not in part but the whole" },
  ],
};
const holyHolyHoly = {
  id: "holy",
  title: "Holy, Holy, Holy",
  slides: [
    { label: "Verse 1", text: "Holy holy holy Lord God Almighty\nEarly in the morning our song shall rise to thee" },
    { label: "Verse 1", text: "Holy holy holy merciful and mighty\nGod in three persons blessed Trinity" },
  ],
};

/**
 * Words as the speech service sends them: one more each time, every `gap`
 * ms, as one turn that ends with the last of them.
 */
function sing(follower, song, text, { from = 0, start = 0, gap = 600, heard = createHeardWords() } = {}) {
  let current = from;
  let now = start;
  const moves = [];
  let sung = "";
  for (const word of text.split(/\s+/)) {
    sung = sung ? `${sung} ${word}` : word;
    heard.hear(sung, false);
    now += gap;
    const next = follower.step({ song, heard: heard.words(), currentIndex: current, now });
    if (next !== null) {
      moves.push({ word, slide: next });
      current = next;
    }
  }
  heard.hear(sung, true);
  return { moves, current, now, heard };
}

test("words are compared without case, punctuation, apostrophes or section markers", () => {
  assert.deepEqual(wordsOf("[Chorus] 'Twas grace, that TAUGHT my heart…"), ["twas", "grace", "that", "taught", "my", "heart"]);
  assert.deepEqual(wordsOf("¡Cuán grande es Él!"), ["cuán", "grande", "es", "él"]);
});

test("words that sound alike when sung match", () => {
  assert.equal(soundOf("wretch"), soundOf("rich"));
  assert.equal(soundOf("grace"), soundOf("grays"));
  assert.equal(soundOf("savior"), soundOf("saviour"));
  assert.equal(soundOf("mercy"), soundOf("mercies"));
  const word = (text) => heardWord(text, 0);
  assert.equal(likeness(word("grace"), word("grace")), 1);
  assert.ok(likeness(word("rich"), word("wretch")) >= 0.85);
  assert.ok(likeness(word("thought"), word("taught")) > 0, "a near spelling");
  assert.ok(likeness(word("preci"), word("precious")) > 0, "a word cut short as it is held");
  assert.equal(likeness(word("river"), word("roll")), 0);
});

test("one real word of the next slide moves it, once its own slide has been sung", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower();
  const { moves } = sing(follower, song, "amazing grace how sweet the sound that saved a wretch like me i once was lost");
  assert.deepEqual(moves[0], { word: "once", slide: 1 }, "on the first real word, not after a line of it");
});

test("a misheard word or two still follows the song", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower();
  const { moves } = sing(follower, song, "amazing grays how sweet the sound that save our rich like me i want was lost");
  assert.equal(moves[0]?.slide, 1);
  assert.equal(moves[0]?.word, "lost", "'want' for 'once' says nothing; 'lost' does");
});

test("words of the slide showing never move it", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower();
  const { moves } = sing(follower, song, "amazing grace how sweet the sound amazing grace how sweet the sound");
  assert.deepEqual(moves, []);
});

test("the song's name said before the band begins moves nothing", () => {
  const song = prepareSong(itIsWell);
  const follower = createFollower();
  const said = sing(follower, song, "it is well with my soul by horatio spafford", { gap: 250 });
  assert.deepEqual(said.moves, [], "the end of slide 2 and the chorus's start, said, not sung");
  const sung = sing(follower, song, "when peace like a river attendeth my way", { start: said.now, heard: said.heard });
  assert.deepEqual(sung.moves, []);
});

test("a band that starts on another slide is followed there once it is plain", () => {
  const song = prepareSong(itIsWell);
  const follower = createFollower();
  const { moves } = sing(follower, song, "it is well with my soul it is well it is well with my soul");
  assert.equal(moves[0]?.slide, 2, "the chorus, from its start, after enough of it");
});

test("a chorus kept once is gone back to after each verse, and the next verse follows it", () => {
  const song = prepareSong(itIsWell);
  const follower = createFollower();
  let run = sing(follower, song, "whatever my lot thou hast taught me to say it is well it is well with my soul", { from: 1 });
  run = sing(follower, song, "it is well with my soul it is well it is well with my soul", {
    from: run.current,
    start: run.now,
    heard: run.heard,
  });
  assert.equal(run.current, 2, "verse 1 into the chorus");
  run = sing(follower, song, "though satan should buffet though trials should come let this blest assurance control that christ has regarded my helpless estate and hath shed his own blood for my soul", {
    from: run.current,
    start: run.now,
    heard: run.heard,
  });
  assert.equal(run.current, 4, "the chorus into verse 2, and on");
  run = sing(follower, song, "it is well with my soul", { from: run.current, start: run.now, heard: run.heard });
  assert.deepEqual(run.moves[0], { word: "well", slide: 2 }, "back to the chorus, on its first real word");
  run = sing(follower, song, "it is well it is well with my soul my sin oh the bliss", {
    from: run.current,
    start: run.now,
    heard: run.heard,
  });
  assert.equal(run.current, 5, "on from verse 2, to verse 3, not to the slide after the chorus");
});

// Written for this test: verses, a chorus kept once, a bridge.
const lanterns = {
  id: "lanterns",
  title: "Lanterns",
  slides: [
    { label: "Verse 1", text: "Light the lanterns on the shore\nOpen every shuttered door" },
    { label: "Verse 1", text: "Call the wanderers from the sea\nBring them safely home to me" },
    { label: "Chorus", text: "Shine on, shine on\nUntil the night is gone" },
    { label: "Verse 2", text: "Mend the nets and trim the sail\nTell the old forgotten tale" },
    { label: "Verse 2", text: "Every sorrow, every scar\nGuided by the morning star" },
    { label: "Bridge", text: "Higher, higher, burning bright\nCarry us into the light" },
  ],
};

test("a worship leader's call is read as the slide it means", () => {
  const song = prepareSong(lanterns);
  const call = (text, current) => cueOf(song, wordsOf(text), current).slide;
  assert.equal(call("one more time", 2), 2, "the section showing, again");
  assert.equal(call("sing it again", 4), 3, "from the section's start");
  assert.equal(call("back to the chorus", 4), 2);
  assert.equal(call("take it to the bridge", 2), 5);
  assert.equal(call("verse two", 0), 3);
  assert.equal(call("from the top", 5), 0);
  assert.equal(call("shine on shine on", 2), -1, "singing is no call");
  const sungCall = prepareSong({ id: "x", title: "x", slides: [{ text: "One more time I come to you" }] });
  assert.equal(cueOf(sungCall, wordsOf("one more time"), 0).slide, -1, "a call in the song's own words is sung, not said");
});

test("after a call, one word of the slide called for moves there", () => {
  const song = prepareSong(lanterns);
  const follower = createFollower();
  let run = sing(follower, song, "higher higher burning bright carry us into the light", { from: 5 });
  assert.deepEqual(run.moves, []);
  run = sing(follower, song, "one more time", { from: 5, start: run.now, heard: run.heard, gap: 250 });
  assert.equal(follower.takeCall()?.slide, 5);
  assert.equal(follower.expected(song, 5, run.now), 5, "the bridge again is expected");
  run = sing(follower, song, "higher higher burning bright", { from: 5, start: run.now, heard: run.heard });
  assert.deepEqual(run.moves, [], "the bridge again: it is the slide showing");
  // On the bridge, a call for the chorus.
  run = sing(follower, song, "back to the chorus", { from: 5, start: run.now, heard: run.heard, gap: 250 });
  run = sing(follower, song, "shine on", { from: 5, start: run.now, heard: run.heard });
  assert.deepEqual(run.moves[0], { word: "shine", slide: 2 });
});

test("where the song is expected to go is said ahead", () => {
  const song = prepareSong(lanterns);
  const follower = createFollower();
  assert.equal(follower.expected(song, 0, 0), 1, "the next slide");
  assert.equal(follower.expected(song, 1, 0), 2, "after a verse, the chorus kept once");
  assert.equal(follower.expected(song, 5, 0), 2, "after the bridge, the chorus");
});

test("with ahead, the next slide goes up as the last word of the one showing is sung", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower({ ahead: true });
  const { moves } = sing(follower, song, "amazing grace how sweet the sound that saved a wretch like me");
  assert.deepEqual(moves, [{ word: "me", slide: 1 }]);
});

test("with ahead, a last line half heard waits for the next slide's first word", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower({ ahead: true });
  // "that saved a wretch" not heard: only the end of the line.
  const { moves } = sing(follower, song, "amazing grace how sweet the sound like me i once");
  assert.deepEqual(moves, [{ word: "once", slide: 1 }]);
});

test("with ahead, a verse already sung isn't put up again: the song may be over", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower({ ahead: true });
  let run = sing(follower, song, "amazing grace how sweet the sound that saved a wretch like me i once was lost but now am found was blind but now i see");
  assert.equal(run.current, 2, "verse 2 put up as verse 1 ended");
  // The band sings verse 1 again instead, to the end.
  run = sing(follower, song, "amazing grace how sweet the sound that saved a wretch like me i once was lost but now am found was blind but now i see", {
    from: run.current,
    start: run.now + 4000,
    heard: run.heard,
  });
  assert.equal(run.current, 1, "back with the band, and not on to verse 2 a second time");
});

test("after a chorus, the song goes on after the whole verse, though its end wasn't heard", () => {
  const song = prepareSong(lanterns);
  const follower = createFollower();
  // The band sang all of verse 2; only its first slide was heard.
  let run = sing(follower, song, "mend the nets and trim the sail tell the old forgotten tale", { from: 3 });
  run = sing(follower, song, "shine on shine on until the night is gone", { from: 3, start: run.now + 8000, heard: run.heard });
  assert.equal(run.current, 2);
  assert.equal(follower.expected(song, 2, run.now), 5, "the bridge, not the second half of verse 2");
});

test("a word heard in two pieces counts as one", () => {
  // Written for this test.
  const song = prepareSong({
    id: "chosen",
    title: "Chosen",
    slides: [{ text: "Chosen and forgiven\nWe lift our voices high" }],
  });
  const heard = wordsOf("shows in and forgiven we lift").map(heardWord);
  const found = alignHeard(song, heard);
  assert.equal(found?.slide, 0);
  assert.ok((found?.score ?? 0) >= 3, `"shows in" heard for "chosen" still lines up (${found?.score})`);
});

test("the next slide moves on its first real word, though the end of the one showing was misheard", () => {
  const song = prepareSong(lanterns);
  const follower = createFollower();
  let run = sing(follower, song, "light the lanterns on the shore oh pen every shut her drawer");
  assert.deepEqual(run.moves, []);
  run = sing(follower, song, "call the wanderers", { start: run.now, heard: run.heard });
  assert.deepEqual(run.moves[0], { word: "call", slide: 1 });
});

test("just put up, the slide that comes next takes two real words, not one", () => {
  const song = prepareSong(lanterns);
  const follower = createFollower();
  const { moves } = sing(follower, song, "call the wanderers from the sea");
  assert.deepEqual(moves[0], { word: "wanderers", slide: 1 });
});

// Written for this test: a chorus written out after every verse, as the
// owner's library holds songs.
const harbour = {
  id: "harbour",
  title: "Harbour",
  slides: [
    { label: "Verse 1", text: "Across the water through the storm\nYou pull the weary sailors home" },
    { label: "Chorus", text: "Anchor of my soul\nKeep me in your harbour" },
    { label: "Verse 2", text: "The lighthouse burns on rocky ground\nThe lost are seen the drowning found" },
    { label: "Chorus", text: "Anchor of my soul\nKeep me in your harbour" },
    { label: "Verse 3", text: "And when the final tide is low\nI walk the shore I long to know" },
    { label: "Chorus", text: "Anchor of my soul\nKeep me in your harbour" },
  ],
};

test("of slides alike, the one after the slide showing is where the song goes", () => {
  const song = prepareSong(harbour);
  const follower = createFollower();
  let run = sing(follower, song, "the lighthouse burns on rocky ground the lost are seen", { from: 2 });
  // Only "harbour": the chorus is under way, its first words not heard.
  run = sing(follower, song, "keep me in your harbour", { from: run.current, start: run.now, heard: run.heard });
  assert.equal(run.current, 3, "the chorus after verse 2, not the first one");
});

test("with ahead, the slide changes on its last three words, though the line was half misheard", () => {
  const song = prepareSong(harbour);
  const follower = createFollower({ ahead: true });
  const { moves } = sing(follower, song, "across the water through the storm you pool the weary sailors home");
  assert.deepEqual(moves, [{ word: "home", slide: 1 }]);
});

test("with ahead, a slide whose lines end alike isn't over at the end of its first", () => {
  const song = prepareSong(itIsWell);
  const follower = createFollower({ ahead: true });
  const { moves } = sing(follower, song, "it is well with my soul", { from: 2 });
  assert.deepEqual(moves, [], "the chorus's first line ends as its last does");
});

test("the hearing through the band only ever moves the slide on", () => {
  const song = prepareSong(harbour);
  const catchUp = createCatchUp();
  const words = (text) => wordsOf(text).map(heardWord);
  // Words of verse 2, late, after the slide moved on to the chorus.
  catchUp.shown(0);
  assert.equal(
    catchUp.step({ song, heard: words("the lighthouse burns on rocky ground the lost are seen"), currentIndex: 3, now: 1000 }),
    null,
    "not back to the verse it heard late",
  );
  // Verse 3 sung, the agent's own hearing having missed it.
  catchUp.shown(100);
  const heard = wordsOf("and when the final tide is low i walk the shore").map((text, at) => heardWord(text, 100 + at));
  assert.equal(catchUp.step({ song, heard, currentIndex: 3, now: 2000 }), 4, "on to the verse after the chorus showing");
});

// Written for this test: a chorus marked to be sung three times, a tag line
// marked twice, and a bridge marked "Repeat" with no count.
const marked = {
  id: "marked",
  title: "Marked",
  slides: [
    { label: "Verse 1", text: "Morning breaks across the valley\nGolden fields are waking slowly" },
    { label: "Chorus", sectionRepeat: "x3", text: "Sing hallelujah to the mountain king\nRaise the banner over everything" },
    { label: "Bridge", modifier: "Repeat", text: "Higher and higher the rivers run\nBrighter than silver beneath the sun" },
    { label: "Tag", modifier: "x2", text: "Glory forever and evermore" },
    { label: "Verse 2", text: "Evening settles on the harbor\nLanterns burning ever farther" },
  ],
};
const chorus = "sing hallelujah to the mountain king raise the banner over everything";

test("a section marked x3 is sung three times before the song goes on", () => {
  const song = prepareSong(marked);
  const follower = createFollower({ ahead: true });
  let run = sing(follower, song, chorus, { from: 1 });
  assert.deepEqual(run.moves, [], "the end of the first time: it waits to hear what comes");
  assert.equal(follower.expected(song, 1, run.now), 1, "the chorus again is expected");
  run = sing(follower, song, chorus, { from: 1, start: run.now, heard: run.heard });
  assert.deepEqual(run.moves, [], "the second time: still the chorus, and still it waits");
  run = sing(follower, song, chorus, { from: 1, start: run.now, heard: run.heard });
  assert.equal(run.current, 2, "the third time done, the bridge is up as it ends");
});

test("a section marked Repeat waits for the first word of what comes, either way", () => {
  const song = prepareSong(marked);
  const follower = createFollower({ ahead: true });
  let run = sing(follower, song, "higher and higher the rivers run brighter than silver beneath the sun", { from: 2 });
  assert.deepEqual(run.moves, [], "no guess at the end of a section that may be sung again");
  run = sing(follower, song, "higher and", { from: 2, start: run.now, heard: run.heard });
  assert.deepEqual(run.moves, [], "sung again: it is the slide showing");
  run = sing(follower, song, "and higher the rivers run brighter than silver beneath the sun glory", {
    from: 2,
    start: run.now,
    heard: run.heard,
  });
  assert.deepEqual(run.moves.at(-1), { word: "glory", slide: 3 }, "on to the tag on its first real word");
});

test("a slide marked x2 is sung twice before the song goes on", () => {
  const song = prepareSong(marked);
  const follower = createFollower({ ahead: true });
  let run = sing(follower, song, "glory forever and evermore", { from: 3 });
  assert.deepEqual(run.moves, [], "once");
  run = sing(follower, song, "glory forever and evermore", { from: 3, start: run.now, heard: run.heard });
  assert.equal(run.current, 4, "twice, then on to verse 2 as it ends");
});

test("slides that begin alike are told apart by where the song is", () => {
  const song = prepareSong(holyHolyHoly);
  const follower = createFollower();
  let run = sing(follower, song, "holy holy holy lord god almighty early in the morning our song shall rise to thee");
  assert.deepEqual(run.moves, []);
  run = sing(follower, song, "holy holy holy merciful", { from: run.current, start: run.now, heard: run.heard });
  assert.equal(run.current, 1);
});

test("right after a move, the last words of the slide it left don't take it back", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower();
  const heard = createHeardWords();
  let run = sing(follower, song, "that saved a wretch like me i once", { heard });
  assert.equal(run.current, 1);
  // The service sends the turn again, finished, with the old slide's words.
  heard.hear("That saved a wretch like me, I once", true);
  const step = follower.step({ song, heard: heard.words(), currentIndex: 1, now: run.now + 200 });
  assert.equal(step, null);
});

test("after the operator moves the slide, earlier words say nothing about where to go", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower();
  const run = sing(follower, song, "amazing grace how sweet the sound that saved a wretch like me");
  follower.anchor(run.heard.count());
  // The operator jumped to verse 2; the band sings on into it.
  const next = sing(follower, song, "twas grace that taught my heart", { from: 2, start: run.now, heard: run.heard });
  assert.deepEqual(next.moves, []);
});

test("singing nothing like the song leaves the slide alone", () => {
  const song = prepareSong(amazingGrace);
  const follower = createFollower();
  const { moves } = sing(follower, song, "please turn to the person next to you and say good morning", { from: 1 });
  assert.deepEqual(moves, []);
});

test("the line-up says where it ends and how it got there", () => {
  const song = prepareSong(amazingGrace);
  const heard = wordsOf("wretch like me i once was").map(heardWord);
  const found = alignHeard(song, heard, { current: 0 });
  assert.equal(found?.slide, 1);
  assert.equal(found?.from, 0);
  assert.equal(found?.entry, "flow");
  assert.equal(found?.into, 0);
});

test("a few lines find the song, from the service first", () => {
  const service = [amazingGrace, itIsWell, holyHolyHoly].map(prepareSong);
  const words = (text) => wordsOf(text).map(heardWord);
  const found = identifySong(service, words("i once was lost but now am found"));
  assert.equal(found?.song.id, "grace");
  assert.equal(found?.slide, 1);
  assert.equal(identifySong(service, words("good morning church please be seated")), null);
  assert.equal(identifySong(service, words("holy holy")), null, "too little to be sure");
  // The service's next song is taken on less.
  const less = identifySong(service, words("merciful and mighty"), { needFor: (song) => (song.id === "holy" ? 2 : 3) });
  assert.equal(less?.song.id, "holy");
});

test("another song is looked for in the service first, then in the library", () => {
  const words = (text) => wordsOf(text).map(heardWord);
  const library = buildLibraryIndex([amazingGrace, itIsWell, holyHolyHoly]);
  const service = [itIsWell, holyHolyHoly].map(prepareSong);
  const live = prepareSong(itIsWell);

  const next = findOtherSong(words("holy holy holy merciful and mighty"), { live, service, nextServiceId: "holy", library });
  assert.equal(next?.song.id, "holy");
  assert.equal(next?.from, "service");

  const fromLibrary = findOtherSong(words("i once was lost but now am found was blind"), { live, service, library });
  assert.equal(fromLibrary?.song.id, "grace", "not in the service: the library's");
  assert.equal(fromLibrary?.from, "library");
  assert.equal(fromLibrary?.sure, true, "plainly that song: put up without asking");
  assert.equal(
    findOtherSong(words("i once was lost"), { live, service, library })?.song.id,
    "grace",
    "a line no other song has is enough",
  );
  const twin = { id: "twin", title: "Twin", slides: [{ text: "I once was lost but now am found" }] };
  assert.equal(
    findOtherSong(words("i once was lost"), { live, service, library: buildLibraryIndex([amazingGrace, twin, itIsWell]) }),
    null,
    "a line two songs share says neither",
  );

  assert.equal(
    findOtherSong(words("it is well with my soul it is well it is well with my soul"), { live, service, library }),
    null,
    "the song on screen being sung is no other song",
  );
  assert.equal(findOtherSong(words("good morning church please be seated"), { live, service, library }), null);
});

test("a whole line the service didn't hear is passed over", () => {
  const song = prepareSong(itIsWell);
  const words = (text) => wordsOf(text).map(heardWord);
  // "When sorrows like sea billows roll" never came through.
  const found = alignHeard(song, words("when peace like a river attendeth my way whatever my lot thou hast"));
  assert.equal(found?.slide, 1);
  assert.ok((found?.score ?? 0) > 5, "the line-up carries on across the gap");
});

test("songs made of the same words in another order don't crowd out the song sung", () => {
  const shuffled = {
    id: "shuffled",
    title: "Shuffled",
    slides: [{ text: "roll billows sea like sorrows when\nway my attendeth river a like peace when" }],
  };
  const index = buildLibraryIndex([shuffled, holyHolyHoly, amazingGrace, itIsWell]);
  const heard = wordsOf("when peace like a river attendeth my way").map(heardWord);
  assert.equal(libraryCandidates(index, heard, 1)[0], "well");
});

test("a large library is narrowed to the few songs that share the rarer words", () => {
  const index = buildLibraryIndex([amazingGrace, itIsWell, holyHolyHoly]);
  const heard = wordsOf("when sorrows like see billows").map(heardWord);
  assert.equal(libraryCandidates(index, heard)[0], "well");
});

test("the service is told the songs' less common words, within what it takes", () => {
  const terms = songKeyterms([itIsWell, amazingGrace]);
  assert.deepEqual(terms.slice(0, 4), ["peace", "river", "attendeth", "sorrows"], "the song on screen's first");
  assert.ok(terms.includes("wretch"));
  assert.ok(!terms.includes("with") && !terms.includes("their"), "no common or short words");
  assert.equal(new Set(terms.map((term) => term.toLowerCase())).size, terms.length, "each once");
  const many = {
    id: "y",
    title: "y",
    slides: Array.from({ length: 150 }, (_, n) => ({ text: `wordnumber${n}` })),
  };
  assert.equal(songKeyterms([many]).length, 100);
});

test("heard words keep finished turns and the one being sung, numbered in order", () => {
  const heard = createHeardWords(6);
  heard.hear("Amazing grace", false);
  heard.hear("Amazing grace how sweet", false);
  assert.deepEqual(heard.words().map((word) => word.text), ["amazing", "grace", "how", "sweet"]);
  assert.equal(heard.count(), 4);
  heard.hear("Amazing grace, how sweet the sound.", true);
  heard.hear("amazing grace how sweet the sound", true);
  assert.deepEqual(heard.words().map((word) => word.text), ["amazing", "grace", "how", "sweet", "the", "sound"], "the turn once, sent twice");
  heard.hear("that saved", false);
  assert.deepEqual(heard.words().map((word) => word.text), ["how", "sweet", "the", "sound", "that", "saved"]);
  assert.deepEqual(heard.words().map((word) => word.index), [2, 3, 4, 5, 6, 7]);
});

test("a turn that ended without its final copy is kept when the next begins", () => {
  const heard = createHeardWords();
  heard.hear("amazing grace how", false, "1:0");
  // The connection went; a new session's first turn.
  heard.hear("sweet the", false, "2:0");
  assert.deepEqual(heard.words().map((word) => word.text), ["amazing", "grace", "how", "sweet", "the"]);
  assert.deepEqual(heard.words().map((word) => word.index), [0, 1, 2, 3, 4]);
});
