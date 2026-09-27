import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  DEFAULT_AGENT_SETTINGS,
  normalizeAgentSettings,
  Settings,
  SETTINGS_STORAGE_KEY,
  type AgentSettings,
} from "../../../features/settings/lib/constants";
import { MediaItem, MediaFolder } from "../../../features/media/hooks/useMediaFolders";
import { useAudioDeviceSync } from "./useAudioRouting";
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
const DEFAULT_SCRIPTURE_FOOTER_FONT_SIZE = 70;
const DEFAULT_LIBRARY_FONT_SIZE = 80;
const DEFAULT_LIBRARY_FONT_WEIGHT = "400";
const DEFAULT_TIMER_X = 82;
const DEFAULT_TIMER_Y = 8;
const DEFAULT_TIMER_CLOCK_FONT_PX = 24;
const DEFAULT_TIMER_NAME_FONT_PX = 14;
const DEFAULT_TIMER_NAME_BANNER_HEIGHT_PX = 48;
const DEFAULT_TIMER_CLOCK_COLOR = "#ffffff";
const DEFAULT_TIMER_NAME_COLOR = "#ffffff";
const DEFAULT_TIMER_NAME_BANNER_ENABLED = false;
const DEFAULT_TIMER_NAME_BANNER_COLOR = "#ffffff";
const DEFAULT_OUTPUT_DISPLAY_ID: number | null = null;
type ScreenRole = "audience" | "media" | "worship";
type ScreenDisplayIds = Record<ScreenRole, number | null>;
type ScreenResolutions = Record<ScreenRole, string>;
const DEFAULT_SCREEN_DISPLAY_IDS: ScreenDisplayIds = {
  audience: DEFAULT_OUTPUT_DISPLAY_ID,
  media: null,
  worship: null,
};
const DEFAULT_SCREEN_RESOLUTIONS: ScreenResolutions = {
  audience: "1920x1080",
  media: "1920x1080",
  worship: "1920x1080",
};
const DEFAULT_NDI_ENABLED = false;
const DEFAULT_NDI_SOURCE_NAME = "Present Main Output";
const DEFAULT_NDI_GROUP_NAME = "Public";
/** What the stream declares and is paced to; the core allows these five. */
export const NDI_FRAME_RATES = [24, 25, 30, 50, 60] as const;
const DEFAULT_NDI_FRAME_RATE = 30;
const swallowAsyncError = (): null => null;
const DEFAULT_NDI_RUNTIME_STATUS = {
  running: false,
  sourceName: DEFAULT_NDI_SOURCE_NAME,
  groupName: DEFAULT_NDI_GROUP_NAME,
  lastError: null as string | null,
  libraryLoaded: false,
  framesSent: 0,
  usingFallbackFrame: false,
};

/**
 * Told to every window when one changes a setting, with the whole settings as
 * saved.
 *
 * Settings is a window of its own, and the others used to find out about a
 * change only by reading local storage on a timer or when they were next
 * focused. macOS slows a background window's timers right down, so the
 * operator window, and the audience screen it drives, kept the old Bible size
 * until somebody clicked back into it, and the setting looked as if it had
 * not taken.
 */
const SETTINGS_CHANGED_EVENT = "present:settings-changed";

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
  return Math.max(Math.round(legacyAdjusted), 12);
}

function normalizeScriptureFooterFontSize(value: number) {
  return Math.max(Math.round(value), 8);
}

function deriveScriptureFooterFontSize(scriptureFontSize: number) {
  return normalizeScriptureFooterFontSize(
    Math.max(16, Math.round(scriptureFontSize * 0.28)),
  );
}

function normalizeLibraryFontSize(value: number) {
  return Math.max(Math.round(value), 24);
}

function normalizeFontWeight(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "400";
}

function normalizeNdiGroupName(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return DEFAULT_NDI_GROUP_NAME;
  }
  return trimmed.toLowerCase() === "public" ? "Public" : trimmed;
}

function normalizeDisplayId(value: unknown): number | null {
  if (value === null) return null;
  return isFiniteNumber(value) ? Math.round(value) : null;
}

function normalizeResolution(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^\d{3,5}x\d{3,5}$/.test(value.trim()) ? value.trim() : null;
}

interface UseAppSettingsProps {
  folders: MediaFolder[];
  allMediaItems: MediaItem[];
}

export function useAppSettings({ folders, allMediaItems }: UseAppSettingsProps) {
  const lastSettingsRawRef = useRef<string | null>(null);
  const [settingsLang, setSettingsLang] = useState("en-US");
  const [settingsSpeechInputDeviceId, setSettingsSpeechInputDeviceId] = useState<
    string | null
  >(null);
  const [settingsAudioOutputDeviceId, setSettingsAudioOutputDeviceId] = useState<string | null>(null);
  const [settingsAudioOutputDeviceLabel, setSettingsAudioOutputDeviceLabel] = useState("System Default");
  const [settingsScriptureBackgroundId, setSettingsScriptureBackgroundId] =
    useState<string | null>(null);
  const [settingsScriptureFontSize, setSettingsScriptureFontSize] =
    useState(DEFAULT_SCRIPTURE_FONT_SIZE);
  const [settingsScriptureFooterFontSize, setSettingsScriptureFooterFontSize] =
    useState(DEFAULT_SCRIPTURE_FOOTER_FONT_SIZE);
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
  const [settingsTimerNameBannerHeightPx, setSettingsTimerNameBannerHeightPx] =
    useState(DEFAULT_TIMER_NAME_BANNER_HEIGHT_PX);
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
  const [settingsOutputDisplayId, setSettingsOutputDisplayId] = useState<
    number | null
  >(DEFAULT_OUTPUT_DISPLAY_ID);
  const [settingsScreenDisplayIds, setSettingsScreenDisplayIds] =
    useState<ScreenDisplayIds>(DEFAULT_SCREEN_DISPLAY_IDS);
  const [settingsScreenResolutions, setSettingsScreenResolutions] =
    useState<ScreenResolutions>(DEFAULT_SCREEN_RESOLUTIONS);
  const [settingsNdiEnabled, setSettingsNdiEnabled] = useState(
    DEFAULT_NDI_ENABLED
  );
  const [settingsNdiSourceName, setSettingsNdiSourceName] = useState(
    DEFAULT_NDI_SOURCE_NAME
  );
  const [settingsNdiGroupName, setSettingsNdiGroupName] = useState(
    DEFAULT_NDI_GROUP_NAME
  );
  const [settingsNdiFrameRate, setSettingsNdiFrameRate] = useState<number>(
    DEFAULT_NDI_FRAME_RATE
  );
  const [settingsNdiRuntimeStatus, setSettingsNdiRuntimeStatus] = useState(
    DEFAULT_NDI_RUNTIME_STATUS
  );
  const [settingsAgent, setSettingsAgentState] =
    useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const setSettingsAgent = useCallback(
    (patch: Partial<AgentSettings>) =>
      setSettingsAgentState((previous) => ({ ...previous, ...patch })),
    [],
  );
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
    let parsedScriptureFontSize: number | null = null;

    if (typeof parsed.scriptureSpeechLang === "string") {
      setSettingsLang(parsed.scriptureSpeechLang);
    }
    if (typeof parsed.speechInputDeviceId === "string") {
      const normalized = parsed.speechInputDeviceId.trim();
      setSettingsSpeechInputDeviceId(normalized.length > 0 ? normalized : null);
    }
    if (parsed.speechInputDeviceId === null) {
      setSettingsSpeechInputDeviceId(null);
    }
    if (typeof parsed.audioOutputDeviceId === "string") {
      const normalized = parsed.audioOutputDeviceId.trim();
      setSettingsAudioOutputDeviceId(normalized.length > 0 ? normalized : null);
    }
    if (parsed.audioOutputDeviceId === null) setSettingsAudioOutputDeviceId(null);
    if (typeof parsed.audioOutputDeviceLabel === "string") {
      setSettingsAudioOutputDeviceLabel(parsed.audioOutputDeviceLabel || "System Default");
    }
    if (typeof parsed.scriptureBackgroundMediaId === "string") {
      setSettingsScriptureBackgroundId(parsed.scriptureBackgroundMediaId);
    }
    if (parsed.scriptureBackgroundMediaId === null) {
      setSettingsScriptureBackgroundId(null);
    }
    if (isFiniteNumber(parsed.scriptureFontSize)) {
      parsedScriptureFontSize = normalizeScriptureFontSize(parsed.scriptureFontSize);
      setSettingsScriptureFontSize(parsedScriptureFontSize);
    }
    if (isFiniteNumber(parsed.scriptureFooterFontSize)) {
      setSettingsScriptureFooterFontSize(
        normalizeScriptureFooterFontSize(parsed.scriptureFooterFontSize)
      );
    } else if (parsedScriptureFontSize !== null) {
      // Backward compatibility for old settings blobs without explicit footer size.
      setSettingsScriptureFooterFontSize(
        deriveScriptureFooterFontSize(parsedScriptureFontSize)
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
    if (isFiniteNumber(parsed.timerNameBannerHeightPx)) {
      setSettingsTimerNameBannerHeightPx(
        Math.min(Math.max(parsed.timerNameBannerHeightPx, 32), 160),
      );
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
    if (parsed.outputDisplayId === null) {
      setSettingsOutputDisplayId(null);
      setSettingsScreenDisplayIds((previous) => ({
        ...previous,
        audience: null,
      }));
    } else if (isFiniteNumber(parsed.outputDisplayId)) {
      const nextAudienceId = Math.round(parsed.outputDisplayId);
      setSettingsOutputDisplayId(nextAudienceId);
      setSettingsScreenDisplayIds((previous) => ({
        ...previous,
        audience: nextAudienceId,
      }));
    }
    if (parsed.screenDisplayIds && typeof parsed.screenDisplayIds === "object") {
      const nextScreenDisplayIds: ScreenDisplayIds = {
        audience: normalizeDisplayId(parsed.screenDisplayIds.audience),
        media: normalizeDisplayId(parsed.screenDisplayIds.media),
        worship: normalizeDisplayId(parsed.screenDisplayIds.worship),
      };
      setSettingsScreenDisplayIds(nextScreenDisplayIds);
      setSettingsOutputDisplayId(nextScreenDisplayIds.audience);
    }
    if (parsed.screenResolutions && typeof parsed.screenResolutions === "object") {
      setSettingsScreenResolutions({
        audience:
          normalizeResolution(parsed.screenResolutions.audience) ??
          DEFAULT_SCREEN_RESOLUTIONS.audience,
        media:
          normalizeResolution(parsed.screenResolutions.media) ??
          DEFAULT_SCREEN_RESOLUTIONS.media,
        worship:
          normalizeResolution(parsed.screenResolutions.worship) ??
          DEFAULT_SCREEN_RESOLUTIONS.worship,
      });
    }
    if (typeof parsed.ndiEnabled === "boolean") {
      setSettingsNdiEnabled(parsed.ndiEnabled);
    }
    if (typeof parsed.ndiSourceName === "string") {
      const normalized = parsed.ndiSourceName.trim();
      setSettingsNdiSourceName(
        normalized.length > 0 ? normalized : DEFAULT_NDI_SOURCE_NAME
      );
    }
    if (
      typeof parsed.ndiFrameRate === "number" &&
      (NDI_FRAME_RATES as readonly number[]).includes(parsed.ndiFrameRate)
    ) {
      setSettingsNdiFrameRate(parsed.ndiFrameRate);
    }
    if (typeof parsed.ndiGroupName === "string") {
      setSettingsNdiGroupName(normalizeNdiGroupName(parsed.ndiGroupName));
    }
    if (parsed.agent && typeof parsed.agent === "object") {
      setSettingsAgentState(normalizeAgentSettings(parsed.agent));
    }
  }, []);

  // The audio-output device belongs to the Rust sink, because both audible
  // sources read it from there rather than each applying it to their own
  // element (known-issues §1). This keeps the picker and the sink in step.
  const seedAudioDeviceFromRust = useCallback(
    (deviceId: string | null, deviceLabel: string) => {
      setSettingsAudioOutputDeviceId(deviceId);
      setSettingsAudioOutputDeviceLabel(deviceLabel);
    },
    [],
  );
  useAudioDeviceSync(
    settingsHydrated,
    settingsAudioOutputDeviceId,
    settingsAudioOutputDeviceLabel,
    seedAudioDeviceFromRust,
  );

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

    // Straight from the window that made the change, whether this one is in
    // front or not.
    let cancelled = false;
    let detach: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>(SETTINGS_CHANGED_EVENT, (event) => {
          const raw = event.payload;
          if (typeof raw !== "string" || raw === lastSettingsRawRef.current) return;
          try {
            applyParsedSettings(JSON.parse(raw) as Partial<Settings>);
            lastSettingsRawRef.current = raw;
          } catch {
            void 0;
          }
        }),
      )
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        detach = unlisten;
      })
      .catch(() => {
        // Not in the desktop app (a test, a browser): storage and focus still
        // carry changes.
      });

    return () => {
      cancelled = true;
      detach?.();
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
        speechInputDeviceId: settingsSpeechInputDeviceId,
        audioOutputDeviceId: settingsAudioOutputDeviceId,
        audioOutputDeviceLabel: settingsAudioOutputDeviceLabel,
        scriptureBackgroundMediaId: settingsScriptureBackgroundId ?? null,
        scriptureFontSize: settingsScriptureFontSize,
        scriptureFooterFontSize: normalizeScriptureFooterFontSize(
          settingsScriptureFooterFontSize
        ),
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
        timerNameBannerHeightPx: Math.min(
          Math.max(settingsTimerNameBannerHeightPx, 32),
          160,
        ),
        timerClockColor: settingsTimerClockColor,
        timerNameColor: settingsTimerNameColor,
        timerNameBannerEnabled: settingsTimerNameBannerEnabled,
        timerNameBannerColor: settingsTimerNameBannerColor,
        timerTitlePosition: settingsTimerTitlePosition,
        outputDisplayId: settingsOutputDisplayId,
        screenDisplayIds: settingsScreenDisplayIds,
        screenResolutions: settingsScreenResolutions,
        ndiEnabled: settingsNdiEnabled,
        ndiSourceName:
          settingsNdiSourceName.trim() || DEFAULT_NDI_SOURCE_NAME,
        ndiGroupName: normalizeNdiGroupName(settingsNdiGroupName),
        ndiFrameRate: settingsNdiFrameRate,
        agent: settingsAgent,
      };
      const serialized = JSON.stringify(next);
      // Only a change made here is told to the others: one that arrived from
      // another window serialises to what it arrived as.
      const changedHere = serialized !== lastSettingsRawRef.current;
      localStorage.setItem(SETTINGS_STORAGE_KEY, serialized);
      lastSettingsRawRef.current = serialized;
      if (changedHere) {
        void import("@tauri-apps/api/event")
          .then(({ emit }) => emit(SETTINGS_CHANGED_EVENT, serialized))
          .catch((): void => undefined);
      }
    } catch {
      // Ignore errors
    }
  }, [
    settingsHydrated,
    settingsLang,
    settingsSpeechInputDeviceId,
    settingsAudioOutputDeviceId,
    settingsAudioOutputDeviceLabel,
    settingsScriptureBackgroundId,
    settingsScriptureFontSize,
    settingsScriptureFooterFontSize,
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
    settingsTimerNameBannerHeightPx,
    settingsTimerClockColor,
    settingsTimerNameColor,
    settingsTimerNameBannerEnabled,
    settingsTimerNameBannerColor,
    settingsTimerTitlePosition,
    settingsOutputDisplayId,
    settingsScreenDisplayIds,
    settingsScreenResolutions,
    settingsNdiEnabled,
    settingsNdiSourceName,
    settingsNdiGroupName,
    settingsNdiFrameRate,
    settingsAgent,
  ]);

  useEffect(() => {
    if (settingsMediaFolderId !== "all") return;
    if (folders.length === 0) return;
    setSettingsMediaFolderId(folders[0].id);
  }, [folders, settingsMediaFolderId]);

  useEffect(() => {
    if (!settingsHydrated) return;

    if (settingsNdiEnabled && window.electronAPI?.startNdiOutput) {
      void window.electronAPI
        .startNdiOutput(
          settingsNdiSourceName,
          settingsNdiGroupName,
          settingsNdiFrameRate
        )
        .then((result) => {
          setSettingsNdiRuntimeStatus(result.status);
        })
        .catch(() => {
          setSettingsNdiRuntimeStatus((previous) => ({
            ...previous,
            running: false,
            lastError: "Failed to start NDI output",
          }));
        });
    } else if (!settingsNdiEnabled && window.electronAPI?.stopNdiOutput) {
      void window.electronAPI
        .stopNdiOutput()
        .then(() => {
          setSettingsNdiRuntimeStatus((previous) => ({
            ...previous,
            running: false,
            lastError: null,
          }));
        })
        .catch(swallowAsyncError);
    }
  }, [
    settingsNdiEnabled,
    settingsNdiSourceName,
    settingsNdiGroupName,
    settingsNdiFrameRate,
    settingsHydrated,
  ]);

  useEffect(() => {
    if (!settingsHydrated || !window.electronAPI?.getNdiStatus) {
      return;
    }
    let mounted = true;
    const refreshStatus = async () => {
      try {
        const status = await window.electronAPI.getNdiStatus();
        if (mounted) {
          setSettingsNdiRuntimeStatus(status);
        }
      } catch {
        if (mounted) {
          setSettingsNdiRuntimeStatus((previous) => ({
            ...previous,
            lastError: "Unable to read NDI status",
          }));
        }
      }
    };
    void refreshStatus();
    const intervalId = window.setInterval(() => {
      void refreshStatus();
    }, 1000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [settingsHydrated]);

  return {
    settingsLang,
    setSettingsLang,
    settingsSpeechInputDeviceId,
    setSettingsSpeechInputDeviceId,
    settingsAudioOutputDeviceId,
    setSettingsAudioOutputDeviceId,
    settingsAudioOutputDeviceLabel,
    setSettingsAudioOutputDeviceLabel,
    settingsScriptureBackgroundId,
    setSettingsScriptureBackgroundId,
    settingsScriptureFontSize,
    setSettingsScriptureFontSize,
    settingsScriptureFooterFontSize,
    setSettingsScriptureFooterFontSize,
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
    settingsTimerNameBannerHeightPx,
    setSettingsTimerNameBannerHeightPx,
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
    settingsOutputDisplayId,
    setSettingsOutputDisplayId,
    settingsScreenDisplayIds,
    setSettingsScreenDisplayIds,
    settingsScreenResolutions,
    setSettingsScreenResolutions,
    settingsNdiEnabled,
    setSettingsNdiEnabled,
    settingsNdiSourceName,
    setSettingsNdiSourceName,
    settingsNdiGroupName,
    setSettingsNdiGroupName,
    settingsNdiFrameRate,
    setSettingsNdiFrameRate,
    settingsNdiRuntimeStatus,
    settingsAgent,
    setSettingsAgent,
    settingsHydrated,
    settingsMediaFolderId,
    setSettingsMediaFolderId,
    settingsMediaItems,
  };
}
