/**
 * The audience picture, drawn by the compositor for the operator to look at.
 *
 * ADR-001 said one frame pipeline feeds every consumer. It fed two — the
 * audience surface and NDI — while the operator's own preview stayed a
 * `<video>` element in WebKit. That is why an MKV plays for the congregation
 * and is black here, and why a video on screen is decoded twice on one
 * machine.
 *
 * The frames arrive as JPEGs through `output-frame://`, the same shape the NDI
 * props already use (`state::ndi_input_state`) — an `<img>` the webview loads
 * itself, with no IPC and no JavaScript in the way.
 */

/**
 * The URL for one frame.
 *
 * `tick` is what makes it a new request — without it the webview would show
 * the first frame forever, which is exactly what its image cache is for.
 */
export const previewFrameUrl = (width: number, height: number, tick: number): string => {
  const side = (value: number) => Math.max(16, Math.min(1280, Math.round(value) || 16));
  const query = `w=${side(width)}&h=${side(height)}&t=${tick}`;
  // WebView2 does not resolve custom schemes, so Windows gets the form Tauri
  // rewrites them to — the same rule as `media_protocol::url_for`.
  return isWindows()
    ? `http://output-frame.localhost/frame/audience?${query}`
    : `output-frame://frame/audience?${query}`;
};

const isWindows = (): boolean =>
  typeof navigator !== "undefined" && /Windows|Win32|Win64/.test(navigator.userAgent);
