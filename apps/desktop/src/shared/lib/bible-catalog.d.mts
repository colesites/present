/**
 * Types for `bible-catalog.mjs`.
 *
 * The implementation is JavaScript so `node --test` can characterise it before
 * the Rust port; this file keeps its TypeScript callers precisely typed.
 */

export declare const KNOWN_BIBLE_CODES: string[];
export declare const SUPPORTED_BIBLE_EXTENSIONS: Set<string>;
export declare function inferBibleCodeFromName(fileNameBase: string): string;
export declare function formatBibleName(fileNameBase: string): string;
export declare function bundledBibleId(code: string, sizeBytes: number, mtimeMs: number): string;
export declare function orderBundledBibles<T extends { name: string }>(bibles: T[]): T[];
