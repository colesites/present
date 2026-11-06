/**
 * The agents' speech, streamed to AssemblyAI by the Rust core
 * (`src-tauri/src/services/speech_stream.rs`).
 *
 * The microphone and the connection are both Rust's: the sound goes out the
 * moment it is captured, whatever the page is doing. The page used to forward
 * every chunk itself, and while it was busy drawing, the sound waited behind
 * it and the transcript fell behind the speaker. Now the page only reads what
 * the service says back.
 */

import { Channel, invoke } from "@tauri-apps/api/core";

type StreamEvent =
  | { kind: "message"; data: string }
  | { kind: "closed"; code: number; reason: string; clean: boolean };

export type SpeechStreamClose = { code: number; reason: string; wasClean: boolean };

export type SpeechStreamHandlers = {
  /** A message from the service, as it sent it (JSON). */
  onMessage: (data: string) => void;
  /** The stream is over: closed by either side, or lost. */
  onClose: (close: SpeechStreamClose) => void;
};

export type SpeechStream = {
  /** The microphone, as the system names it. */
  label: string;
  /**
   * Start hearing the service. Anything it said before this is kept and
   * given first, so nothing is missed between opening and listening.
   */
  listen: (handlers: SpeechStreamHandlers) => void;
  /** A control message for the service, such as `{"type":"Terminate"}`. */
  send: (text: string) => void;
  /** Stop the microphone and close; the last messages and the close still come. */
  close: () => void;
};

/**
 * Connect to `url` (AssemblyAI's, with its token; the sound's format is added
 * by Rust) and stream the microphone `deviceId`, or the default.
 */
export const openSpeechStream = async (
  url: string,
  deviceId: string | null,
): Promise<SpeechStream> => {
  const channel = new Channel<StreamEvent>();
  let handlers: SpeechStreamHandlers | null = null;
  const early: StreamEvent[] = [];
  const deliver = (event: StreamEvent) => {
    if (!handlers) {
      early.push(event);
    } else if (event.kind === "message") {
      handlers.onMessage(event.data);
    } else {
      handlers.onClose({ code: event.code, reason: event.reason, wasClean: event.clean });
    }
  };
  channel.onmessage = deliver;
  const started = await invoke<{ session: number; label: string }>("start_speech_stream", {
    url,
    deviceId,
    onEvent: channel,
  });
  let closed = false;
  return {
    label: started.label,
    listen: (given) => {
      handlers = given;
      for (const event of early.splice(0)) deliver(event);
    },
    send: (text) => {
      if (closed) return;
      void invoke("send_speech_stream", { session: started.session, text }).catch(
        (error: unknown) => console.error("[Speech] could not send to the stream", error),
      );
    },
    close: () => {
      if (closed) return;
      closed = true;
      void invoke("close_speech_stream", { session: started.session }).catch(
        (error: unknown) => console.error("[Speech] could not close the stream", error),
      );
    },
  };
};
