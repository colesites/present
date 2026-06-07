// Local, offline speech-to-text using a bundled whisper.cpp `whisper-cli`
// binary. We never hit the network. Audio (16 kHz mono Int16 PCM) is streamed
// in from the renderer; a rolling window is periodically written to a temp WAV
// and transcribed by spawning whisper-cli. Simple energy VAD commits an
// utterance when the speaker pauses — that "commit on pause" is what makes the
// continuous stream feel real-time for short operator commands.
//
// Binary + model resolution:
//   packaged → Resources/whisper/<platform>/whisper-cli(.exe)
//              Resources/whisper/models/ggml-base.en.bin
//   dev      → env WHISPER_CLI_PATH / WHISPER_MODEL_PATH, else
//              apps/desktop/.whisper/{bin,models}/...

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import {
  WHISPER_CHANNELS,
  WHISPER_SAMPLE_RATE,
  type WhisperStatus,
  type WhisperTranscriptEvent,
} from "../../shared/ai-operator/types";

const TRANSCRIBE_INTERVAL_MS = 700; // how often we re-run whisper on the window
const WINDOW_SECONDS = 8; // max audio length fed to whisper per pass
const SILENCE_RMS = 0.012; // energy threshold below which we consider silence
const SILENCE_COMMIT_MS = 650; // pause length that finalizes an utterance

const binaryName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";

const firstExisting = (candidates: Array<string | undefined>): string | null => {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
};

const resolveBinaryPath = (): string | null =>
  firstExisting([
    process.env.WHISPER_CLI_PATH,
    app.isPackaged
      ? path.join(process.resourcesPath, "whisper", process.platform, binaryName)
      : undefined,
    path.join(app.getAppPath(), ".whisper/bin", binaryName),
    path.resolve(app.getAppPath(), "../../.whisper/bin", binaryName),
    path.resolve(process.cwd(), ".whisper/bin", binaryName),
    path.resolve(process.cwd(), "apps/desktop/.whisper/bin", binaryName),
  ]);

const resolveModelPath = (): string | null =>
  firstExisting([
    process.env.WHISPER_MODEL_PATH,
    app.isPackaged
      ? path.join(process.resourcesPath, "whisper", "models", "ggml-base.en.bin")
      : undefined,
    path.join(app.getAppPath(), ".whisper/models/ggml-base.en.bin"),
    path.resolve(app.getAppPath(), "../../.whisper/models/ggml-base.en.bin"),
    path.resolve(process.cwd(), ".whisper/models/ggml-base.en.bin"),
    path.resolve(process.cwd(), "apps/desktop/.whisper/models/ggml-base.en.bin"),
  ]);

export const getWhisperStatus = (): WhisperStatus => {
  const binaryPath = resolveBinaryPath();
  const modelPath = resolveModelPath();
  const binaryPresent = Boolean(binaryPath);
  const modelPresent = Boolean(modelPath);
  return {
    available: binaryPresent && modelPresent,
    binaryPresent,
    modelPresent,
    binaryPath,
    modelPath,
    error:
      binaryPresent && modelPresent
        ? null
        : `Whisper unavailable — ${[
            binaryPresent ? null : "binary missing",
            modelPresent ? null : "model missing",
          ]
            .filter(Boolean)
            .join(", ")}.`,
  };
};

// ── WAV encoding (16-bit PCM mono) ──
const encodeWav = (pcm: Int16Array, sampleRate: number): Buffer => {
  const dataBytes = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(WHISPER_CHANNELS, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * WHISPER_CHANNELS * 2, 28);
  buffer.writeUInt16LE(WHISPER_CHANNELS * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i += 1) {
    buffer.writeInt16LE(pcm[i], 44 + i * 2);
  }
  return buffer;
};

const cleanTranscript = (raw: string): string =>
  raw
    .replace(/\[[^\]]*\]/g, " ") // [BLANK_AUDIO], [Music], etc.
    .replace(/\([^)]*\)/g, " ") // (silence)
    .replace(/\s+/g, " ")
    .trim();

interface WhisperSession {
  id: string;
  sampleRate: number;
  window: Int16Array[]; // recent frames (newest last)
  windowSamples: number;
  transcribing: boolean;
  lastVoiceAt: number;
  hadVoiceSinceCommit: boolean;
  lastEmitted: string;
  interval: NodeJS.Timeout | null;
}

class WhisperService extends EventEmitter {
  private sessions = new Map<string, WhisperSession>();

  startSession(id: string, sampleRate = WHISPER_SAMPLE_RATE): WhisperStatus {
    const status = getWhisperStatus();
    if (!status.available) {
      return status;
    }
    this.stopSession(id);
    const session: WhisperSession = {
      id,
      sampleRate,
      window: [],
      windowSamples: 0,
      transcribing: false,
      lastVoiceAt: 0,
      hadVoiceSinceCommit: false,
      lastEmitted: "",
      interval: null,
    };
    session.interval = setInterval(() => {
      void this.tick(session, status.binaryPath!, status.modelPath!);
    }, TRANSCRIBE_INTERVAL_MS);
    this.sessions.set(id, session);
    return status;
  }

  pushAudio(id: string, pcm: Int16Array): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Energy VAD on the incoming frame.
    let sumSquares = 0;
    for (let i = 0; i < pcm.length; i += 1) {
      const v = pcm[i] / 32768;
      sumSquares += v * v;
    }
    const rms = pcm.length > 0 ? Math.sqrt(sumSquares / pcm.length) : 0;
    if (rms >= SILENCE_RMS) {
      session.lastVoiceAt = Date.now();
      session.hadVoiceSinceCommit = true;
    }

    session.window.push(pcm);
    session.windowSamples += pcm.length;

    // Trim the rolling window to WINDOW_SECONDS.
    const maxSamples = WINDOW_SECONDS * session.sampleRate;
    while (session.windowSamples > maxSamples && session.window.length > 1) {
      const dropped = session.window.shift();
      if (dropped) session.windowSamples -= dropped.length;
    }
  }

  stopSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.interval) clearInterval(session.interval);
    this.sessions.delete(id);
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.stopSession(id);
  }

  private flattenWindow(session: WhisperSession): Int16Array {
    const merged = new Int16Array(session.windowSamples);
    let offset = 0;
    for (const frame of session.window) {
      merged.set(frame, offset);
      offset += frame.length;
    }
    return merged;
  }

  private async tick(
    session: WhisperSession,
    binaryPath: string,
    modelPath: string,
  ): Promise<void> {
    if (session.transcribing || session.windowSamples === 0) return;
    if (!session.hadVoiceSinceCommit) return;

    const silent = Date.now() - session.lastVoiceAt > SILENCE_COMMIT_MS;
    session.transcribing = true;
    const pcm = this.flattenWindow(session);

    try {
      const text = cleanTranscript(
        await this.runWhisper(binaryPath, modelPath, pcm, session.sampleRate),
      );
      if (text && text !== session.lastEmitted) {
        session.lastEmitted = text;
        this.emitTranscript(session.id, text, false);
      }

      if (silent) {
        // Commit the utterance: emit final, then reset the window so the next
        // phrase starts clean.
        if (text) this.emitTranscript(session.id, text, true);
        session.window = [];
        session.windowSamples = 0;
        session.hadVoiceSinceCommit = false;
        session.lastEmitted = "";
      }
    } catch (error) {
      this.emit("error", error);
    } finally {
      session.transcribing = false;
    }
  }

  private emitTranscript(
    sessionId: string,
    transcript: string,
    isFinal: boolean,
  ): void {
    const event: WhisperTranscriptEvent = { sessionId, transcript, isFinal };
    this.emit("transcript", event);
  }

  /** Spawn whisper-cli on a PCM buffer and return the plain transcript. */
  runWhisper(
    binaryPath: string,
    modelPath: string,
    pcm: Int16Array,
    sampleRate: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "present-whisper-"));
      const wavPath = path.join(dir, "audio.wav");
      try {
        writeFileSync(wavPath, encodeWav(pcm, sampleRate));
      } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        reject(error);
        return;
      }

      // ggml auto-discovers its compute backends (libggml-cpu/blas) in the
      // binary's own directory — the staged bundle ships them alongside
      // whisper-cli, so no env override is needed (and GGML_BACKEND_PATH
      // expects a file, not a dir).
      const child = spawn(binaryPath, [
        "-m", modelPath,
        "-f", wavPath,
        "-l", "en",
        "-nt", // no timestamps
        "-np", // no progress prints
        "-t", "4", // threads
        "-bs", "1", // greedy beam for speed
      ]);

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      child.on("error", (error) => {
        rmSync(dir, { recursive: true, force: true });
        reject(error);
      });
      child.on("close", (code) => {
        rmSync(dir, { recursive: true, force: true });
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `whisper-cli exited with code ${code}`));
        }
      });
    });
  }

  /** Dev helper: transcribe an existing WAV file (for isolation testing). */
  async transcribeFile(wavPath: string): Promise<string> {
    const status = getWhisperStatus();
    if (!status.available || !status.binaryPath || !status.modelPath) {
      throw new Error(status.error ?? "Whisper unavailable");
    }
    return new Promise((resolve, reject) => {
      const child = spawn(status.binaryPath!, [
        "-m", status.modelPath!,
        "-f", wavPath,
        "-l", "en",
        "-nt",
        "-np",
      ]);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => (stdout += c.toString()));
      child.stderr.on("data", (c) => (stderr += c.toString()));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(cleanTranscript(stdout))
          : reject(new Error(stderr || `exit ${code}`)),
      );
    });
  }
}

export const whisperService = new WhisperService();
