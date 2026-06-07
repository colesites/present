import { ipcMain, webContents } from "electron";
import { getPresentAiTools } from "../ai/operator-tools";
import {
  getWhisperStatus,
  whisperService,
} from "../services/whisper.service";
import type { WhisperTranscriptEvent } from "../../shared/ai-operator/types";

export const registerAiOperatorIPC = (): void => {
  ipcMain.handle("ai-operator:list-tools", () => getPresentAiTools());

  // ── Whisper local STT ──
  ipcMain.handle("whisper:status", () => getWhisperStatus());

  ipcMain.handle(
    "whisper:start",
    (_event, payload: { sessionId: string; sampleRate?: number }) =>
      whisperService.startSession(payload.sessionId, payload.sampleRate),
  );

  // High-frequency audio frames use send() (one-way), not invoke().
  // The renderer transfers an ArrayBuffer of 16-bit PCM samples.
  ipcMain.on(
    "whisper:audio",
    (_event, payload: { sessionId: string; pcm: ArrayBuffer }) => {
      whisperService.pushAudio(payload.sessionId, new Int16Array(payload.pcm));
    },
  );

  ipcMain.on("whisper:stop", (_event, payload: { sessionId: string }) => {
    whisperService.stopSession(payload.sessionId);
  });

  // Dev / isolation helper: transcribe an existing WAV file.
  ipcMain.handle("whisper:transcribe-file", (_event, wavPath: string) =>
    whisperService.transcribeFile(wavPath),
  );

  // Fan transcripts out to all renderers; the operator hook filters by its
  // own sessionId.
  whisperService.on("transcript", (event: WhisperTranscriptEvent) => {
    for (const contents of webContents.getAllWebContents()) {
      if (!contents.isDestroyed()) {
        contents.send("whisper:transcript", event);
      }
    }
  });
};
