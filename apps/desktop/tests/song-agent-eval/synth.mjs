// The synthetic recordings in `recordings.mjs`: each line sung by a macOS
// voice that sings ("Good News", to a tune of its own), what a worship
// leader says in a speaking voice, all over a synthetic band (chords that
// change every bar, a soft kick on the beat, a little noise), about 12 dB
// under the voice. Not a person singing, but held, pitched words with
// music under them, and when each slide begins is known to the millisecond.
//
//   node tests/song-agent-eval/synth.mjs --out <audio dir> [--only morning-light-band]
//
// Writes `<id>.pcm` (16 kHz mono 16-bit) and `<id>.truth.json`
// ([slide, ms] in the order sung) for each, which `capture.mjs` keeps with
// what the service heard.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { RECORDINGS } from "./recordings.mjs";
import { songById } from "./songs.mjs";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    only: { type: "string" },
    voice: { type: "string", default: "Good News" },
    talk: { type: "string", default: "Samantha" },
  },
});
if (!values.out) throw new Error("--out <audio dir> is needed");

const RATE = 16_000;
const work = mkdtempSync(join(tmpdir(), "song-synth-"));

/** `text` in `voice`, as 16 kHz samples from -1 to 1. */
function render(text, voice) {
  const aiff = join(work, "line.aiff");
  const raw = join(work, "line.pcm");
  execFileSync("say", ["-v", voice, "-o", aiff, text]);
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", String(RATE), "-f", "s16le", raw]);
  const bytes = readFileSync(raw);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i += 1) samples[i] = bytes.readInt16LE(i * 2) / 32768;
  return samples;
}

const silence = (seconds) => new Float32Array(Math.round(seconds * RATE));

/** A band under `length` samples: I-V-vi-IV, a bar each, at 72 beats a minute. */
function band(length) {
  const out = new Float32Array(length);
  const chords = [
    [130.81, 164.81, 196.0],
    [98.0, 123.47, 146.83],
    [110.0, 130.81, 164.81],
    [87.31, 110.0, 130.81],
  ];
  const beat = 60 / 72;
  let seed = 7;
  let pink = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / RATE;
    const chord = chords[Math.floor(t / (beat * 4)) % chords.length];
    let pad = 0;
    for (const f of chord) pad += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t);
    pad *= 0.12 * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.5 * t));
    const sinceBeat = t % beat;
    const kick = Math.sin(2 * Math.PI * 55 * sinceBeat) * Math.exp(-sinceBeat * 18) * 0.5;
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    pink = 0.97 * pink + 0.03 * (seed / 1_073_741_824 - 1);
    out[i] = pad + kick + pink * 0.6;
  }
  return out;
}

const rms = (samples) => {
  let sum = 0;
  let count = 0;
  for (const sample of samples) {
    if (Math.abs(sample) < 0.01) continue;
    sum += sample * sample;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
};

for (const recording of RECORDINGS) {
  if (recording.kind !== "synthetic" || (values.only && recording.id !== values.only)) continue;
  const song = songById(recording.song);
  /** @type {Float32Array[]} */
  const pieces = [];
  let at = 0;
  const truth = [];
  const add = (samples) => {
    pieces.push(samples);
    at += samples.length;
  };
  for (const part of recording.parts) {
    if ("pause" in part) {
      add(silence(part.pause));
    } else if ("say" in part) {
      add(render(part.say, values.talk));
      add(silence(0.5));
    } else {
      truth.push([part.sing, Math.round((at / RATE) * 1000)]);
      for (const line of song.slides[part.sing].text.split("\n")) {
        add(render(line, values.voice));
        add(silence(0.35));
      }
    }
  }
  add(silence(2));
  const voice = new Float32Array(at);
  let offset = 0;
  for (const piece of pieces) {
    voice.set(piece, offset);
    offset += piece.length;
  }
  const bed = band(at);
  const level = (rms(voice) / rms(bed)) * 0.25;
  const pcm = Buffer.alloc(at * 2);
  for (let i = 0; i < at; i += 1) {
    const mixed = Math.max(-1, Math.min(1, voice[i] + bed[i] * level));
    pcm.writeInt16LE(Math.round(mixed * 32767), i * 2);
  }
  writeFileSync(join(values.out, `${recording.file}.pcm`), pcm);
  writeFileSync(join(values.out, `${recording.file}.truth.json`), `${JSON.stringify(truth)}\n`);
  console.log(`${recording.id}: ${(at / RATE).toFixed(1)} s, ${truth.length} slides sung`);
}
rmSync(work, { recursive: true, force: true });
