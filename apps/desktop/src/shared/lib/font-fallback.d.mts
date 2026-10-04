/** Types for `font-fallback.mjs`. */

export type Generic = "serif" | "sans-serif" | "monospace" | "cursive";

export declare const FONT_FALLBACKS: Record<string, { fonts: string[]; generic: Generic }>;
export declare const fontFallback: (family: string) => { fonts: string[]; generic: Generic };
export declare const fontStack: (family: string) => string;
