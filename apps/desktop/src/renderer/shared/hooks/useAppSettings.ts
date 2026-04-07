import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Settings,
  SETTINGS_STORAGE_KEY
} from "../../../features/settings/lib/constants";
import { MediaItem, MediaFolder } from "../../../features/media/hooks/useMediaFolders";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";

const DEFAULT_SCRIPTURE_FONT_SIZE = 96;
const DEFAULT_SCRIPTURE_FONT_WEIGHT = "400";
const DEFAULT_SCRIPTURE_TEXT_ALIGN: ScriptureTextAlign = "left";
const DEFAULT_SCRIPTURE_VERTICAL_ALIGN: ScriptureVerticalAlign = "middle";
const DEFAULT_SCRIPTURE_FOOTER_ALIGN: ScriptureTextAlign = "center";
const DEFAULT_SCRIPTURE_FOOTER_POSITION: ScriptureFooterPosition = "bottom";
const DEFAULT_LIBRARY_FONT_SIZE = 80;
const DEFAULT_LIBRARY_FONT_WEIGHT = "400";
const DEFAULT_TIMER_X = 82;
const DEFAULT_TIMER_Y = 8;
const DEFAULT_TIMER_CLOCK_FONT_PX = 24;
const DEFAULT_TIMER_NAME_FONT_PX = 14;
const DEFAULT_TIMER_CLOCK_COLOR = "#ffffff";
const DEFAULT_TIMER_NAME_COLOR = "#ffffff";
const DEFAULT_TIMER_NAME_BANNER_ENABLED = false;
const DEFAULT_TIMER_NAME_BANNER_COLOR = "#ffffff";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampTimerLayout(layout: {
  xPercent: number;
  yPercent: number;
}) {
  const xPercent = Math.min(Math.max(layout.xPercent, 0), 100);
  const yPercent = Math.min(Math.max(layout.yPercent, 0), 100);
  return { xPercent, yPercent };
}

function normalizeScriptureFontSize(value: number) {
  const legacyAdjusted = value <= 30 ? value * 4 : value;
  return Math.min(Math.max(Math.round(legacyAdjusted), 24), 400);
}

function normalizeLibraryFontSize(value: number) {
  return Math.min(Math.max(Math.round(value), 24), 400);
}

function normalizeFontWeight(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "400";
}

interface UseAppSettingsProps {
  folders: MediaFolder[];
  allMediaItems: MediaItem[];
}

export function useAppSettings({ folders, allMediaItems }: UseAppSettingsProps) {
  const lastSettingsRawRef = useRef<string | null>(null);
  const [settingsLang, setSettingsLang] = useState("en-US");
  const [settingsScriptureBackgroundId, setSettingsScriptureBackgroundId] =
    useState<string | null>(null);
  const [settingsScriptureFontSize, setSettingsScriptureFontSize] =
    useState(DEFAULT_SCRIPTURE_FONT_SIZE);
  const [settingsScriptureFontFamily, setSettingsScriptureFontFamily] =
    useState("Inter");
  const [settingsScriptureFontWeight, setSettingsScriptureFontWeight] =
    useState(DEFAULT_SCRIPTURE_FONT_WEIGHT);
  const [settingsScriptureTextAlign, setSettingsScriptureTextAlign] = useState<
    ScriptureTextAlign
  >(DEFAULT_SCRIPTURE_TEXT_ALIGN);
  const [settingsScriptureVerticalAlign, setSettingsScriptureVerticalAlign] =
    useState<ScriptureVerticalAlign>(DEFAULT_SCRIPTURE_VERTICAL_ALIGN);
  const [settingsScriptureFooterAlign, setSettingsScriptureFooterAlign] =
    useState<ScriptureTextAlign>(DEFAULT_SCRIPTURE_FOOTER_ALIGN);
  const [settingsScriptureFooterPosition, setSettingsScriptureFooterPosition] =
    useState<ScriptureFooterPosition>(DEFAULT_SCRIPTURE_FOOTER_POSITION);
  const [settingsLibraryFontSize, setSettingsLibraryFontSize] = useState(
    DEFAULT_LIBRARY_FONT_SIZE
  );
  const [settingsLibraryFontFamily, setSettingsLibraryFontFamily] =
    useState("Inter");
  const [settingsLibraryFontWeight, setSettingsLibraryFontWeight] =
    useState(DEFAULT_LIBRARY_FONT_WEIGHT);
  const [settingsTimerXPercent, setSettingsTimerXPercent] = useState(DEFAULT_TIMER_X);
  const [settingsTimerYPercent, setSettingsTimerYPercent] = useState(DEFAULT_TIMER_Y);
  const [settingsTimerClockFontPx, setSettingsTimerClockFontPx] = useState(
    DEFAULT_TIMER_CLOCK_FONT_PX
  );
  const [settingsTimerNameFontPx, setSettingsTimerNameFontPx] = useState(
    DEFAULT_TIMER_NAME_FONT_PX
  );
  const [settingsTimerClockColor, setSettingsTimerClockColor] = useState(
    DEFAULT_TIMER_CLOCK_COLOR
  );
  const [settingsTimerNameColor, setSettingsTimerNameColor] = useState(
    DEFAULT_TIMER_NAME_COLOR
  );
  const [settingsTimerNameBannerEnabled, setSettingsTimerNameBannerEnabled] =
    useState(DEFAULT_TIMER_NAME_BANNER_ENABLED);
  const [settingsTimerNameBannerColor, setSettingsTimerNameBannerColor] =
    useState(DEFAULT_TIMER_NAME_BANNER_COLOR);
  const [settingsTimerTitlePosition, setSettingsTimerTitlePosition] = useState<
    "top" | "bottom"
  >("bottom");
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const [settingsMediaFolderId, setSettingsMediaFolderId] = useState<
    string | "all"
  >("all");

  const settingsMediaItems = useMemo(
    () =>
      settingsMediaFolderId === "all"
        ? allMediaItems
        : allMediaItems.filter(
          (item) => item.folderId === settingsMediaFolderId,
        ),
    [allMediaItems, settingsMediaFolderId],
  );

  const applyParsedSettings = useCallback((parsed: Partial<Settings>) => {
    if (typeof parsed.scriptureSpeechLang === "string") {
      setSettingsLang(parsed.scriptureSpeechLang);
    }
    if (typeof parsed.scriptureBackgroundMediaId === "string") {
      setSettingsScriptureBackgroundId(parsed.scriptureBackgroundMediaId);
    }
    if (parsed.scriptureBackgroundMediaId === null) {
      setSettingsScriptureBackgroundId(null);
    }
    if (isFiniteNumber(parsed.scriptureFontSize)) {
      setSettingsScriptureFontSize(
        normalizeScriptureFontSize(parsed.scriptureFontSize)
      );
    }
    if (typeof parsed.scriptureFontFamily === "string") {
      setSettingsScriptureFontFamily(parsed.scriptureFontFamily);
    }
    if (typeof parsed.scriptureFontWeight === "string") {
      setSettingsScriptureFontWeight(
        normalizeFontWeight(parsed.scriptureFontWeight)
      );
    }
    if (
      parsed.scriptureTextAlign === "left" ||
      parsed.scriptureTextAlign === "center" ||
      parsed.scriptureTextAlign === "right"
    ) {
      setSettingsScriptureTextAlign(parsed.scriptureTextAlign);
    }
    if (
      parsed.scriptureVerticalAlign === "top" ||
      parsed.scriptureVerticalAlign === "middle" ||
      parsed.scriptureVerticalAlign === "bottom"
    ) {
      setSettingsScriptureVerticalAlign(parsed.scriptureVerticalAlign);
    }
    if (
      parsed.scriptureFooterAlign === "left" ||
      parsed.scriptureFooterAlign === "center" ||
      parsed.scriptureFooterAlign === "right"
    ) {
      setSettingsScriptureFooterAlign(parsed.scriptureFooterAlign);
    }
    if (
      parsed.scriptureFooterPosition === "top" ||
      parsed.scriptureFooterPosition === "bottom"
    ) {
      setSettingsScriptureFooterPosition(parsed.scriptureFooterPosition);
    }
    if (isFiniteNumber(parsed.libraryFontSize)) {
      setSettingsLibraryFontSize(normalizeLibraryFontSize(parsed.libraryFontSize));
    }
    if (typeof parsed.libraryFontFamily === "string") {
      setSettingsLibraryFontFamily(parsed.libraryFontFamily);
    }
    if (typeof parsed.libraryFontWeight === "string") {
      setSettingsLibraryFontWeight(
        normalizeFontWeight(parsed.libraryFontWeight)
      );
    }
    const nextTimer = clampTimerLayout({
      xPercent: isFiniteNumber(parsed.timerXPercent) ? parsed.timerXPercent : DEFAULT_TIMER_X,
      yPercent: isFiniteNumber(parsed.timerYPercent) ? parsed.timerYPercent : DEFAULT_TIMER_Y,
    });
    setSettingsTimerXPercent(nextTimer.xPercent);
    setSettingsTimerYPercent(nextTimer.yPercent);
    if (isFiniteNumber(parsed.timerClockFontPx)) {
      setSettingsTimerClockFontPx(Math.min(Math.max(parsed.timerClockFontPx, 12), 400));
    }
    if (isFiniteNumber(parsed.timerNameFontPx)) {
      setSettingsTimerNameFontPx(Math.min(Math.max(parsed.timerNameFontPx, 8), 220));
    }
    if (typeof parsed.timerClockColor === "string") {
      setSettingsTimerClockColor(parsed.timerClockColor);
    }
    if (typeof parsed.timerNameColor === "string") {
      setSettingsTimerNameColor(parsed.timerNameColor);
    }
    if (typeof parsed.timerNameBannerEnabled === "boolean") {
      setSettingsTimerNameBannerEnabled(parsed.timerNameBannerEnabled);
    }
    if (typeof parsed.timerNameBannerColor === "string") {
      setSettingsTimerNameBannerColor(parsed.timerNameBannerColor);
    }
    if (parsed.timerTitlePosition === "top" || parsed.timerTitlePosition === "bottom") {
      setSettingsTimerTitlePosition(parsed.timerTitlePosition);
    }
  }, []);

  const syncFromStorage = useCallback(() => {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw || raw === lastSettingsRawRef.current) {
      return;
    }
    try {
      applyParsedSettings(JSON.parse(raw) as Partial<Settings>);
      lastSettingsRawRef.current = raw;
    } catch {
      void 0;
    }
  }, [applyParsedSettings]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw) {
        applyParsedSettings(JSON.parse(raw) as Partial<Settings>);
        lastSettingsRawRef.current = raw;
      }
    } catch {
      void 0;
    } finally {
      setSettingsHydrated(true);
    }
  }, [applyParsedSettings]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY || !event.newValue) {
        return;
      }
      try {
        applyParsedSettings(JSON.parse(event.newValue) as Partial<Settings>);
        lastSettingsRawRef.current = event.newValue;
      } catch {
        void 0;
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", syncFromStorage);
    const intervalId = window.setInterval(syncFromStorage, 400);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", syncFromStorage);
      window.clearInterval(intervalId);
    };
  }, [applyParsedSettings, syncFromStorage]);

  useEffect(() => {
    if (!settingsHydrated) return;
    try {
      const timerLayout = clampTimerLayout({
        xPercent: settingsTimerXPercent,
        yPercent: settingsTimerYPercent,
      });
      const next: Settings = {
        scriptureSpeechLang: settingsLang,
        scriptureBackgroundMediaId: settingsScriptureBackgroundId ?? null,
        scriptureFontSize: settingsScriptureFontSize,
        scriptureFontFamily: settingsScriptureFontFamily,
        scriptureFontWeight: normalizeFontWeight(settingsScriptureFontWeight),
        scriptureTextAlign: settingsScriptureTextAlign,
        scriptureVerticalAlign: settingsScriptureVerticalAlign,
        scriptureFooterAlign: settingsScriptureFooterAlign,
        scriptureFooterPosition: settingsScriptureFooterPosition,
        libraryFontSize: normalizeLibraryFontSize(settingsLibraryFontSize),
        libraryFontFamily: settingsLibraryFontFamily,
        libraryFontWeight: normalizeFontWeight(settingsLibraryFontWeight),
        timerXPercent: timerLayout.xPercent,
        timerYPercent: timerLayout.yPercent,
        timerClockFontPx: Math.min(Math.max(settingsTimerClockFontPx, 12), 400),
        timerNameFontPx: Math.min(Math.max(settingsTimerNameFontPx, 8), 220),
        timerClockColor: settingsTimerClockColor,
        timerNameColor: settingsTimerNameColor,
        timerNameBannerEnabled: settingsTimerNameBannerEnabled,
        timerNameBannerColor: settingsTimerNameBannerColor,
        timerTitlePosition: settingsTimerTitlePosition,
      };
      const serialized = JSON.stringify(next);
      localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
      lastSettingsRawRef.current = serialized;
    } catch {
      // Ignore errors
    }
  }, [
    settingsHydrated,
    settingsLang,
    settingsScriptureBackgroundId,
    settingsScriptureFontSize,
    settingsScriptureFontFamily,
    settingsScriptureFontWeight,
    settingsScriptureTextAlign,
    settingsScriptureVerticalAlign,
    settingsScriptureFooterAlign,
    settingsScriptureFooterPosition,
    settingsLibraryFontSize,
    settingsLibraryFontFamily,
    settingsLibraryFontWeight,
    settingsTimerXPercent,
    settingsTimerYPercent,
    settingsTimerClockFontPx,
    settingsTimerNameFontPx,
    settingsTimerClockColor,
    settingsTimerNameColor,
    settingsTimerNameBannerEnabled,
    settingsTimerNameBannerColor,
    settingsTimerTitlePosition,
  ]);

  useEffect(() => {
    if (settingsMediaFolderId !== "all") return;
    if (folders.length === 0) return;
    setSettingsMediaFolderId(folders[0].id);
  }, [folders, settingsMediaFolderId]);

  return {
    settingsLang,
    setSettingsLang,
    settingsScriptureBackgroundId,
    setSettingsScriptureBackgroundId,
    settingsScriptureFontSize,
    setSettingsScriptureFontSize,
    settingsScriptureFontFamily,
    setSettingsScriptureFontFamily,
    settingsScriptureFontWeight,
    setSettingsScriptureFontWeight,
    settingsScriptureTextAlign,
    setSettingsScriptureTextAlign,
    settingsScriptureVerticalAlign,
    setSettingsScriptureVerticalAlign,
    settingsScriptureFooterAlign,
    setSettingsScriptureFooterAlign,
    settingsScriptureFooterPosition,
    setSettingsScriptureFooterPosition,
    settingsLibraryFontSize,
    setSettingsLibraryFontSize,
    settingsLibraryFontFamily,
    setSettingsLibraryFontFamily,
    settingsLibraryFontWeight,
    setSettingsLibraryFontWeight,
    settingsTimerXPercent,
    setSettingsTimerXPercent,
    settingsTimerYPercent,
    setSettingsTimerYPercent,
    settingsTimerClockFontPx,
    setSettingsTimerClockFontPx,
    settingsTimerNameFontPx,
    setSettingsTimerNameFontPx,
    settingsTimerClockColor,
    setSettingsTimerClockColor,
    settingsTimerNameColor,
    setSettingsTimerNameColor,
    settingsTimerNameBannerEnabled,
    setSettingsTimerNameBannerEnabled,
    settingsTimerNameBannerColor,
    setSettingsTimerNameBannerColor,
    settingsTimerTitlePosition,
    setSettingsTimerTitlePosition,
    settingsHydrated,
    settingsMediaFolderId,
    setSettingsMediaFolderId,
    settingsMediaItems,
  };
}
