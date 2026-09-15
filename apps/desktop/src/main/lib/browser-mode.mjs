// @ts-check

/**
 * Browser mode's rules: what the address bar's input becomes, which page a
 * view restores, how the operator's viewport is measured, how the live preview
 * is cropped, and where search suggestions come from. Moved verbatim out of
 * `browser-view.service.ts` and `network.ipc.ts` so
 * `tests/browser-mode.test.mjs` can pin them before
 * `src-tauri/src/services/browser_mode` ports them.
 */

export const HOME_URL = "https://www.google.com";
export const SEARCH_ENGINE_BASE_URL = "https://www.google.com/search?q=";
/** How often the scroll position is mirrored and the preview re-captured. */
export const SCROLL_SYNC_INTERVAL_MS = 180;
export const PREVIEW_MAX_WIDTH = 360;

/**
 * @typedef {{
 *   url: string,
 *   title: string,
 *   canGoBack: boolean,
 *   canGoForward: boolean,
 *   isLoading: boolean,
 *   projectionTarget: "preview" | "main-output",
 *   scrollX: number,
 *   scrollY: number,
 *   previewDataUrl: string | null,
 * }} BrowserState
 */

/** @returns {BrowserState} */
export function initialBrowserState() {
  return {
    url: "about:blank",
    title: "",
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    projectionTarget: "preview",
    scrollX: 0,
    scrollY: 0,
    previewDataUrl: null,
  };
}

/** @param {string} value */
export function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** @param {string} value */
export function isLikelyUrl(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.includes(" ")) {
    return false;
  }
  return (
    normalized.includes(".") ||
    normalized.startsWith("localhost:") ||
    normalized.startsWith("127.0.0.1:") ||
    normalized.startsWith("http://") ||
    normalized.startsWith("https://")
  );
}

/**
 * What the address bar's input loads: a web address as typed, a likely address
 * with `https://` in front, otherwise a search.
 *
 * @param {string} input
 */
export function normalizeNavigationInput(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    return HOME_URL;
  }

  if (isValidHttpUrl(trimmed)) {
    return trimmed;
  }

  if (isLikelyUrl(trimmed)) {
    const withProtocol =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? trimmed
        : `https://${trimmed}`;
    if (isValidHttpUrl(withProtocol)) {
      return withProtocol;
    }
  }

  return `${SEARCH_ENGINE_BASE_URL}${encodeURIComponent(trimmed)}`;
}

/**
 * The page a view shows when it has none: the one it is on, else the last one
 * the operator was on, else the home page.
 *
 * @param {string | null | undefined} currentUrl
 * @param {string | null | undefined} rememberedUrl
 */
export function restoreUrl(currentUrl, rememberedUrl) {
  if (currentUrl && currentUrl !== "about:blank") {
    return currentUrl;
  }
  if (rememberedUrl && rememberedUrl !== "about:blank") {
    return rememberedUrl;
  }
  return HOME_URL;
}

/**
 * The operator's viewport, from `getBoundingClientRect`, in whole pixels.
 *
 * @param {{ x: number, y: number, width: number, height: number }} bounds
 */
export function clampBrowserBounds(bounds) {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
}

/**
 * The centred crop of a captured page that has the viewport's shape, and the
 * width the preview is scaled to. `crop` is null when the crop would be empty
 * and the whole capture is used.
 *
 * @param {{ width: number, height: number }} source
 * @param {{ width: number, height: number }} bounds
 */
export function previewCrop(source, bounds) {
  const expectedAspect =
    bounds.width > 0 && bounds.height > 0
      ? bounds.width / bounds.height
      : source.width / source.height;
  const sourceAspect = source.width / source.height;
  const shouldCropByWidth = sourceAspect > expectedAspect;
  const cropWidth = shouldCropByWidth
    ? Math.round(source.height * expectedAspect)
    : source.width;
  const cropHeight = shouldCropByWidth
    ? source.height
    : Math.round(source.width / expectedAspect);
  const cropX = Math.max(0, Math.round((source.width - cropWidth) / 2));
  const cropY = Math.max(0, Math.round((source.height - cropHeight) / 2));
  const crop =
    cropWidth > 0 && cropHeight > 0
      ? { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
      : null;
  const croppedWidth = crop ? crop.width : source.width;
  return { crop, previewWidth: Math.min(PREVIEW_MAX_WIDTH, croppedWidth) };
}

/**
 * Where the address bar's search suggestions are fetched from, or null for a
 * query that asks for none.
 *
 * @param {string} baseUrl
 * @param {unknown} query
 */
export function browserSuggestionsUrl(baseUrl, query) {
  if (typeof query !== "string" || query.trim().length === 0) {
    return null;
  }
  const url = new URL("/api/browser/suggestions", baseUrl).toString();
  return `${url}?q=${encodeURIComponent(query.trim())}`;
}
