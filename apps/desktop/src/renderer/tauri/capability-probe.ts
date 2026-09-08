/**
 * Reports what the Tauri webview can actually do.
 *
 * Electron always gave us Chromium. Tauri gives us WKWebView on macOS, WebView2
 * on Windows and WebKitGTK on Linux, so every web-platform feature the app
 * relies on has to be measured rather than assumed. The results land in the
 * Rust log via `report_webview_capabilities`.
 *
 * Temporary — delete once the subsystems it informs have migrated.
 */

import { invoke } from "@tauri-apps/api/core";

type LiveCaptureResult = {
  granted: boolean;
  errorName: string | null;
  errorMessage: string | null;
};

type WebviewCapabilities = {
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  hasEnumerateDevices: boolean;
  hasSetSinkId: boolean;
  hasAudioContext: boolean;
  hasAudioWorklet: boolean;
  hasWebSpeech: boolean;
  hasWebSocket: boolean;
  hasMediaRecorder: boolean;
  liveCapture: LiveCaptureResult | null;
  userAgent: string;
};

/**
 * Actually opens the microphone, which surfaces the OS permission prompt.
 * Only run when explicitly asked — never on plain startup.
 */
const attemptLiveCapture = async (): Promise<LiveCaptureResult> => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Release it immediately; this is a capability check, not a session.
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true, errorName: null, errorMessage: null };
  } catch (error) {
    const domError = error as { name?: string; message?: string };
    return {
      granted: false,
      errorName: domError?.name ?? null,
      errorMessage: domError?.message ?? String(error),
    };
  }
};

const collect = (liveCapture: LiveCaptureResult | null): WebviewCapabilities => {
  const mediaDevices =
    typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

  return {
    hasMediaDevices: Boolean(mediaDevices),
    hasGetUserMedia: typeof mediaDevices?.getUserMedia === "function",
    hasEnumerateDevices: typeof mediaDevices?.enumerateDevices === "function",
    hasSetSinkId:
      typeof HTMLMediaElement !== "undefined" &&
      "setSinkId" in HTMLMediaElement.prototype,
    hasAudioContext:
      typeof window !== "undefined" &&
      ("AudioContext" in window || "webkitAudioContext" in window),
    hasAudioWorklet: typeof AudioWorkletNode !== "undefined",
    hasWebSpeech:
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window),
    hasWebSocket: typeof WebSocket !== "undefined",
    hasMediaRecorder: typeof MediaRecorder !== "undefined",
    liveCapture,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
  };
};

/**
 * @param withLiveCapture when true, opens the microphone to distinguish "the
 *   API exists" from "the API works". Triggers a permission prompt.
 */
export const reportWebviewCapabilities = async (
  withLiveCapture = false,
): Promise<WebviewCapabilities> => {
  const liveCapture = withLiveCapture ? await attemptLiveCapture() : null;
  const capabilities = collect(liveCapture);

  try {
    await invoke("report_webview_capabilities", { capabilities });
  } catch (error) {
    // The console of a Tauri webview is not visible from a terminal, so route
    // the failure back through a command that cannot itself fail to
    // deserialise. Without this the probe fails silently.
    await invoke("report_diagnostic", {
      message:
        `report_webview_capabilities failed: ${String(error)} — ` +
        `payload was ${JSON.stringify(capabilities)}`,
    }).catch((): void => undefined);
    throw error;
  }

  return capabilities;
};
