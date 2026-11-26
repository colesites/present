// What the speech service hears in a recording of singing, saved so the song
// agent can be replayed against it without the service.
//
// The recording is streamed at true speed, 100 ms at a time, as Rust streams
// the microphone (`src-tauri/src/services/speech_stream.rs`), with the
// connection settings the song agent uses (`useSpeechRecognition.ts`). Every
// message the service sends back is kept with when it came, in ms from the
// start of the sound.
//
//   ffmpeg -i hymn.mp3 -ac 1 -ar 16000 -f s16le hymn.pcm
//   ASSEMBLYAI_API_KEY=… node tests/song-agent-eval/capture.mjs \
//     --audio hymn.pcm --out heard.json [--song amazing-grace] [--model universal-streaming-english]
//     [--vad 0.2] [--keyterms words|lines|title|none] [--turn-silence 500] [--sure-silence 160]
//
// `--keyterms words` is what the song agent gives the service: the song's
// less common words. `title` is what it gave before (the service's song
// titles); `lines`, the song's lines, was tried and heard less.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { songById } from "./songs.mjs";

const { values } = parseArgs({
  options: {
    audio: { type: "string" },
    out: { type: "string" },
    song: { type: "string" },
    model: { type: "string", default: "universal-streaming-english" },
    vad: { type: "string" },
    "turn-silence": { type: "string", default: "500" },
    "sure-silence": { type: "string", default: "160" },
    keyterms: { type: "string", default: "words" },
  },
});
if (!values.audio || !values.out) throw new Error("--audio and --out are needed");
const key = process.env.ASSEMBLYAI_API_KEY;
if (!key) throw new Error("ASSEMBLYAI_API_KEY is not set");

const sound = readFileSync(values.audio);
const truthFile = values.audio.replace(/\.pcm$/, ".truth.json");
const seconds = sound.length / 32_000;
const tokenResponse = await fetch(
  `https://streaming.assemblyai.com/v3/token?expires_in_seconds=600&max_session_duration_seconds=${Math.ceil(seconds) + 120}`,
  { headers: { Authorization: key } },
);
if (!tokenResponse.ok) throw new Error(`token: ${tokenResponse.status} ${await tokenResponse.text()}`);
const { token } = await tokenResponse.json();

const song = values.song ? songById(values.song) : null;
// "lines": the song's lines, as tried before its words (`songKeyterms`).
const lines = (entry) => [...new Set(entry.slides.flatMap((slide) => slide.text.split("\n")))]
  .map((line) => line.replace(/[^\p{L}\p{N}’'\s-]/gu, " ").replace(/\s+/g, " ").trim())
  .filter((line) => line && line.length <= 50)
  .slice(0, 100);
const keyterms = !song || values.keyterms === "none"
  ? []
  : values.keyterms === "title"
    ? [song.title]
    : values.keyterms === "lines"
      ? lines(song)
      : (await import("../../src/features/song-agent/song-match.mjs")).songKeyterms([song]);
const url = new URL("wss://streaming.assemblyai.com/v3/ws");
url.searchParams.set("token", token);
url.searchParams.set("sample_rate", "16000");
url.searchParams.set("encoding", "pcm_s16le");
url.searchParams.set("format_turns", "true");
url.searchParams.set("max_turn_silence", values["turn-silence"]);
url.searchParams.set("min_end_of_turn_silence_when_confident", values["sure-silence"]);
url.searchParams.set("speech_model", values.model);
if (values.vad) url.searchParams.set("vad_threshold", values.vad);
if (keyterms.length > 0) url.searchParams.set("keyterms_prompt", JSON.stringify(keyterms));

const messages = [];
let startedAt = 0;
let isClosed = false;
const socket = new WebSocket(url);
socket.binaryType = "arraybuffer";
const closed = new Promise((resolve) => {
  socket.addEventListener("close", (event) => {
    isClosed = true;
    resolve(event);
  });
});
socket.addEventListener("message", (event) => {
  const at = startedAt ? Date.now() - startedAt : 0;
  const message = JSON.parse(String(event.data));
  messages.push({ at, message });
  if (message.type === "Error" || message.error) console.error("service:", message);
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

// 100 ms at a time, on the clock: chunk n goes when n × 100 ms have passed.
const CHUNK = 3200;
startedAt = Date.now();
for (let offset = 0, n = 0; offset < sound.length && !isClosed; offset += CHUNK, n += 1) {
  const wait = startedAt + n * 100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  socket.send(sound.subarray(offset, offset + CHUNK));
}
if (!isClosed) socket.send(JSON.stringify({ type: "Terminate" }));
const close = await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 15_000))]);

writeFileSync(
  values.out,
  `${JSON.stringify(
    {
      audio: values.audio.split("/").pop(),
      song: values.song ?? null,
      seconds,
      settings: {
        model: values.model,
        vad: values.vad ?? null,
        turnSilence: Number(values["turn-silence"]),
        sureSilence: Number(values["sure-silence"]),
        keyterms,
      },
      close: close ? { code: close.code, reason: close.reason } : null,
      // A synthetic recording's own timing (`synth.mjs`), kept with it.
      truth: existsSync(truthFile) ? JSON.parse(readFileSync(truthFile, "utf8")) : null,
      messages,
    },
    null,
    0,
  )}\n`,
);
const turns = messages.filter((entry) => entry.message.type === "Turn" && entry.message.end_of_turn && entry.message.turn_is_formatted);
console.log(`${values.out}: ${messages.length} messages, ${turns.length} turns`);
