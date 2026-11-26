"use client";

import { useEffect, useRef } from "react";
import { readTurn, type AssemblyAiTurn } from "../scripture/lib/assemblyai-turn";
import type { SpeechStream } from "../../renderer/tauri/speech-stream";

/**
 * A second hearing of the singing, through the band.
 *
 * The song agent's own stream (`useSpeechRecognition`, Universal-Streaming)
 * sends each word about 0.3 s after it is sung, but over drums and a backing
 * track it misses or mishears many of them. AssemblyAI's Universal-3.6 Pro
 * with Voice Focus, which isolates the voice nearest the microphone, heard
 * nearly every sung word of the same recordings (42 of the song's words,
 * where the fast stream heard 29, and 2 wrong words where it heard 7), but
 * sends them 1.5 to 6 s late. So both run: the fast one moves the slide the
 * moment a word is sung, and this one, late but right, catches up when the
 * band covered the words (`createCatchUp`) and finds songs through it.
 *
 * It runs only while the agent's own stream listens, under that stream's
 * session for the plan's speech time; the token is minted here, by the app.
 * If it can't connect or drops, the agent carries on with its own stream.
 */
export function useHearingThrough(options: {
  /** Listen: the agent's own stream is listening. */
  active: boolean;
  inputDeviceId: string | null;
  keyterms: string[];
  onTurn: (turn: { transcript: string; isFinal: boolean; turn: number | null }) => void;
}) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const streamRef = useRef<SpeechStream | null>(null);
  const sentKeyterms = useRef("[]");

  const { active, inputDeviceId } = options;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = async () => {
      try {
        const [{ mintSpeechToken }, { openSpeechStream, noteSongAgent }] = await Promise.all([
          import("../../renderer/tauri/runtime"),
          import("../../renderer/tauri/speech-stream"),
        ]);
        const { token } = await mintSpeechToken(SESSION_SECONDS);
        if (stopped) return;
        const terms = latest.current.keyterms.slice(0, 100);
        const url = new URL(STREAM_URL);
        url.searchParams.set("token", token);
        url.searchParams.set("speech_model", "universal-3-6-pro");
        // The singer is the voice nearest the microphone; the band is the
        // rest. Near-field heard the most sung words of the four ways tried.
        url.searchParams.set("voice_focus", "near-field");
        url.searchParams.set("mode", "min_latency");
        url.searchParams.set("interruption_delay", "0");
        url.searchParams.set("max_turn_silence", "2000");
        if (terms.length > 0) url.searchParams.set("keyterms_prompt", JSON.stringify(terms));
        const stream = await openSpeechStream(url.toString(), latest.current.inputDeviceId?.trim() || null);
        if (stopped) {
          stream.close();
          return;
        }
        streamRef.current = stream;
        sentKeyterms.current = JSON.stringify(terms);
        noteSongAgent("through", "listening through the band");
        stream.listen({
          onMessage: (data) => {
            let message: AssemblyAiTurn & { type?: string; turn_order?: number; error?: string };
            try {
              message = JSON.parse(data);
            } catch {
              return;
            }
            if (message.type === "Error" || message.error) {
              noteSongAgent("through", `the service said: ${message.error ?? "error"}`);
              return;
            }
            if (message.type !== "Turn") return;
            const heard = readTurn(message, false);
            if (!heard.text) return;
            retries = 0;
            latest.current.onTurn({
              transcript: heard.text,
              isFinal: heard.isFinal,
              turn: typeof message.turn_order === "number" ? message.turn_order : null,
            });
          },
          onClose: () => {
            if (streamRef.current === stream) streamRef.current = null;
            if (stopped || retries >= MOST_RETRIES) return;
            retries += 1;
            retryTimer = setTimeout(() => void open(), 1000 * retries);
          },
        });
      } catch (error) {
        // The agent's own stream carries on; this one is a help, not a need.
        void import("../../renderer/tauri/speech-stream").then(({ noteSongAgent }) =>
          noteSongAgent("through", `could not listen through the band: ${String(error)}`),
        );
        if (!stopped && retries < MOST_RETRIES) {
          retries += 1;
          retryTimer = setTimeout(() => void open(), 2000 * retries);
        }
      }
    };
    void open();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      streamRef.current?.send(JSON.stringify({ type: "Terminate" }));
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [active, inputDeviceId]);

  // New words to listen for, told mid-stream, as the agent's own stream is.
  const keytermsJson = JSON.stringify(options.keyterms.slice(0, 100));
  useEffect(() => {
    const stream = streamRef.current;
    if (!stream || sentKeyterms.current === keytermsJson) return;
    sentKeyterms.current = keytermsJson;
    stream.send(JSON.stringify({ type: "UpdateConfiguration", keyterms_prompt: JSON.parse(keytermsJson) }));
  }, [keytermsJson]);
}

const STREAM_URL = "wss://streaming.assemblyai.com/v3/ws";
/** The longest a session may run before the service ends it; it is opened again. */
const SESSION_SECONDS = 3 * 60 * 60;
/** How many times in a row it tries again after failing to connect. */
const MOST_RETRIES = 3;
