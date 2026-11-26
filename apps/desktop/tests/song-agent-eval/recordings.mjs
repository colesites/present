// The recordings the agent is replayed against, apart from the songs sung in
// them (`songs.mjs`) and when each slide began (`truth.mjs`, or for a
// synthetic recording, the `.truth.json` made with its sound).
//
// `file` is the sound, as `capture.mjs` streams it: 16 kHz mono 16-bit
// (`.pcm`), in the folder given to `capture-all.sh`.

const LIBRIVOX = "https://archive.org/download/hymn_collection_001_0909_librivox";

/**
 * Sung by people: LibriVox volunteers, one voice each. Public domain.
 *
 * @param {string} song
 * @param {string} file
 */
const sung = (song, file) => ({
  id: song,
  song,
  kind: "sung",
  file,
  source: `${LIBRIVOX}/hymns001_${file}_64kb.mp3`,
  licence: "public domain (LibriVox)",
});

/**
 * Sung by a synthetic voice over a synthetic band (`synth.mjs`), in an
 * order a band might take: `sing` a slide, `say` something as a worship
 * leader would, or `pause` for the band alone, in seconds.
 *
 * @param {string} id
 * @param {string} song
 * @param {Array<{ sing: number } | { say: string } | { pause: number }>} parts
 */
const synthetic = (id, song, parts) => ({
  id,
  song,
  kind: "synthetic",
  file: id,
  source: "made by synth.mjs",
  licence: "written for this test",
  parts,
});

export const RECORDINGS = [
  sung("amazing-grace", "amazinggrace_meg"),
  sung("it-is-well", "itiswellwithmysoul_jc"),
  sung("blessed-assurance", "blessedassurance_mfslaw"),
  sung("i-surrender-all", "isurrenderall_ezwa"),
  sung("softly-and-tenderly", "softlyandtenderly_bt"),
  sung("trust-and-obey", "trustandobey_tg"),
  sung("tis-so-sweet", "tissosweettotrustinjesus_jle"),
  sung("rock-of-ages", "rockofages_lw"),
  // The chorus is kept once: back to it after verse 2, and on to the bridge
  // after it; the bridge again after "one more time".
  synthetic("morning-light-band", "morning-light", [
    { say: "Good morning, everyone. Would you stand with me as we sing together." },
    { pause: 3 },
    { sing: 0 }, { sing: 1 }, { sing: 2 }, { sing: 3 },
    { pause: 2 },
    { sing: 4 }, { sing: 5 }, { sing: 2 }, { sing: 3 },
    { pause: 2 },
    { sing: 6 },
    { say: "One more time!" },
    { sing: 6 }, { sing: 2 }, { sing: 3 },
  ]),
  // Verse 2 skipped, the last chorus sung twice, then the tag.
  synthetic("harbor-song-band", "harbor-song", [
    { say: "Let's sing this one together." },
    { pause: 2 },
    { sing: 0 }, { sing: 1 }, { sing: 2 },
    { pause: 2 },
    { sing: 6 }, { sing: 7 }, { sing: 8 },
    { say: "Sing it again." },
    { sing: 8 }, { sing: 9 },
  ]),
  // Slides that begin alike, sung in order; the last sung twice.
  synthetic("every-breath-band", "every-breath", [
    { pause: 2 },
    { sing: 0 }, { sing: 1 }, { sing: 2 }, { sing: 3 }, { sing: 3 },
  ]),
];

/** @param {string} id */
export const recordingById = (id) => {
  const found = RECORDINGS.find((entry) => entry.id === id);
  if (!found) throw new Error(`no recording ${id}`);
  return found;
};
