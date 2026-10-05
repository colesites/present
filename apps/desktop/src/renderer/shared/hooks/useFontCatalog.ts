"use client";

import { userMessage } from "../lib/user-error";
import { useEffect, useMemo, useState } from "react";
import type {
  CustomFontFace,
  FontFaceRecord,
  SystemFontFace,
} from "../../../shared/types/font";
import {
  buildFontFaceCssRule,
  buildFontWeightOptions,
  dedupeFontFaces,
} from "../../../shared/lib/font";

type FontCatalogState = {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  families: string[];
  faces: FontFaceRecord[];
  customFaces: CustomFontFace[];
};

const FALLBACK_SYSTEM_FONTS = [
  "Arial",
  "Calibri",
  "Georgia",
  "Helvetica Neue",
  "Inter",
  "Times New Roman",
  "Verdana",
];

const CUSTOM_FONT_STYLE_ELEMENT_ID = "present-custom-font-faces";

const INITIAL_FONT_CATALOG_STATE: FontCatalogState = {
  loading: false,
  loaded: false,
  error: null,
  families: FALLBACK_SYSTEM_FONTS,
  faces: FALLBACK_SYSTEM_FONTS.map<SystemFontFace>((familyName) => ({
    familyName,
    postScriptName: familyName,
    weight: "400",
    weightLabel: "Regular",
    style: "normal",
    styleLabel: "Normal",
    width: "",
    monospace: false,
    source: "system",
  })),
  customFaces: [],
};

let fontCatalogState = INITIAL_FONT_CATALOG_STATE;
let fontCatalogPromise: Promise<FontCatalogState> | null = null;
const fontCatalogListeners = new Set<(state: FontCatalogState) => void>();

function emitFontCatalogState(nextState: FontCatalogState) {
  fontCatalogState = nextState;
  for (const listener of fontCatalogListeners) {
    listener(nextState);
  }
}

function buildFamilies(faces: FontFaceRecord[]) {
  return Array.from(
    new Set(faces.map((face) => face.familyName.trim()).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right));
}

function buildFallbackFaces(families: string[]) {
  return families.map<SystemFontFace>((familyName) => ({
    familyName,
    postScriptName: familyName,
    weight: "400",
    weightLabel: "Regular",
    style: "normal",
    styleLabel: "Normal",
    width: "",
    monospace: false,
    source: "system",
  }));
}

function injectCustomFontsIntoDocument(
  targetDocument: Document,
  customFaces: CustomFontFace[],
) {
  let styleElement = targetDocument.getElementById(
    CUSTOM_FONT_STYLE_ELEMENT_ID,
  ) as HTMLStyleElement | null;

  if (!styleElement) {
    styleElement = targetDocument.createElement("style");
    styleElement.id = CUSTOM_FONT_STYLE_ELEMENT_ID;
    targetDocument.head.append(styleElement);
  }

  styleElement.textContent = customFaces.map(buildFontFaceCssRule).join("\n\n");
}

async function loadFontCatalogState() {
  if (!window.fontAPI) {
    return INITIAL_FONT_CATALOG_STATE;
  }

  const [systemFamilies, detailedSystemFaces, customFaces] = await Promise.all([
    window.fontAPI.getSystemFonts().catch(() => [] as string[]),
    window.fontAPI.getSystemFontFaces
      ? window.fontAPI.getSystemFontFaces().catch(() => [] as SystemFontFace[])
      : Promise.resolve([] as SystemFontFace[]),
    window.fontAPI.getCustomFonts
      ? window.fontAPI.getCustomFonts().catch(() => [] as CustomFontFace[])
      : Promise.resolve([] as CustomFontFace[]),
  ]);

  const fallbackFaces =
    detailedSystemFaces.length > 0
      ? detailedSystemFaces
      : buildFallbackFaces(systemFamilies.length > 0 ? systemFamilies : FALLBACK_SYSTEM_FONTS);
  const faces = dedupeFontFaces([...fallbackFaces, ...customFaces]);

  return {
    loading: false,
    loaded: true,
    error: null,
    families: buildFamilies(faces),
    faces,
    customFaces,
  } satisfies FontCatalogState;
}

export async function ensureFontCatalogLoaded(
  targetDocument: Document = document,
  options?: { force?: boolean },
) {
  if (fontCatalogState.loaded && !options?.force) {
    injectCustomFontsIntoDocument(targetDocument, fontCatalogState.customFaces);
    return fontCatalogState;
  }

  if (fontCatalogPromise && !options?.force) {
    const resolved = await fontCatalogPromise;
    injectCustomFontsIntoDocument(targetDocument, resolved.customFaces);
    return resolved;
  }

  emitFontCatalogState({
    ...fontCatalogState,
    loading: true,
    error: null,
  });

  fontCatalogPromise = loadFontCatalogState();

  try {
    const nextState = await fontCatalogPromise;
    injectCustomFontsIntoDocument(targetDocument, nextState.customFaces);
    emitFontCatalogState(nextState);
    return nextState;
  } catch (error) {
    const nextState = {
      ...fontCatalogState,
      loading: false,
      loaded: true,
      error: userMessage(error, "The fonts couldn't be loaded.", "Fonts"),
    } satisfies FontCatalogState;
    emitFontCatalogState(nextState);
    return nextState;
  } finally {
    fontCatalogPromise = null;
  }
}

export async function installCustomFontsFromPicker(
  targetDocument: Document = document,
) {
  if (!window.fontAPI?.pickFontFile || !window.fontAPI.installCustomFonts) {
    throw new Error("Custom font loading is unavailable in this build.");
  }

  const pickedFilePaths = await window.fontAPI.pickFontFile();
  if (!pickedFilePaths?.length) {
    return fontCatalogState;
  }

  const installedFonts = await window.fontAPI.installCustomFonts(pickedFilePaths);
  const customFaces = dedupeFontFaces([
    ...fontCatalogState.customFaces,
    ...installedFonts,
  ]) as CustomFontFace[];
  const systemFaces = fontCatalogState.faces.filter(
    (face): face is SystemFontFace => face.source === "system",
  );
  const faces = dedupeFontFaces([...systemFaces, ...customFaces]);
  const nextState: FontCatalogState = {
    loading: false,
    loaded: true,
    error: null,
    families: buildFamilies(faces),
    faces,
    customFaces,
  };

  injectCustomFontsIntoDocument(targetDocument, customFaces);
  emitFontCatalogState(nextState);
  return nextState;
}

export function getFontFacesForFamily(
  faces: FontFaceRecord[],
  familyName: string,
) {
  return dedupeFontFaces(
    faces.filter(
      (face) =>
        face.familyName.localeCompare(familyName, undefined, {
          sensitivity: "accent",
        }) === 0,
    ),
  );
}

export function getFontWeightOptionsForFamily(
  faces: FontFaceRecord[],
  familyName: string,
) {
  return buildFontWeightOptions(getFontFacesForFamily(faces, familyName));
}

export function resolveFontWeightForFamily(
  faces: FontFaceRecord[],
  familyName: string,
  requestedWeight?: string | null,
) {
  const options = getFontWeightOptionsForFamily(faces, familyName);
  if (options.length === 0) {
    return requestedWeight ?? "400";
  }

  if (requestedWeight && options.some((option) => option.value === requestedWeight)) {
    return requestedWeight;
  }

  return (
    options.find((option) => option.value === "400")?.value ??
    options.find((option) => option.value === "500")?.value ??
    options[0]?.value ??
    "400"
  );
}

export function useFontCatalog() {
  const [state, setState] = useState<FontCatalogState>(fontCatalogState);

  useEffect(() => {
    fontCatalogListeners.add(setState);
    return () => {
      fontCatalogListeners.delete(setState);
    };
  }, []);

  useEffect(() => {
    void ensureFontCatalogLoaded(document);
  }, []);

  const availableFamilies = useMemo(
    () => (state.families.length > 0 ? state.families : FALLBACK_SYSTEM_FONTS),
    [state.families],
  );

  return {
    ...state,
    families: availableFamilies,
    refreshFonts: (targetDocument: Document = document) =>
      ensureFontCatalogLoaded(targetDocument, { force: true }),
    installCustomFonts: (targetDocument: Document = document) =>
      installCustomFontsFromPicker(targetDocument),
  };
}
