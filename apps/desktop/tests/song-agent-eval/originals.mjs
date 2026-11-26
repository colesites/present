// Songs written for this test, free to use, each made to try one thing a
// band does that the agent must follow. They are sung by a synthetic voice
// (`synth.mjs`), so when each slide begins is known exactly.

import { slidesOf } from "./slides.mjs";

const song = (id, title, body) => ({ id, title, source: "written for this test", slides: slidesOf(body) });

export const ORIGINALS = [
  // The chorus kept once, two chorus slides that begin alike, and a bridge
  // sung twice.
  song("morning-light", "Morning Light", `
[Verse 1]
You wake the sparrows on the hill
And paint the river gold and still

Your mercy finds me where I stand
And holds tomorrow in its hand

[Chorus]
Morning light, steady and bright
You are the lantern in my night

Morning light, steady and bright
I will follow where you lead

[Verse 2]
When harvest fails and fields are bare
I find your footprints waiting there

You feed the hungry, lift the poor
You leave a candle by the door

[Bridge]
Open the windows, open the doors
Every corner of my heart is yours
`),
  // The chorus written out after every verse, a verse the band skips, a
  // chorus sung twice, and a tag that is the chorus's last words again.
  song("harbor-song", "Harbor Song", `
[Verse 1]
Across the water, through the storm
You pull the weary sailors home

The waves may rise above the mast
But every tempest has to pass

[Chorus]
Anchor of my soul, keep me in your harbor
Anchor of my soul, hold me till the morning

[Verse 2]
The lighthouse burns on rocky ground
The lost are seen, the drowning found

No sea too deep, no night too long
For you to turn my fear to song

[Chorus]
Anchor of my soul, keep me in your harbor
Anchor of my soul, hold me till the morning

[Verse 3]
And when the final tide is low
I'll walk the shore I've longed to know

With every sail and every oar
At rest forever on your shore

[Chorus]
Anchor of my soul, keep me in your harbor
Anchor of my soul, hold me till the morning

[Tag]
Hold me till the morning
`),
  // No labels, as lyrics pasted in plain often are, and every slide begins
  // with the same line: only the order tells them apart.
  {
    id: "every-breath",
    title: "Every Breath",
    source: "written for this test",
    slides: [
      { label: null, text: "Every breath belongs to you\nEvery dawn is born in you" },
      { label: null, text: "Every breath belongs to you\nEvery wound is healed by you" },
      { label: null, text: "Every breath belongs to you\nEvery road returns to you" },
      { label: null, text: "Glory, glory, all to you\nGlory, glory, all to you" },
    ],
  },
];
