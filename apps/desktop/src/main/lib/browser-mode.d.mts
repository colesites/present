export declare const HOME_URL: "https://www.google.com";
export declare const SEARCH_ENGINE_BASE_URL: "https://www.google.com/search?q=";
export declare const SCROLL_SYNC_INTERVAL_MS: number;
export declare const PREVIEW_MAX_WIDTH: number;

export type BrowserState = {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  projectionTarget: "preview" | "main-output";
  scrollX: number;
  scrollY: number;
  previewDataUrl: string | null;
};

export declare function initialBrowserState(): BrowserState;
export declare function isValidHttpUrl(value: string): boolean;
export declare function isLikelyUrl(value: string): boolean;
export declare function normalizeNavigationInput(input: string): string;
export declare function restoreUrl(
  currentUrl: string | null | undefined,
  rememberedUrl: string | null | undefined,
): string;
export declare function clampBrowserBounds(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number };
export declare function previewCrop(
  source: { width: number; height: number },
  bounds: { width: number; height: number },
): {
  crop: { x: number; y: number; width: number; height: number } | null;
  previewWidth: number;
};
export declare function browserSuggestionsUrl(baseUrl: string, query: unknown): string | null;
