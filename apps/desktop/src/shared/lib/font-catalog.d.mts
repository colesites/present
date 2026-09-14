/**
 * Types for `font-catalog.mjs`.
 *
 * The implementation is JavaScript so `node --test` can characterise it before
 * the Rust port; this file keeps its TypeScript callers precisely typed.
 */

import type { CustomFontFace, FontFaceRecord, SystemFontFace } from "../types/font";

export declare const SUPPORTED_CUSTOM_FONT_EXTENSIONS: readonly [".ttf", ".otf", ".woff", ".woff2"];
export declare const FONT_LIST_EXCEPTIONS: string[];

export declare function normalizeFontWeightMeta(rawWeight?: string | null): {
  weight: string;
  weightLabel: string;
};
export declare function normalizeFontStyleMeta(rawStyle?: string | null): {
  style: string;
  styleLabel: string;
};
export declare function inferFontMetaFromFileName(fileName: string): {
  familyName: string;
  weight: string;
  weightLabel: string;
  style: string;
  styleLabel: string;
};
export declare function getFontFileMimeType(fileName: string): string;
export declare function getFontFaceSortKey(
  face: FontFaceRecord,
): readonly [string, number, string, string];
export declare function sortFontFaces<T extends FontFaceRecord>(faces: T[]): T[];
export declare function dedupeFontFaces<T extends FontFaceRecord>(faces: T[]): T[];

export declare function describeMacFontFamily(
  familyName: string,
  postScriptName: string,
): {
  familyName: string;
  postScriptName: string;
  weight: string;
  style: string;
  width: string;
  monospace: boolean;
};
export declare function standardizeFontListName(name: string): string;
export declare function orderFontList<T>(items: T[], nameOf: (item: T) => string): T[];
export interface FontListFace {
  familyName: string;
  postScriptName: string;
  weight?: string;
  style?: string;
  width?: string;
  monospace?: boolean;
}
type HelperEntry = {
  familyName?: unknown;
  postScriptName?: unknown;
  weight?: string;
  style?: string;
  width?: string;
  monospace?: boolean;
};
export declare function fontListFamilies(helperLines: string[]): string[];
export declare function finishSystemFontFamilies(fonts: string[]): string[];
export declare function systemFontFamilies(helperLines: string[]): string[];
export declare function fontListFaces(entries: HelperEntry[]): FontListFace[];
export declare function finishSystemFontFaces(faces: FontListFace[]): SystemFontFace[];
export declare function systemFontFaces(entries: HelperEntry[]): SystemFontFace[];
export declare function plainSystemFontFaces(families: string[]): SystemFontFace[];

export declare function splitFontFileName(fileName: string): { name: string; ext: string };
export declare function isSupportedFontFile(fileName: string): boolean;
export declare function uniqueFontFileName(
  originalFileName: string,
  exists: (fileName: string) => boolean,
): string;
export declare function customFontFace(
  fileName: string,
  filePath: string,
  base64: string,
): CustomFontFace;
