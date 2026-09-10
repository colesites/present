/**
 * The URL a local media file is fetched through.
 *
 * Both shells serve local files over a `local-media://` scheme, but they do not
 * agree on the spelling. Electron registers the real scheme on every platform.
 * Tauri does too on macOS and Linux, and on Windows WebView2 refuses custom
 * schemes, so wry rewrites them to `http://<scheme>.localhost/`.
 *
 * Kept out of both `src/main/` and `src/renderer/tauri/` so the Electron bundle
 * pulls in no Tauri code and vice versa. The shell is detected from the global
 * Tauri injects before any app code runs.
 *
 * The Rust twin is `url_for` in `src-tauri/src/services/media_protocol.rs`; a
 * URL built on either side is served by that handler, so the two must agree.
 */

const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const isWindows = (): boolean =>
  typeof navigator !== "undefined" && navigator.userAgent.includes("Windows");

export const createLocalMediaUrl = (filePath: string): string => {
  if (filePath.startsWith("local-media://") || filePath.startsWith("http://local-media.")) {
    return filePath;
  }

  const absolute = filePath.startsWith("/") ? filePath : `/${filePath}`;

  if (!isTauriShell()) {
    // Electron, unchanged: `encodeURI` leaves `#` and `?` raw, which truncates
    // the URL for a file called `Set #2.mp4`. That is a live bug, and fixing it
    // here would change Electron's behaviour — which the migration rules keep
    // for the rewrite. The Tauri path below does fix it.
    return `local-media://media${encodeURI(absolute)}`;
  }

  const encoded = encodeURI(absolute).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return isWindows()
    ? `http://local-media.localhost/media${encoded}`
    : `local-media://media${encoded}`;
};
