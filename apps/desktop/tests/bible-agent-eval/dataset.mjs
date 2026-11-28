/**
 * What the Bible agent is measured on: things said in a service, and what
 * must be on the screen after each.
 *
 * A case is a list of turns. Each turn is said a word at a time and ended
 * (`harness.messagesOf`), and may say what the screen must then show:
 *
 * - `screen`: the passage that must be on screen once the turn is over;
 *   `null` for nothing. Left out, the turn only must not show anything wrong.
 * - `allow`: passages that may also go up during the turn without being
 *   wrong (the next verse of a reading, a range read as its first verse).
 * - `hope`: a passage that is right if it goes up and not owed if it does
 *   not (a verse read from its middle, or heard badly). Counted, so a change
 *   that finds fewer of them shows.
 * - `box`: the passage that must be suggested in the box once the turn is
 *   over — the first words of a verse, which are not enough to show it.
 * - `screenVersion`: the Bible the screen must be in once the turn is over.
 *
 * Anything else that reaches the screen is **wrong**: a verse nobody named or
 * read. An expected passage that did not go up is **missed**. Wrong is what
 * the congregation sees; missed is what the operator has to do by hand.
 */

import { readFileSync } from "node:fs";

import { bible } from "./harness.mjs";

/** The same cases every run: a small seeded generator. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wordsOf = (text) => text.split(/\s+/).filter(Boolean);
const refOf = (verse) => `${verse.bookName} ${verse.chapter}:${verse.verse}`;

/** A verse as it is read aloud: a phrase, a breath, the next phrase. */
function phrasesOf(text) {
  const parts = text.split(/(?<=[,;:.!?])\s+/).filter(Boolean);
  const phrases = [];
  for (const part of parts) {
    const last = phrases.at(-1);
    if (last && wordsOf(last).length < 4) phrases[phrases.length - 1] = `${last} ${part}`;
    else phrases.push(part);
  }
  if (phrases.length > 1 && wordsOf(phrases.at(-1)).length < 3) {
    const tail = phrases.pop();
    phrases[phrases.length - 1] = `${phrases.at(-1)} ${tail}`;
  }
  return phrases;
}

/**
 * What a speech service makes of words said with a Nigerian accent, or fast,
 * or far from the microphone: endings dropped ("loved" → "love"), small
 * words lost, a word swapped for one that sounds like it. The swaps are the
 * kind in this app's own log ("Peter" → "Bita", "earth" → "head").
 */
const SOUNDS_LIKE = {
  their: "there", there: "their", to: "two", for: "four", son: "sun", heaven: "even",
  hear: "here", holy: "wholly", peace: "piece", thy: "the", thee: "the", ye: "he",
  hath: "has", unto: "onto", shalt: "shall", saith: "says", earth: "head", the: "de",
  three: "tree", that: "dat", with: "wit", them: "dem", this: "dis", walk: "work",
  heart: "hat", word: "world", world: "word", lord: "load", faith: "fate", thing: "ting",
  things: "tings", think: "tink", father: "fada", brother: "broda", through: "true",
  loved: "love", gave: "give", said: "say", his: "is", him: "im", bread: "bred",
};

export function misheard(text, random, rate = 0.14) {
  return wordsOf(text)
    .map((word) => {
      const roll = random();
      if (roll > rate) return word;
      const [, lead, core, tail] = word.match(/^(\W*)(.*?)(\W*)$/) ?? [];
      const lower = (core ?? "").toLowerCase();
      if (roll < rate * 0.2 && lower.length <= 3) return "";
      const swapped = SOUNDS_LIKE[lower];
      if (swapped) return `${lead}${swapped}${tail}`;
      if (/(?:eth|est)$/.test(lower) && lower.length > 5) return `${lead}${core.slice(0, -3)}${tail}`;
      if (/ed$/.test(lower) && lower.length > 4) return `${lead}${core.slice(0, -1)}${tail}`;
      if (/s$/.test(lower) && lower.length > 3) return `${lead}${core.slice(0, -1)}${tail}`;
      return word;
    })
    .filter(Boolean)
    .join(" ");
}

const cases = [];
const add = (group, id, turns, extra = {}) => {
  cases.push({
    group,
    id: `${group}/${id}`,
    version: "KJV",
    turns: turns.map((turn) => (typeof turn === "string" ? { say: turn } : turn)),
    ...extra,
  });
};

// ---------------------------------------------------------------------------
// 1. Ordinary speech: nothing is named, nothing is read, nothing goes up.
// ---------------------------------------------------------------------------

const real = JSON.parse(
  readFileSync(new URL("../fixtures/heard-ordinary-speech.json", import.meta.url), "utf8"),
).lines;

/** Things a preacher says that sound like the Bible and quote none of it. */
const WRITTEN_SPEECH = [
  "One day a man.",
  "One day a man came to my office and he said, pastor, I need your help.",
  "One day a man was walking along the road and he saw a woman selling oranges.",
  "One day, a certain man came to me after service.",
  "There was a man in my village when I was growing up.",
  "And he said to me, my brother, what are you doing here?",
  "I said to him, sir, I have come to see you.",
  "And the man said, no problem, come back tomorrow.",
  "Number one, you must be born again. Number two, you must pray.",
  "Point number three is that we should love one another as a family.",
  "Number four. Number five. Number six.",
  "My first point this morning, my second point, and then the third point.",
  "The service starts at 9:30 and the second service is at 11:45.",
  "We have 3 pastors and 16 deacons in this church.",
  "I remember the first time I came to this church.",
  "When I was a young man, my father told me something.",
  "God is good all the time, and all the time God is good.",
  "Somebody shout hallelujah. Praise the Lord, somebody.",
  "In the name of Jesus. In the mighty name of Jesus we pray.",
  "Father, we thank you. Lord, we give you all the glory.",
  "The Lord told me to tell somebody here today, your time has come.",
  "Tell your neighbour, neighbour, it is your season.",
  "Let us pray. Father in the name of Jesus, we come before you this morning.",
  "And it came to pass that we travelled to Abuja last week.",
  "The man of God said to me, my son, do not be afraid of them.",
  "I want you to turn to your neighbour and say, you are blessed.",
  "The children of God must learn how to manage money.",
  "The kingdom of God is not about eating and drinking in the canteen.",
  "My people, let me tell you the truth this morning.",
  "And they said to him, where are you going with all these things?",
  "He went to the house of his friend and he knocked on the door.",
  "So the woman went to the market and she bought fish and bread.",
  "The king of that town called all the elders together.",
  "In the beginning of this year, I told you that this is our year.",
  "At the end of the day, what matters is the heart of a man.",
  "Let there be peace in your home. Let there be joy in your family.",
  "I am the pastor of this church and I am telling you the truth.",
  "The spirit of God is here. The presence of the Lord is in this place.",
  "Mark my words, 2 years from now you will remember this day.",
  "My job is to tell you the truth. I got that job 2 years ago.",
  "John came to see me on Tuesday with 3 of his friends.",
  "James and Peter are in the choir, and Ruth is in the ushering unit.",
  "The judges in that competition gave us 8 out of 10.",
  "The kings of this world will come and go.",
  "Our numbers have grown. We were 16 last year, today we are 300.",
  "Acts of kindness. Do 2 acts of kindness every day this week.",
  "The offering time is blessing time. Bring your tithes and offerings.",
  "Please turn off your phones. Ushers, please help the people at the back.",
  "We will have a meeting after the service for all the workers.",
  "Happy birthday to everyone born in the month of November.",
  "Thus says the Lord. I hear the Lord saying, get ready.",
  "The Bible says. The Bible says something powerful here.",
  "According to the word of God. Hallelujah.",
  "And he said unto them. Are you listening to me?",
  "Verily, verily, I say unto you, church, wake up.",
  "The Lord is good. The Lord is faithful. The Lord is kind.",
  "For God. For God is not a man. Hmm.",
  "The woman of God prayed for her, and she went home rejoicing.",
  "And they went their way, and I went my own way.",
  "Behold, I am telling you a new thing today.",
  "Blessed are you this morning. Blessed is this church.",
  "I will lift up my hands. I will lift up my voice. I will sing.",
  "Come and see what the Lord has done in my family.",
  "He is able. He is more than able. He is God.",
  "My brothers and sisters, the love of money is destroying homes.",
  "They did not know what to do, so they called the pastor.",
  "So what are we going to say about this? Should we continue like this?",
  "Now it happened that the generator went off during the vigil.",
  "And the people said amen. And all the people said amen.",
  "I was there when the thing happened. I saw it with my own eyes.",
  "You shall not die. You shall live. You shall testify.",
  "The first chapter of my life was hard. The second chapter was better.",
  "This is verse one of the song. Then we sing verse two.",
  "Let us sing hymn 23, verse 1 and verse 4.",
  "Sing the chorus, then verse 3.",
  "Turn to page 16 of your hymn book.",
  "He gave me 3 reasons. Reason 1, reason 2, reason 3.",
  "The first 3 chapters of that book are about leadership.",
  "It is well. It is well with my soul. It is well with you.",
  "Give thanks to the Lord. Give him praise. Give him glory.",
  "I know that my God is able to do it. I know it.",
  "Because he lives, I can face tomorrow.",
  "Great is thy faithfulness, oh Lord. Morning by morning.",
  "Amazing grace, how sweet the sound that saved a wretch like me.",
  "What a mighty God we serve. Angels bow before him.",
  "You are the reason why I live. You are the reason why I sing.",
  "The man went back to his house and his wife asked him, where have you been?",
  "So he took the money and he gave it to the poor.",
  "They came to me and said, pastor, pray for us.",
  "And the man answered and said, I do not know.",
  "The woman said to her husband, let us go to church.",
  "Then the people came together to build the church hall.",
  "And when he had finished, he went out and locked the door.",
  "All the people of the town came out to see what was happening.",
  "The young man said, I have kept all these rules since I was a child.",
  "Jesus is Lord. Jesus is king. Jesus is coming again.",
  "God so loves you. God so cares about you this morning.",
  "The love of God. The grace of God. The mercy of God.",
  "Do not be afraid. Do not worry. God is in control.",
  "The Lord will fight for this church. The Lord will provide.",
  // What is said in a Nigerian service between the scriptures.
  "To God be the glory. Great things he has done.",
  "Father, we thank you for the gift of life this morning.",
  "In Jesus' mighty name we have prayed. Amen.",
  "Holy Spirit, have your way in this service.",
  "We cover this service with the blood of Jesus.",
  "God bless you. You may be seated.",
  "Somebody say, I am a child of God.",
  "It shall be well with you and your household.",
  "I decree and I declare that this month shall favour you.",
  "May the good Lord bless you and prosper the work of your hands.",
  "Let somebody shout a thunderous amen.",
  "As many as are here today, you will not miss your blessing.",
  "We give you all the glory, all the honour and all the adoration.",
  "Thank you Jesus. Thank you Lord. We are grateful.",
  "Lift up your hands and begin to worship him.",
  "The Lord is your strength this morning. Say it to your neighbour.",
  "Let us share the grace together.",
  "If you are a first timer, please stand so that we can welcome you.",
  "The ushers will now collect the offering.",
  "Children's church will hold in the hall after the opening prayer.",
  "Our midweek service is every Wednesday by five p.m.",
  "Daddy G.O. said something last month that touched me.",
  "My wife and I have been married for twenty years.",
  "When we were in the university, things were not easy.",
  "I told my daughter, go and read your book.",
  "The devil is a liar. He will not succeed over your life.",
  "You are a winner. You are the head and not the tail.",
  "I am blessed and highly favoured.",
  "Before I go to my message, let me appreciate the choir.",
  "Tell the person beside you, you are looking good today.",
];

const sessions = (lines, size) => {
  const out = [];
  for (let from = 0; from < lines.length; from += size) out.push(lines.slice(from, from + size));
  return out;
};

for (const [at, lines] of sessions(real, 13).entries()) {
  for (const version of ["NKJV", "KJV"]) {
    add("speech-real", `${version}-${at}`, lines.map((say) => ({ say, screen: null })), { version });
  }
  // The same words with a verse already up: it stays up.
  add(
    "speech-real-with-verse-up",
    `${at}`,
    [{ say: "Genesis 2:18.", screen: "Genesis 2:18" }, ...lines.map((say) => ({ say, screen: "Genesis 2:18" }))],
    { version: "NKJV" },
  );
}
for (const [at, lines] of sessions(WRITTEN_SPEECH, 10).entries()) {
  for (const version of ["KJV", "NKJV", "NIV"]) {
    add("speech-written", `${version}-${at}`, lines.map((say) => ({ say, screen: null })), { version });
  }
  add(
    "speech-written-with-verse-up",
    `${at}`,
    [{ say: "John 3:16.", screen: "John 3:16" }, ...lines.map((say) => ({ say, screen: "John 3:16" }))],
  );
}
// Each of them alone too: the first words a microphone hears.
for (const [at, say] of WRITTEN_SPEECH.slice(0, 12).entries()) {
  add("speech-written", `alone-${at}`, [{ say, screen: null }], { version: "NKJV" });
}

// ---------------------------------------------------------------------------
// 2. References named in full.
// ---------------------------------------------------------------------------

const REFERENCES = [
  ["John 3:16.", "John 3:16"],
  ["Turn with me to Romans 8:28.", "Romans 8:28"],
  ["Romans chapter 8 verse 28.", "Romans 8:28"],
  ["The book of John, chapter 3, verse 16.", "John 3:16"],
  ["John chapter three verse sixteen.", "John 3:16"],
  ["First Corinthians chapter 13 verse 4.", "1 Corinthians 13:4"],
  ["1 Corinthians 13:4-7.", "1 Corinthians 13:4-7"],
  ["Second Timothy chapter 1 verse 7.", "2 Timothy 1:7"],
  ["Psalm 23 verse 1.", "Psalms 23:1"],
  ["Psalm 119 verse 105.", "Psalms 119:105"],
  ["Genesis 3 16", "Genesis 3:16"],
  ["Genesis 1 5", "Genesis 1:5"],
  ["Romans 8 verse 1", "Romans 8:1"],
  ["Psalms 46 verse 10", "Psalms 46:10"],
  ["Matthew chapter 6 verse 33.", "Matthew 6:33"],
  ["Let us read from Isaiah chapter 53 verse 5.", "Isaiah 53:5"],
  ["Open your Bibles to Philippians 4:13.", "Philippians 4:13"],
  ["Go to Hebrews 11:1.", "Hebrews 11:1"],
  ["Proverbs 3:5-6.", "Proverbs 3:5-6"],
  ["Jude verse 3.", "Jude 1:3"],
  ["Revelation chapter 21 verse 4.", "Revelation 21:4"],
  ["Ecclesiastes chapter 4 from verse 9 to verse 12.", "Ecclesiastes 4:9-12", ["Ecclesiastes 4:9"]],
  ["Song of Solomon chapter 2 verse 1.", "Song of Solomon 2:1"],
  ["1 John 1:9.", "1 John 1:9"],
  ["Acts 2:38.", "Acts 2:38"],
  ["Deuteronomy 28 verse 1.", "Deuteronomy 28:1"],
  ["Joshua 1:8.", "Joshua 1:8"],
  ["And so in Hebrews chapter 13, and then in verse 15,", "Hebrews 13:15"],
  ["John 3 16 to 18", "John 3:16-18", ["John 3:16"]],
  ["Numbers chapter 6 verse 24.", "Numbers 6:24"],
  ["Numbers 6:24-26.", "Numbers 6:24-26"],
  ["Mark 2 verse 5.", "Mark 2:5"],
  ["Testing, testing Genesis 3 16", "Genesis 3:16"],
  ["Ephesians 1:15-17", "Ephesians 1:15-17"],
  ["We are reading from Matthew chapter 3 verse 1 this morning.", "Matthew 3:1"],
  ["Lamentations 3:22-23.", "Lamentations 3:22-23"],
  ["2 Chronicles 7:14.", "2 Chronicles 7:14"],
  ["First Thessalonians chapter 5 verse 17.", "1 Thessalonians 5:17"],
  ["Habakkuk chapter 2 verse 2.", "Habakkuk 2:2"],
  ["Galatians 5:22.", "Galatians 5:22"],
];
// A range goes up as its first verse while the rest of it is being said.
for (const [at, [say, screen, allow = []]] of REFERENCES.entries()) {
  add("reference", `${at} ${screen}`, [{ say, screen, allow }]);
}

/** A reference that names nothing in the Bible shows nothing. */
const NO_SUCH_VERSE = [
  "John chapter three verse thirty seven.",
  "Psalm 151 verse 1.",
  "Genesis 51:1.",
  "Jude 2:1.",
  "Romans chapter eight verse forty.",
  "Psalm twenty three verse seven.",
  "Matthew 29:1.",
  "Jude verse twenty six.",
  "Third John verse 15.",
  "John 3:37.",
  "Revelation 23:1.",
];
for (const [at, say] of NO_SUCH_VERSE.entries()) {
  add("reference-no-such-verse", `${at}`, [{ say, screen: null }]);
}

/** A chapter alone waits for its verse; it is not a verse to show. */
for (const [at, say] of [
  "Let's open our Bible to John chapter 3.",
  "In 1 Kings 18, Elijah called down fire.",
  "Luke 15, the story of the prodigal son.",
  "Psalm 23.",
  "looking at some of those principles this morning. Uh, John chapter 4.",
].entries()) {
  add("reference-chapter-only", `${at}`, [{ say, screen: null }]);
}

// ---------------------------------------------------------------------------
// 3. References as they are said from a Nigerian pulpit, and as the speech
//    service writes them.
// ---------------------------------------------------------------------------

const PULPIT = [
  ["Revelations chapter 2, verse 1.", "Revelation 2:1"],
  ["Songs of Solomon chapter 2 verse 1.", "Song of Solomon 2:1"],
  ["Philippians 4 13", "Philippians 4:13"],
  ["First Corinthians 13 4", "1 Corinthians 13:4"],
  ["1st John 4 verse 8.", "1 John 4:8"],
  ["Saint John chapter 3 verse 16.", "John 3:16"],
  ["St. John chapter 3 verse 16.", "John 3:16"],
  ["The gospel according to Saint Matthew chapter 5 verse 3.", "Matthew 5:3"],
  ["The gospel of John chapter 1 verse 1.", "John 1:1"],
  ["Acts of the Apostles chapter 2 verse 38.", "Acts 2:38"],
  ["The book of Psalms, Psalm 91 verse 1.", "Psalms 91:1"],
  ["Second Corinthians chapter five, verse seventeen.", "2 Corinthians 5:17"],
  ["The epistle of Paul to the Romans chapter 12 verse 1.", "Romans 12:1"],
  ["Hebrews 11 verse 1.", "Hebrews 11:1"],
  ["Matthew 5 from verse 3.", "Matthew 5:3"],
  ["Isaiah 53 reading from verse 4.", "Isaiah 53:4"],
  ["John 3 verse 16 to 17.", "John 3:16-17", ["John 3:16"]],
  ["The book of Proverbs chapter 3 verse 5.", "Proverbs 3:5"],
  // Said in words, "verse one" is heard on the way to "one hundred and five".
  ["Psalm one hundred and nineteen verse one hundred and five.", "Psalms 119:105", ["Psalms 119:1"]],
  ["Let us go to the book of Isaiah chapter forty verse thirty one.", "Isaiah 40:31"],
  ["Our text is taken from the book of Joshua chapter 1 verse 8.", "Joshua 1:8"],
  ["Kindly open to the book of Jeremiah chapter 29 verse 11.", "Jeremiah 29:11"],
  ["If you have gotten it say amen. Matthew chapter 7 verse 7.", "Matthew 7:7"],
  ["Psalm 23 verse 1", "Psalms 23:1"],
  ["Proverb 3 verse 5.", "Proverbs 3:5"],
  ["Roman chapter 8 verse 28.", "Romans 8:28"],
  ["Hebrew chapter 11 verse 6.", "Hebrews 11:6"],
  ["Act chapter 2 verse 38.", "Acts 2:38"],
  ["Ephesian chapter 6 verse 10.", "Ephesians 6:10"],
  ["Galatian chapter 5 verse 22.", "Galatians 5:22"],
  ["Philippian chapter 4 verse 19.", "Philippians 4:19"],
  ["Colossian chapter 3 verse 23.", "Colossians 3:23"],
  ["First Thessalonian chapter 5 verse 18.", "1 Thessalonians 5:18"],
  ["Second Corinthian chapter 9 verse 7.", "2 Corinthians 9:7"],
  ["First Peter chapter 5 verse 7.", "1 Peter 5:7"],
  ["First Kings chapter 18 verse 21.", "1 Kings 18:21"],
  ["First Samuel chapter 17 verse 45.", "1 Samuel 17:45"],
  ["The first book of Samuel chapter 17 verse 45.", "1 Samuel 17:45"],
  ["Second Kings chapter 4 verse 1.", "2 Kings 4:1"],
  ["Genesis chapter 1 verse 1 to 3.", "Genesis 1:1-3"],
];
for (const [at, [say, screen, allow = []]] of PULPIT.entries()) {
  add("reference-pulpit", `${at} ${screen}`, [{ say, screen, allow }]);
}

/** Said over several breaths, as it is in this app's own log. */
const SPREAD = [
  [["I want us to read from the book of Ephesians.", "Chapter 5.", "Verse 28."], "Ephesians 5:28"],
  [["Our anchor text will be taken from the book of Genesis chapter 2.", "Verse 18."], "Genesis 2:18"],
  [["Let's open our Bible to John chapter 3.", "Verse 16."], "John 3:16"],
  [["Psalm 23.", "Verse 4."], "Psalms 23:4"],
  [["Turn to the book of Habakkuk.", "Chapter 3, verse 17."], "Habakkuk 3:17"],
  [["Romans 8:28.", "Now look at verse 31."], "Romans 8:31"],
  [["The book of Isaiah.", "Chapter 40.", "Verse 31."], "Isaiah 40:31"],
  [["Matthew chapter 5.", "And we are reading from verse 14."], "Matthew 5:14"],
  [["First Corinthians.", "Chapter 13.", "Verse 13."], "1 Corinthians 13:13"],
  [["Hebrews chapter 11.", "Verse 1.", "Then verse 6."], "Hebrews 11:6"],
];
for (const [at, [turns, screen]] of SPREAD.entries()) {
  add(
    "reference-spread",
    `${at} ${screen}`,
    turns.map((say, index) => (index === turns.length - 1 ? { say, screen } : { say })),
    { allowAnywhere: screen.startsWith("Romans 8:31") ? ["Romans 8:28"] : screen === "Hebrews 11:6" ? ["Hebrews 11:1"] : [] },
  );
}

/** Words that look like a reference and are not one. */
const NOT_A_REFERENCE = [
  "Number one.",
  "Number 2,",
  "Number three. Verse 28 and 29.",
  "Signs that a couple may be becoming roommates. Number one, communication has become purely transactional.",
  "Friendships number two.",
  "Point number 3. Number 4. Number 5.",
  "Mark 2 people for me in the front row.",
  "I got a new job 2 weeks ago.",
  "The service starts at 9:30.",
  "The judges 3 of them gave us 16 points.",
  "Let us sing hymn 23, verse 1.",
  "We sing verse 2 of the hymn.",
  "Says 2 verse 1",
  "Sometimes 3:1",
  "2 Ephesians",
  "Chapter 2 of my life, verse by verse.",
  "The acts 2 of them were very good.",
  "John 3 times came to my house.",
];
for (const [at, say] of NOT_A_REFERENCE.entries()) {
  add("not-a-reference", `${at}`, [{ say, screen: null }]);
  add("not-a-reference-with-verse-up", `${at}`, [
    { say: "Romans 8:28.", screen: "Romans 8:28" },
    { say, screen: "Romans 8:28" },
  ]);
}

/** A verse most Bibles do not have, in one that does. */
add("reference", "3 John 1:15 in the RSV", [{ say: "Third John verse 15.", screen: "3 John 1:15" }], { version: "RSV" });

/** Named in passing, and then read aloud: it goes up when it is read. */
add("reference-then-read", "as Paul says", [
  { say: "As Paul says in Romans 8:28.", allow: ["Romans 8:28"] },
  { say: "And we know that all things work together for good to them that love God.", screen: "Romans 8:28" },
]);
add("reference-then-read", "a number that had to be divided", [
  { say: "In Amos 33, he said,", allow: ["Amos 3:3"] },
  { say: "can two walk together, except they be agreed?", screen: "Amos 3:3" },
]);
add("reference-then-read", "named in passing and only talked about", [
  { say: "Romans 8:28.", screen: "Romans 8:28" },
  { say: "As Paul says in John 3:16, God loves this world.", allow: ["John 3:16"] },
  { say: "So let us think about what that means for our families this morning.", allow: ["John 3:16"] },
]);
add("reference-then-read", "the verses said before their book", [
  { say: "From verse 25 all the way to verse 32. Ephesians chapter 5.", screen: "Ephesians 5:25-32" },
]);
add("reference-then-read", "the verses said before their book, with another passage up", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "From verse 25 all the way to verse 32. Ephesians chapter 5.", screen: "Ephesians 5:25-32" },
]);

/** A reference inside a sentence about it: showing it is not wrong, and not owed. */
const MENTIONS = [
  ["As Paul says in Romans 8:28, all things work together.", "Romans 8:28"],
  ["According to John 3:16, God loved the world.", "John 3:16"],
  ["Like in Psalm 23 verse 1, the Lord is our shepherd.", "Psalms 23:1"],
  ["In Amos 3:3, he said, can two walk together?", "Amos 3:3"],
  ["In Amos 33, he said, can two work together? No, except they agree.", "Amos 3:3"],
  ["From verse 25 all the way to verse 32. Ephesians chapter 5.", "Ephesians 5:25-32"],
];
for (const [at, [say, reference]] of MENTIONS.entries()) {
  add("reference-in-passing", `${at}`, [{ say, hope: reference }]);
}

// ---------------------------------------------------------------------------
// 4. Commands.
// ---------------------------------------------------------------------------

add("command", "next verse, once", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "Next verse.", screen: "John 3:17" },
]);
add("command", "next verse, then talking on", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "Next verse please, let us all read it together now, everybody.", screen: "John 3:17" },
]);
add("command", "next verse, twice", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "Next verse.", screen: "John 3:17" },
  { say: "Next verse.", screen: "John 3:18" },
]);
add("command", "previous verse", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "Previous verse.", screen: "John 3:15" },
]);
add("command", "go back a verse, then talking on", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "Go back one verse, I want us to see something there.", screen: "John 3:15" },
]);
add("command", "verse said within the passage up", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "Show verse 18.", screen: "John 3:18" },
]);
add("command", "nothing up, nothing to step from", [{ say: "Next verse.", screen: null }]);
add("command", "the last verse of a chapter is not a step back", [
  { say: "John 3:16.", screen: "John 3:16" },
  { say: "The last verse we read last week was about love.", screen: "John 3:16" },
]);

/**
 * A Bible asked for after a passage is up and read: by name alone, or
 * quoted from. The verse on screen goes into it. It was only ever "Genesis
 * 1:1 in the NKJV", the passage said again.
 */
const ASKED_FOR = [
  ["Read from the KJV.", "KJV"],
  ["Turn to NIV.", "NIV"],
  ["Back to King James.", "KJV"],
  ["I want the amplified.", "AMP"],
  ["Amplified.", "AMP"],
  ["What does the Amplified say?", "AMP"],
  ["The Amplified says,", "AMP"],
  ["Show me the Amplified.", "AMP"],
  ["Let's look at the New King James Version.", "NKJV"],
  ["NKJV.", "NKJV"],
];
for (const [at, [say, code]] of ASKED_FOR.entries()) {
  add("command-version", `${at} ${code}`, [
    { say: "Genesis 1:1.", screen: "Genesis 1:1" },
    { say: "In the beginning God created the heaven and the earth.", screen: "Genesis 1:1" },
    { say, screen: "Genesis 1:1", screenVersion: code },
    // Begun in another Bible than the one asked for.
  ], { installed: ["KJV", "NKJV", "NIV", "AMP"], version: code === "NKJV" ? "KJV" : "NKJV" });
}

/** A Bible's name in what is said, and not asked for: the Bible stays. */
const NOT_ASKED_FOR = [
  "I have good news for you.",
  "Good news.",
  "The message this morning is love.",
  "The message says love one another.",
  "The new international airport is very big.",
  "The amplifier is too loud.",
  "His voice was amplified.",
  "We have new international partners.",
];
for (const [at, say] of NOT_ASKED_FOR.entries()) {
  add("command-version", `not asked ${at}`, [
    { say: "Genesis 1:1.", screen: "Genesis 1:1" },
    { say, screen: "Genesis 1:1", screenVersion: "KJV" },
  ], { installed: ["KJV", "NKJV", "NIV", "AMP", "GNT", "MSG"] });
}

// ---------------------------------------------------------------------------
// 5. Scripture read aloud with no reference named.
// ---------------------------------------------------------------------------

const QUOTES = {
  KJV: [
    ["For God so loved the world, that he gave his only begotten Son.", "John 3:16"],
    ["The Lord is my shepherd; I shall not want.", "Psalms 23:1"],
    ["Be still, and know that I am God.", "Psalms 46:10"],
    ["Faith cometh by hearing, and hearing by the word of God.", "Romans 10:17"],
    ["I can do all things through Christ which strengtheneth me.", "Philippians 4:13"],
    ["Jesus wept.", "John 11:35"],
    ["In the beginning God created the heaven and the earth.", "Genesis 1:1"],
    ["Trust in the Lord with all thine heart; and lean not unto thine own understanding.", "Proverbs 3:5"],
    ["And we know that all things work together for good to them that love God.", "Romans 8:28"],
    ["Thy word is a lamp unto my feet, and a light unto my path.", "Psalms 119:105"],
    ["But seek ye first the kingdom of God, and his righteousness.", "Matthew 6:33"],
    ["The thief cometh not, but for to steal, and to kill, and to destroy.", "John 10:10"],
    ["No weapon that is formed against thee shall prosper.", "Isaiah 54:17"],
    ["Greater is he that is in you, than he that is in the world.", "1 John 4:4"],
    ["The Bible says the wages of sin is death, but the gift of God is eternal life.", "Romans 6:23"],
    ["Now faith is the substance of things hoped for, the evidence of things not seen.", "Hebrews 11:1"],
    ["They that wait upon the Lord shall renew their strength.", "Isaiah 40:31"],
    ["I am the way, the truth, and the life: no man cometh unto the Father, but by me.", "John 14:6"],
    ["If my people, which are called by my name, shall humble themselves, and pray.", "2 Chronicles 7:14"],
    ["Train up a child in the way he should go.", "Proverbs 22:6"],
  ],
  NKJV: [
    ["In the beginning, God created the heavens and the earth.", "Genesis 1:1"],
    ["The Lord is my shepherd, I shall not want.", "Psalms 23:1"],
    ["And the Lord God said, it is not good that man should be alone. I will make him a helper comparable to him.", "Genesis 2:18"],
    ["Husbands, love your wives, just as Christ also loved the church and gave Himself for her.", "Ephesians 5:25"],
    ["I can do all things through Christ who strengthens me.", "Philippians 4:13"],
    ["Two are better than one, because they have a good reward for their labor.", "Ecclesiastes 4:9"],
    ["Can two walk together, unless they are agreed?", "Amos 3:3"],
    ["So then faith comes by hearing, and hearing by the word of God.", "Romans 10:17"],
    ["Therefore a man shall leave his father and mother and be joined to his wife, and they shall become one flesh.", "Genesis 2:24"],
    ["But seek first the kingdom of God and His righteousness, and all these things shall be added to you.", "Matthew 6:33"],
  ],
  // The NIV installed is the 1984 text.
  NIV: [
    ["For I know the plans I have for you, declares the Lord.", "Jeremiah 29:11"],
    ["I can do everything through him who gives me strength.", "Philippians 4:13"],
    ["For God so loved the world that he gave his one and only Son.", "John 3:16"],
    ["Trust in the Lord with all your heart and lean not on your own understanding.", "Proverbs 3:5"],
    ["The Lord is my shepherd, I shall not be in want.", "Psalms 23:1"],
    ["Do not be anxious about anything, but in everything, by prayer and petition.", "Philippians 4:6"],
    ["And we know that in all things God works for the good of those who love him.", "Romans 8:28"],
    ["Your word is a lamp to my feet and a light for my path.", "Psalms 119:105"],
  ],
};
for (const [version, quotes] of Object.entries(QUOTES)) {
  for (const [at, [say, screen]] of quotes.entries()) {
    add("quote-well-known", `${version}-${at} ${screen}`, [{ say, screen }], { version });
  }
}

/** Heard badly, as this app's log has them: right, or nothing. */
const HEARD_BADLY = [
  ["For God Song of the Word that he gave his name.", "John 3:16"],
  ["Be still I know that I am God.", "Psalms 46:10"],
  ["Is my shepherd I shall not.", "Psalms 23:1"],
  ["And the head was without formal.", "Genesis 1:2"],
  ["The bubble tells us thou should not be anxious about anything.", "Philippians 4:6"],
  ["Hundreds all to law. Sorry. Husbands. Ought to love their own wives as their own bodies.", "Ephesians 5:28"],
];
for (const [at, [say, reference]] of HEARD_BADLY.entries()) {
  add("quote-heard-badly", `${at}`, [{ say, hope: reference }], { version: "NKJV" });
}

/** Words many verses share: no one verse is named by them. */
const SHARED_BY_MANY = [
  "For his mercy endureth for ever.",
  "And the Lord spake unto Moses, saying,",
  "Verily, verily, I say unto you,",
  "And it came to pass,",
  "Thus saith the Lord God;",
  "He that hath an ear, let him hear what the Spirit saith unto the churches.",
  "In the beginning.",
  "And God said,",
  "The word of the Lord came unto me, saying,",
  "Praise ye the Lord.",
  "Grace be unto you, and peace, from God our Father, and from the Lord Jesus Christ.",
  "And he said unto them,",
];
for (const [at, say] of SHARED_BY_MANY.entries()) {
  add("quote-shared-by-many", `${at}`, [{ say, screen: null }]);
}

const random = seeded(20261115);
const pick = (list) => list[Math.floor(random() * list.length)];

/** Verses whose words no other verse of that Bible has: there is a right answer. */
function distinctVerses(code, count) {
  const { verses } = bible(code);
  const seen = new Map();
  const key = (verse) => verse.text.toLowerCase().replace(/[^a-z ]/g, "");
  for (const verse of verses) seen.set(key(verse), (seen.get(key(verse)) ?? 0) + 1);
  const chosen = [];
  while (chosen.length < count) {
    const verse = pick(verses);
    const length = wordsOf(verse.text).length;
    if (length < 8 || length > 45 || seen.get(key(verse)) > 1 || chosen.includes(verse)) continue;
    chosen.push(verse);
  }
  return chosen;
}

for (const version of ["KJV", "NKJV", "NIV"]) {
  for (const verse of distinctVerses(version, 60)) {
    const reference = refOf(verse);
    const words = wordsOf(verse.text);
    add("quote-whole-verse", `${version} ${reference}`, [{ say: verse.text, screen: reference }], { version });
    add("quote-first-words", `${version} ${reference}`, [{ say: words.slice(0, 8).join(" "), hope: reference }], {
      version,
    });
    const from = Math.max(0, Math.floor((words.length - 8) / 2));
    add("quote-middle-words", `${version} ${reference}`, [{ say: words.slice(from, from + 8).join(" "), hope: reference }], {
      version,
    });
    add("quote-misheard", `${version} ${reference}`, [{ say: misheard(verse.text, random), hope: reference }], {
      version,
    });
  }
}

// ---------------------------------------------------------------------------
// 6. Reading a verse that is on screen: it stays until it is finished, then
//    the next one goes up — whatever other verses share its words.
// ---------------------------------------------------------------------------

/** Verses whose words are also somewhere else in the Bible. */
const SHARED_ELSEWHERE = [
  "Matthew 22:37", "Matthew 4:4", "Matthew 4:7", "Matthew 4:10", "Mark 12:30", "Luke 4:8", "Luke 10:27",
  "Romans 3:10", "Romans 3:12", "Psalms 53:1", "Psalms 14:1", "Isaiah 37:1", "2 Kings 19:1", "Hebrews 1:5",
  "Hebrews 8:10", "Acts 2:17", "1 Peter 1:24", "Matthew 6:9", "Luke 11:2", "Psalms 136:1", "Psalms 136:2",
  "Psalms 107:8", "Psalms 118:1", "Genesis 1:3", "Genesis 1:6", "Revelation 2:7", "Revelation 2:11",
  "Matthew 5:3", "Matthew 5:4", "Ecclesiastes 3:1", "Ecclesiastes 3:2", "John 3:15", "John 3:16",
  "1 Corinthians 13:4", "Psalms 23:1", "Psalms 91:1", "Isaiah 53:5", "Genesis 2:18", "Genesis 2:21",
  "Genesis 2:22", "Genesis 2:23", "Genesis 2:24", "Ephesians 5:25", "Ephesians 5:28", "Ephesians 5:31",
  "Mark 10:7", "Matthew 19:5", "Ecclesiastes 4:9", "Romans 10:13", "Romans 12:1", "Galatians 3:11",
  "Hebrews 10:38", "Romans 1:17", "Habakkuk 2:4", "1 Chronicles 16:34", "Psalms 106:1", "2 Samuel 22:2",
  "Psalms 18:2", "Matthew 3:17", "Matthew 17:5", "Mark 1:11", "Luke 3:22", "Matthew 24:35", "Mark 13:31",
  "Luke 21:33", "Exodus 20:12", "Deuteronomy 5:16", "Ephesians 6:2", "Proverbs 14:12", "Proverbs 16:25",
  "Psalms 42:5", "Psalms 42:11", "Isaiah 40:8", "Micah 4:3", "Isaiah 2:4", "Joel 2:28", "Acts 2:21",
  "Deuteronomy 6:5", "Deuteronomy 8:3", "Jeremiah 31:33", "Psalms 118:22", "Matthew 21:42", "1 Peter 2:7",
];

const lookUp = (code, reference) => {
  const [, bookName, chapter, verse] = reference.match(/^(.+) (\d+):(\d+)$/);
  return bible(code).verse(bookName, Number(chapter), Number(verse));
};

/**
 * A verse named, read through a phrase at a time, and the next verse read
 * after it. `spoken`: what is said for a verse (its own words, the same
 * verse in another Bible, or those words misheard).
 */
function readingCase(group, version, verse, { spoken, onward = "must", within = false }) {
  const reference = refOf(verse);
  const next = bible(version).verse(verse.bookName, verse.chapter, verse.verse + 1);
  const turns = [{ say: `${reference}.`, screen: reference }];
  for (const phrase of phrasesOf(spoken(verse))) {
    // Two Bibles do not always end a verse at the same word (Luke 3:27 in the
    // King James ends with what begins 3:28 in the NIV): read from another,
    // the verse on screen or the one after it is where the words are.
    //
    turns.push(
      within && next
        ? { say: phrase, allow: [reference, refOf(next)] }
        : { say: phrase, screen: reference },
    );
  }
  if (next && onward !== "no") {
    const nextReference = refOf(next);
    // Where two Bibles end a verse at different words, the end of this one
    // read from the other is the start of the verse after.
    const second = bible(version).verse(verse.bookName, verse.chapter, verse.verse + 2);
    const afterNext = within && second ? [refOf(second)] : [];
    // Read on to, the verse after it is moved on to at its last word
    // (`readToItsEnd`): as right, at the phrase that ends it, as it is.
    const atItsEnd = second ? { orNext: refOf(second) } : {};
    const endsIt = second ? [refOf(second)] : [];
    const phrases = phrasesOf(spoken(next));
    for (const [at, phrase] of phrases.entries()) {
      const last = at === phrases.length - 1;
      turns.push(
        last && onward === "must"
          ? { say: phrase, screen: nextReference, allow: [reference, ...afterNext, ...endsIt], ...atItsEnd }
          : last
            ? { say: phrase, allow: [reference, ...afterNext, ...endsIt], hope: nextReference, ...atItsEnd }
            : { say: phrase, allow: [reference, nextReference, ...afterNext] },
      );
    }
  }
  add(group, `${version} ${reference}`, turns, { version });
}

for (const version of ["KJV", "NKJV", "NIV"]) {
  for (const reference of SHARED_ELSEWHERE) {
    const verse = lookUp(version, reference);
    if (!verse) continue;
    readingCase("reading-shared-words", version, verse, { spoken: (read) => read.text });
  }
  for (const verse of distinctVerses(version, 50)) {
    readingCase("reading-any-verse", version, verse, { spoken: (read) => read.text });
    readingCase("reading-misheard", version, verse, {
      spoken: (read) => misheard(read.text, random),
      onward: "may",
    });
  }
}

/** Read from one Bible while the screen is in another. */
for (const [shown, read] of [["KJV", "NIV"], ["KJV", "NKJV"], ["NKJV", "NIV"], ["NIV", "KJV"]]) {
  const verses = [
    ...SHARED_ELSEWHERE.slice(0, 40).map((reference) => lookUp(shown, reference)).filter(Boolean),
    ...distinctVerses(shown, 25),
  ];
  for (const verse of verses) {
    const same = (which) => bible(read).verse(which.bookName, which.chapter, which.verse);
    if (!same(verse)) continue;
    readingCase(`reading-from-another-bible`, shown, verse, {
      spoken: (which) => same(which)?.text ?? which.text,
      // The chapter is read along in every Bible installed, so the verse the
      // reader is in is known whichever of them it is read from.
      onward: "must",
    });
    cases.at(-1).id += ` read from ${read}`;
  }
}

/**
 * Read from a Bible that is not installed at all, with one of the three that
 * are on screen: nothing to read along in but the words they share. The
 * verse on screen or the one after it; never a verse somewhere else.
 */
for (const read of ["ESV", "NLT", "GNT", "AMP", "MSG"]) {
  for (const shown of ["KJV", "NKJV", "NIV"]) {
    const verses = [
      ...SHARED_ELSEWHERE.filter((_, at) => at % 7 === ["KJV", "NKJV", "NIV"].indexOf(shown)).map((reference) => lookUp(shown, reference)).filter(Boolean),
      ...distinctVerses(shown, 6),
    ];
    for (const verse of verses) {
      const same = (which) => bible(read).verse(which.bookName, which.chapter, which.verse);
      if (!same(verse)) continue;
      readingCase("reading-from-a-bible-not-installed", shown, verse, {
        spoken: (which) => same(which)?.text ?? which.text,
        onward: "may",
        within: true,
      });
      cases.at(-1).id += ` read from ${read}`;
      cases.at(-1).installed = ["KJV", "NKJV", "NIV"];
    }
  }
}

// ---------------------------------------------------------------------------
// 6b. The same, in the other Bibles in `apps/desktop/bible/`: what is true of
//     the King James has to be true of the Message and the Good News too.
// ---------------------------------------------------------------------------

export const OTHER_BIBLES = ["ESV", "NLT", "GNT", "AMP", "MSG", "RSV", "NRSV", "AMPC", "ERV", "TPT"];
for (const version of OTHER_BIBLES) {
  for (const [at, lines] of sessions(real, 26).entries()) {
    add("other-bible-speech", `${version} real-${at}`, lines.map((say) => ({ say, screen: null })), { version });
  }
  for (const [at, lines] of sessions(WRITTEN_SPEECH, 25).entries()) {
    add("other-bible-speech", `${version} written-${at}`, lines.map((say) => ({ say, screen: null })), { version });
  }
  for (const verse of distinctVerses(version, 20)) {
    const reference = refOf(verse);
    add("other-bible-quote-whole-verse", `${version} ${reference}`, [{ say: verse.text, screen: reference }], { version });
    add(
      "other-bible-quote-first-words",
      `${version} ${reference}`,
      [{ say: wordsOf(verse.text).slice(0, 8).join(" "), hope: reference }],
      { version },
    );
  }
  for (const verse of distinctVerses(version, 12)) {
    readingCase("other-bible-reading", version, verse, { spoken: (read) => read.text });
  }
}

/** A verse read, then talked about: it stays up through the talk. */
for (const version of ["KJV", "NKJV"]) {
  for (const [at, reference] of ["Genesis 2:23", "John 3:16", "Psalms 23:1", "Ephesians 5:25", "Romans 8:28"].entries()) {
    const verse = lookUp(version, reference);
    add(
      "reading-then-talking",
      `${version}-${at} ${reference}`,
      [
        { say: `${reference}.`, screen: reference },
        ...phrasesOf(verse.text).map((say) => ({ say, screen: reference })),
        ...sessions(real, 13)[4 + at].map((say) => ({ say, screen: reference })),
      ],
      { version },
    );
  }
}

// ---------------------------------------------------------------------------
// 7. Told in the preacher's own words. The model names the passage; the
//    Bible's own words have to bear it out before it is shown.
// ---------------------------------------------------------------------------

const TOLD = [
  ["KJV", "Remember when God told Abraham to leave his father's house and go to a land he would show him.", "Genesis 12:1"],
  ["KJV", "David took five smooth stones from the brook and put them in his shepherd's bag.", "1 Samuel 17:40"],
  ["NIV", "When Peter asked Jesus how many times shall I forgive my brother, up to seven times?", "Matthew 18:21"],
  ["NIV", "The Bible tells us we should not be anxious about anything, but in everything by prayer.", "Philippians 4:6"],
  ["KJV", "A certain man was going down from Jerusalem to Jericho, and he fell among thieves.", "Luke 10:30"],
  ["KJV", "They threw Daniel into the den of lions, and the king said your God will deliver you.", "Daniel 6:16"],
  ["KJV", "The prodigal son arose and came to his father, and his father ran and fell on his neck and kissed him.", "Luke 15:20"],
  ["NKJV", "Jesus took the five loaves and the two fish, and looking up to heaven he blessed and broke them.", "Matthew 14:19"],

];
for (const [at, [version, say, screen]] of TOLD.entries()) {
  add("told-in-own-words", `${at} ${screen}`, [{ say, screen }], {
    version,
    model: () => ({ reference: screen, story: true, confidence: 1, intent: "SCRIPTURE_READING" }),
    needsModel: true,
  });
}

/**
 * As it was heard in a real service, "Peter" as "Bita": two words of the
 * verse are not enough to show it on the model's word, and it waits in the
 * box. Right if it goes up; not owed.
 */
add(
  "told-in-own-words",
  "heard badly",
  [{ say: "When Bita asks Jesus how many times we should forgive his brother.", hope: "Matthew 18:21" }],
  {
    version: "NKJV",
    model: () => ({ reference: "Matthew 18:21", story: true, confidence: 1, intent: "SCRIPTURE_READING" }),
    needsModel: true,
  },
);

/** A reference the parser cannot read and the model can. */
const SIDEWAYS = [
  ["The third chapter of John, the sixteenth verse.", "John 3:16"],
  ["Turn with me to the book of John chapter 3 and the 3rd verse.", "John 3:3"],
  ["Let us look at the eighth chapter of Romans, verse twenty eight.", "Romans 8:28"],
];
for (const [at, [say, screen]] of SIDEWAYS.entries()) {
  add("reference-sideways", `${at} ${screen}`, [{ say, screen }], {
    model: () => ({ reference: screen, confidence: 1, intent: "NAVIGATION_REQUEST" }),
    needsModel: true,
  });
}

/** The model sure of a passage nobody named: the screen does not take its word. */
const MODEL_WRONG = [
  ["One day a man.", "Luke 10:30"],
  ["One day a man came to my office and he said, pastor, I need your help.", "Luke 10:30"],
  ["So the woman went to the market and she bought fish and bread.", "John 6:9"],
  ["I remember the first time I came to this church.", "Psalms 122:1"],
  ["My people, let me tell you the truth this morning.", "John 8:32"],
  ["He went to the house of his friend and he knocked on the door.", "Luke 11:5"],
  ["Number one, you must be born again.", "John 3:3"],
  ["The Lord told me to tell somebody here today, your time has come.", "Esther 4:14"],
];
for (const [at, [say, wrong]] of MODEL_WRONG.entries()) {
  for (const story of [true, false]) {
    add("model-sure-and-wrong", `${at}${story ? " story" : ""}`, [{ say, screen: null }], {
      model: () => ({ reference: wrong, story, confidence: 1, intent: "SCRIPTURE_READING" }),
      needsModel: true,
    });
  }
}

// ---------------------------------------------------------------------------
// 9. A verse begun, a pause, and the rest of it: the first words suggest it
//    in the box (`box`), and it goes up when the rest is said — word for
//    word or not ("heavens", where the King James has "heaven").
// ---------------------------------------------------------------------------

const ACROSS_A_PAUSE = [
  ["KJV", ["In the beginning.", "God created the heavens and the earth."], "Genesis 1:1"],
  ["NKJV", ["In the beginning.", "God created the heavens and the earth."], "Genesis 1:1"],
  ["KJV", ["In the beginning", "was the Word, and the Word was with God."], "John 1:1"],
  ["NKJV", ["Be still and", "know that I am God."], "Psalms 46:10"],
  ["KJV", ["Trust in the Lord", "with all your heart and lean not on your own understanding."], "Proverbs 3:5"],
  ["NKJV", ["The Lord is my shepherd.", "I shall not want."], "Psalms 23:1"],
  ["NIV", ["For I know the plans", "I have for you, declares the Lord."], "Jeremiah 29:11"],
  [
    "KJV",
    ["There was a day when I went to the sitting room and I saw something.", "In the beginning God created the heavens and the earth."],
    "Genesis 1:1",
  ],
  [
    "NKJV",
    ["There was a day when I went to the sitting room and I saw something.", "In the beginning", "God created the heavens and the earth."],
    "Genesis 1:1",
  ],
];
for (const [at, [version, says, screen]] of ACROSS_A_PAUSE.entries()) {
  const turns = says.map((say) => ({ say }));
  turns[turns.length - 1].screen = screen;
  add("quote-across-a-pause", `${version}-${at} ${screen}`, turns, { version });
}

/** The first words of a verse, and no more: in the box, not on screen. */
const BEGUN = [
  ["KJV", "In the beginning.", "Genesis 1:1"],
  ["NKJV", "In the beginning.", "Genesis 1:1"],
  ["KJV", "For God so loved.", "John 3:16"],
  ["NKJV", "Be still and", "Psalms 46:10"],
  ["KJV", "Trust in the Lord.", "Proverbs 3:5"],
  ["NKJV", "I can do all things.", "Philippians 4:13"],
];
for (const [at, [version, say, box]] of BEGUN.entries()) {
  add("quote-begun-suggested", `${version}-${at} ${box}`, [{ say, screen: null, box }], { version });
}

/**
 * Verses with words no other verse has, said in two breaths: the first four
 * words, then the rest with an ending or two heard differently. Right if
 * they go up; not owed.
 */
const pauseRandom = seeded(20261123);
const pausePick = (list) => list[Math.floor(pauseRandom() * list.length)];
for (const version of ["KJV", "NKJV", "NIV"]) {
  const { verses } = bible(version);
  const chosen = new Set();
  while (chosen.size < 30) {
    const verse = pausePick(verses);
    const length = wordsOf(verse.text).length;
    if (length >= 10 && length <= 30) chosen.add(verse);
  }
  for (const verse of chosen) {
    const words = wordsOf(verse.text);
    const reference = refOf(verse);
    add(
      "quote-across-a-pause-generated",
      `${version} ${reference}`,
      // Four rare words are a quote already ("Tamar put ashes on"): up early is right.
      [
        { say: words.slice(0, 4).join(" "), allow: [reference] },
        { say: misheard(words.slice(4).join(" "), pauseRandom, 0.1), hope: reference },
      ],
      { version },
    );
  }
}

export { cases };
