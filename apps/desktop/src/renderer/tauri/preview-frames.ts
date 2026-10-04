/**
 * The audience picture, drawn by the compositor for the operator to look at.
 *
 * ADR-001 said one frame pipeline feeds every consumer. It fed two — the
 * audience surface and NDI — while the operator's own preview stayed a
 * `<video>` element in WebKit. That is why an MKV plays for the congregation
 * and is black here, and why a video on screen is decoded twice on one
 * machine.
 *
 * The frames arrive as JPEGs through `output-frame://`, drawn on a canvas by
 * `FrameCanvas`, which keeps them in time with the screens.
 */

/**
 * The URL for one frame of the audience screen `screen`, its video drawn
 * `leadMs` ahead; `after` is the frame already shown, which is not sent again
 * (`services/frame_delivery.rs`).
 */
export const previewFrameUrl = (
  width: number,
  height: number,
  leadMs: number,
  after: number | null,
  screen = "audience",
): string => {
  const side = (value: number) => Math.max(16, Math.min(1280, Math.round(value) || 16));
  const lead = Math.max(0, Math.min(250, Math.round(leadMs) || 0));
  const query = `w=${side(width)}&h=${side(height)}&lead=${lead}${after === null ? "" : `&after=${after}`}`;
  // Which audience screen: its colour, and its own column of the live look.
  const path = `frame/${encodeURIComponent(screen)}`;
  // WebView2 does not resolve custom schemes, so Windows gets the form Tauri
  // rewrites them to — the same rule as `media_protocol::url_for`.
  return isWindows()
    ? `http://output-frame.localhost/${path}?${query}`
    : `output-frame://${path}?${query}`;
};

const isWindows = (): boolean =>
  typeof navigator !== "undefined" && /Windows|Win32|Win64/.test(navigator.userAgent);
