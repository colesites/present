"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_LANGUAGE_OPTIONS } from "../lib/constants";
import { FontFamilySelect } from "../../../renderer/shared/components";
import {
  getFontWeightOptionsForFamily,
  resolveFontWeightForFamily,
  useFontCatalog,
} from "../../../renderer/shared/hooks/useFontCatalog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../renderer/shared/components/ui/select";
import { cn } from "../../../renderer/shared/lib/utils";
import { MediaItem, MediaFolder } from "../../media/hooks/useMediaFolders";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";
import { areDisplayListsEqual } from "../../../renderer/shared/lib/display-list";
import { NativeOutputSurfaceToggle } from "./NativeOutputSurfaceToggle";

type AudioInputOption = {
  deviceId: string;
  label: string;
};

type AudioOutputOption = AudioInputOption;

type ScreenRole = "audience" | "media" | "worship";

const SCREEN_ROLE_OPTIONS: Array<{
  key: ScreenRole;
  label: string;
  description: string;
}> = [
  {
    key: "audience",
    label: "Audience",
    description: "Main output seen by the congregation.",
  },
  {
    key: "media",
    label: "Media",
    description: "Media operator or backstage media display.",
  },
  {
    key: "worship",
    label: "Worship Stage",
    description: "Confidence display for the worship leader.",
  },
];

const SCREEN_RESOLUTION_OPTIONS = [
  "3840x2160",
  "2560x1440",
  "1920x1080",
  "1600x900",
  "1366x768",
  "1280x720",
  "1024x768",
  "800x600",
];

interface SettingsScreenProps {
  settingsLang: string;
  setSettingsLang: (lang: string) => void;
  settingsSpeechInputDeviceId: string | null;
  setSettingsSpeechInputDeviceId: (deviceId: string | null) => void;
  settingsAudioOutputDeviceId: string | null;
  setSettingsAudioOutputDeviceId: (deviceId: string | null) => void;
  settingsAudioOutputDeviceLabel: string;
  setSettingsAudioOutputDeviceLabel: (label: string) => void;
  settingsScriptureFontFamily: string;
  setSettingsScriptureFontFamily: (font: string) => void;
  settingsScriptureFontWeight: string;
  setSettingsScriptureFontWeight: (weight: string) => void;
  settingsScriptureFontSize: number;
  setSettingsScriptureFontSize: (size: number) => void;
  settingsScriptureFooterFontSize: number;
  setSettingsScriptureFooterFontSize: (size: number) => void;
  settingsScriptureTextAlign: ScriptureTextAlign;
  setSettingsScriptureTextAlign: (align: ScriptureTextAlign) => void;
  settingsScriptureVerticalAlign: ScriptureVerticalAlign;
  setSettingsScriptureVerticalAlign: (align: ScriptureVerticalAlign) => void;
  settingsScriptureFooterAlign: ScriptureTextAlign;
  setSettingsScriptureFooterAlign: (align: ScriptureTextAlign) => void;
  settingsScriptureFooterPosition: ScriptureFooterPosition;
  setSettingsScriptureFooterPosition: (
    position: ScriptureFooterPosition
  ) => void;
  settingsLibraryFontSize: number;
  setSettingsLibraryFontSize: (size: number) => void;
  settingsLibraryFontFamily: string;
  setSettingsLibraryFontFamily: (font: string) => void;
  settingsLibraryFontWeight: string;
  setSettingsLibraryFontWeight: (weight: string) => void;
  settingsScriptureBackgroundId: string | null;
  setSettingsScriptureBackgroundId: (id: string | null) => void;
  settingsTimerXPercent: number;
  setSettingsTimerXPercent: (value: number) => void;
  settingsTimerYPercent: number;
  setSettingsTimerYPercent: (value: number) => void;
  settingsTimerClockFontPx: number;
  setSettingsTimerClockFontPx: (value: number) => void;
  settingsTimerNameFontPx: number;
  setSettingsTimerNameFontPx: (value: number) => void;
  settingsTimerNameBannerHeightPx: number;
  setSettingsTimerNameBannerHeightPx: (value: number) => void;
  settingsTimerClockColor: string;
  setSettingsTimerClockColor: (value: string) => void;
  settingsTimerNameColor: string;
  setSettingsTimerNameColor: (value: string) => void;
  settingsTimerNameBannerEnabled: boolean;
  setSettingsTimerNameBannerEnabled: (value: boolean) => void;
  settingsTimerNameBannerColor: string;
  setSettingsTimerNameBannerColor: (value: string) => void;
  settingsTimerTitlePosition: "top" | "bottom";
  setSettingsTimerTitlePosition: (value: "top" | "bottom") => void;
  settingsOutputDisplayId: number | null;
  setSettingsOutputDisplayId: (value: number | null) => void;
  settingsScreenDisplayIds: Record<ScreenRole, number | null>;
  setSettingsScreenDisplayIds: (
    value:
      | Record<ScreenRole, number | null>
      | ((previous: Record<ScreenRole, number | null>) => Record<ScreenRole, number | null>),
  ) => void;
  settingsScreenResolutions: Record<ScreenRole, string>;
  setSettingsScreenResolutions: (
    value:
      | Record<ScreenRole, string>
      | ((previous: Record<ScreenRole, string>) => Record<ScreenRole, string>),
  ) => void;
  settingsNdiEnabled: boolean;
  setSettingsNdiEnabled: (value: boolean) => void;
  settingsNdiSourceName: string;
  setSettingsNdiSourceName: (value: string) => void;
  settingsNdiGroupName: string;
  setSettingsNdiGroupName: (value: string) => void;
  settingsNdiRuntimeStatus: {
    running: boolean;
    sourceName: string;
    groupName: string;
    lastError: string | null;
    libraryLoaded: boolean;
    framesSent: number;
    usingFallbackFrame: boolean;
  };
  settingsMediaFolderId: string;
  setSettingsMediaFolderId: (id: string) => void;
  settingsMediaItems: MediaItem[];
  folders: MediaFolder[];
  allMediaItems: MediaItem[];
  selectMediaForOutput: (item: MediaItem | null) => void;
}

export function SettingsScreen({
  settingsLang,
  setSettingsLang,
  settingsSpeechInputDeviceId,
  setSettingsSpeechInputDeviceId,
  settingsAudioOutputDeviceId,
  setSettingsAudioOutputDeviceId,
  settingsAudioOutputDeviceLabel,
  setSettingsAudioOutputDeviceLabel,
  settingsScriptureFontFamily,
  setSettingsScriptureFontFamily,
  settingsScriptureFontWeight,
  setSettingsScriptureFontWeight,
  settingsScriptureFontSize,
  setSettingsScriptureFontSize,
  settingsScriptureFooterFontSize,
  setSettingsScriptureFooterFontSize,
  settingsLibraryFontSize,
  setSettingsLibraryFontSize,
  settingsLibraryFontFamily,
  setSettingsLibraryFontFamily,
  settingsLibraryFontWeight,
  setSettingsLibraryFontWeight,
  settingsScriptureBackgroundId,
  setSettingsScriptureBackgroundId,
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
  settingsNdiRuntimeStatus,
  settingsMediaFolderId,
  setSettingsMediaFolderId,
  settingsMediaItems,
  folders,
  allMediaItems,
  selectMediaForOutput,
}: SettingsScreenProps) {
  const [activeSection, setActiveSection] = useState<
    "screens" | "speech" | "scripture" | "libraries" | "timer" | "audio" | "connections"
  >("screens");
  const [availableDisplays, setAvailableDisplays] = useState<Display[]>([]);
  const [availableAudioInputs, setAvailableAudioInputs] = useState<AudioInputOption[]>([]);
  const [availableAudioOutputs, setAvailableAudioOutputs] = useState<AudioOutputOption[]>([]);
  const [isLoadingAudioInputs, setIsLoadingAudioInputs] = useState(false);
  const [audioInputsError, setAudioInputsError] = useState<string | null>(null);
  const { faces: fontFaces } = useFontCatalog();
  const scriptureWeightOptions = useMemo(
    () => getFontWeightOptionsForFamily(fontFaces, settingsScriptureFontFamily),
    [fontFaces, settingsScriptureFontFamily]
  );
  const libraryWeightOptions = useMemo(
    () => getFontWeightOptionsForFamily(fontFaces, settingsLibraryFontFamily),
    [fontFaces, settingsLibraryFontFamily]
  );
  const resolvedScriptureFontWeight = useMemo(
    () =>
      resolveFontWeightForFamily(
        fontFaces,
        settingsScriptureFontFamily,
        settingsScriptureFontWeight
      ),
    [fontFaces, settingsScriptureFontFamily, settingsScriptureFontWeight]
  );
  const resolvedLibraryFontWeight = useMemo(
    () =>
      resolveFontWeightForFamily(
        fontFaces,
        settingsLibraryFontFamily,
        settingsLibraryFontWeight
      ),
    [fontFaces, settingsLibraryFontFamily, settingsLibraryFontWeight]
  );
  const normalizedLibraryFontSize = useMemo(
    () => Math.min(Math.max(Math.round(settingsLibraryFontSize), 24), 400),
    [settingsLibraryFontSize]
  );
  const normalizeScriptureFontSizeInput = (value: number) =>
    Math.max(Math.round(value), 12);
  const normalizeScriptureFooterFontSizeInput = (value: number) =>
    Math.max(Math.round(value), 8);
  const [scriptureFontSizeDraft, setScriptureFontSizeDraft] = useState(() =>
    String(normalizeScriptureFontSizeInput(settingsScriptureFontSize))
  );
  const [scriptureFooterFontSizeDraft, setScriptureFooterFontSizeDraft] = useState(
    () => String(normalizeScriptureFooterFontSizeInput(settingsScriptureFooterFontSize))
  );
  const commitScriptureFontSizeDraft = (raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setScriptureFontSizeDraft(
        String(normalizeScriptureFontSizeInput(settingsScriptureFontSize))
      );
      return;
    }
    const normalized = normalizeScriptureFontSizeInput(value);
    setSettingsScriptureFontSize(normalized);
    setScriptureFontSizeDraft(String(normalized));
  };
  const commitScriptureFooterFontSizeDraft = (raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      setScriptureFooterFontSizeDraft(
        String(normalizeScriptureFooterFontSizeInput(settingsScriptureFooterFontSize))
      );
      return;
    }
    const normalized = normalizeScriptureFooterFontSizeInput(value);
    setSettingsScriptureFooterFontSize(normalized);
    setScriptureFooterFontSizeDraft(String(normalized));
  };
  const handleScriptureFontSizeInput = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setScriptureFontSizeDraft(event.target.value);
  };
  const handleLibraryFontSizeInput = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    setSettingsLibraryFontSize(value);
  };
  const handleScriptureFooterFontSizeInput = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setScriptureFooterFontSizeDraft(event.target.value);
  };
  const handleDraftNumberKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  useEffect(() => {
    let mounted = true;

    const refreshDisplays = async () => {
      if (!window.electronAPI?.getDisplays) {
        return;
      }
      try {
        const displays = await window.electronAPI.getDisplays();
        if (!mounted) {
          return;
        }
        setAvailableDisplays((previous) =>
          areDisplayListsEqual(previous, displays) ? previous : displays,
        );
      } catch {
        if (mounted) {
          setAvailableDisplays((previous) =>
            previous.length === 0 ? previous : [],
          );
        }
      }
    };

    void refreshDisplays();
    const intervalId = window.setInterval(() => {
      void refreshDisplays();
    }, 4000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const refreshAudioInputs = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.enumerateDevices
    ) {
      setAvailableAudioInputs([]);
      setAudioInputsError("Audio input selection is unavailable in this runtime.");
      return;
    }

    setIsLoadingAudioInputs(true);
    setAudioInputsError(null);

    try {
      const permissionResult =
        await window.electronAPI?.requestMicrophoneAccess?.();
      if (permissionResult && !permissionResult.granted) {
        setAvailableAudioInputs([]);
        setAudioInputsError("Microphone access was denied.");
        setIsLoadingAudioInputs(false);
        return;
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter(
          (device) =>
            device.kind === "audioinput" &&
            device.deviceId !== "default" &&
            device.deviceId !== "communications",
        )
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label.trim() || `Microphone ${index + 1}`,
        }));
      const audioOutputs = devices
        .filter(
          (device) =>
            device.kind === "audiooutput" &&
            device.deviceId !== "default" &&
            device.deviceId !== "communications",
        )
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label.trim() || `Audio output ${index + 1}`,
        }));
      setAvailableAudioInputs(audioInputs);
      setAvailableAudioOutputs(audioOutputs);
      setAudioInputsError(
        audioInputs.length === 0 ? "No sound input devices were found." : null,
      );
      setIsLoadingAudioInputs(false);
    } catch {
      setAvailableAudioInputs([]);
      setAudioInputsError("Unable to read available sound input devices.");
      setIsLoadingAudioInputs(false);
    }
  }, [activeSection]);

  useEffect(() => {
    const refreshTimeoutId = window.setTimeout(() => {
      void refreshAudioInputs();
    }, 0);

    if (!navigator.mediaDevices?.addEventListener) {
      return () => window.clearTimeout(refreshTimeoutId);
    }

    const handleDeviceChange = () => {
      void refreshAudioInputs();
    };

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      window.clearTimeout(refreshTimeoutId);
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [refreshAudioInputs]);

  useEffect(() => {
    if (!settingsSpeechInputDeviceId) {
      return;
    }

    const selectionStillExists = availableAudioInputs.some(
      (device) => device.deviceId === settingsSpeechInputDeviceId,
    );
    if (!selectionStillExists) {
      setSettingsSpeechInputDeviceId(null);
    }
  }, [
    availableAudioInputs,
    settingsSpeechInputDeviceId,
    setSettingsSpeechInputDeviceId,
  ]);

  const parseDisplaySelectValue = (value: string) =>
    value === "auto"
      ? null
      : Number.isFinite(Number(value))
        ? Number(value)
        : null;

  const handleAudioOutputChange = useCallback(
    async (value: string) => {
      if (value === "__system_default__") {
        setSettingsAudioOutputDeviceId(null);
        setSettingsAudioOutputDeviceLabel("System Default");
        return;
      }

      const requestedDevice = availableAudioOutputs.find(
        (device) => device.deviceId === value,
      );
      const outputSelector = navigator.mediaDevices as MediaDevices & {
        selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
      };

      try {
        const selectedDevice = outputSelector.selectAudioOutput
          ? await outputSelector.selectAudioOutput({ deviceId: value })
          : requestedDevice;
        if (!selectedDevice) return;
        setSettingsAudioOutputDeviceId(selectedDevice.deviceId);
        setSettingsAudioOutputDeviceLabel(
          selectedDevice.label.trim() || requestedDevice?.label || "Audio output",
        );
      } catch {
        // The system device picker was cancelled; retain the active route.
      }
    },
    [
      availableAudioOutputs,
      setSettingsAudioOutputDeviceId,
      setSettingsAudioOutputDeviceLabel,
    ],
  );

  const handleScreenDisplayChange = (role: ScreenRole, value: string) => {
    const nextId = parseDisplaySelectValue(value);
    setSettingsScreenDisplayIds((previous) => ({
      ...previous,
      [role]: nextId,
    }));
    if (role === "audience") {
      setSettingsOutputDisplayId(nextId);
    }
    if (window.electronAPI?.setPreferredDisplay) {
      void window.electronAPI.setPreferredDisplay(role, nextId);
    } else if (role === "audience" && window.electronAPI?.setPreferredOutputDisplay) {
      void window.electronAPI.setPreferredOutputDisplay(nextId);
    }
  };

  const handleOutputDisplayChange = (value: string) => {
    const nextId =
      parseDisplaySelectValue(value);
    setSettingsOutputDisplayId(nextId);
    setSettingsScreenDisplayIds((previous) => ({
      ...previous,
      audience: nextId,
    }));
    if (window.electronAPI?.setPreferredOutputDisplay) {
      void window.electronAPI.setPreferredOutputDisplay(nextId);
    }
    if (window.electronAPI?.setPreferredDisplay) {
      void window.electronAPI.setPreferredDisplay("audience", nextId);
    }
  };

  const getDisplayLabel = (display: Display) =>
    `${display.label || (display.isPrimary ? "Primary Display" : `Screen ${display.id}`)}${display.isPrimary ? " (Primary)" : ""}`;

  const getDisplayResolution = (display: Display) =>
    `${display.bounds.width} x ${display.bounds.height}`;

  const handleScreenResolutionChange = (role: ScreenRole, value: string) => {
    setSettingsScreenResolutions((previous) => ({
      ...previous,
      [role]: value,
    }));
  };

  useEffect(() => {
    if (resolvedScriptureFontWeight !== settingsScriptureFontWeight) {
      setSettingsScriptureFontWeight(resolvedScriptureFontWeight);
    }
  }, [
    resolvedScriptureFontWeight,
    setSettingsScriptureFontWeight,
    settingsScriptureFontWeight,
  ]);

  useEffect(() => {
    if (resolvedLibraryFontWeight !== settingsLibraryFontWeight) {
      setSettingsLibraryFontWeight(resolvedLibraryFontWeight);
    }
  }, [
    resolvedLibraryFontWeight,
    setSettingsLibraryFontWeight,
    settingsLibraryFontWeight,
  ]);

  const previewRef = useRef<HTMLDivElement>(null);
  const timerBoxRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<null | "move">(null);
  const [timerPreviewScale, setTimerPreviewScale] = useState(1);
  const [timerDraft, setTimerDraft] = useState<{
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    nameBannerHeightPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  } | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    timerX: number;
    timerY: number;
  } | null>(null);
  const minClockFont = 12;
  const maxClockFont = 400;
  const minNameFont = 8;
  const maxNameFont = 220;
  const normalizePercent = (value: number) => Number(value.toFixed(2));
  const clampTimerLayout = (layout: { xPercent: number; yPercent: number }) => {
    const xPercent = Math.min(Math.max(layout.xPercent, 0), 100);
    const yPercent = Math.min(Math.max(layout.yPercent, 0), 100);
    return { xPercent, yPercent };
  };
  const updateTimerDraft = (
    patch: Partial<{
      xPercent: number;
      yPercent: number;
      clockFontPx: number;
      nameFontPx: number;
      nameBannerHeightPx: number;
      clockColor: string;
      nameColor: string;
      nameBannerEnabled: boolean;
      nameBannerColor: string;
      titlePosition: "top" | "bottom";
    }>
  ) => {
    setTimerDraft((previous) => ({
      ...(previous ?? {
        xPercent: settingsTimerXPercent,
        yPercent: settingsTimerYPercent,
        clockFontPx: settingsTimerClockFontPx,
        nameFontPx: settingsTimerNameFontPx,
        nameBannerHeightPx: settingsTimerNameBannerHeightPx,
        clockColor: settingsTimerClockColor,
        nameColor: settingsTimerNameColor,
        nameBannerEnabled: settingsTimerNameBannerEnabled,
        nameBannerColor: settingsTimerNameBannerColor,
        titlePosition: settingsTimerTitlePosition,
      }),
      ...patch,
    }));
  };
  const draftTimerXPercent = timerDraft?.xPercent ?? settingsTimerXPercent;
  const draftTimerYPercent = timerDraft?.yPercent ?? settingsTimerYPercent;
  const draftTimerClockFontPx =
    timerDraft?.clockFontPx ?? settingsTimerClockFontPx;
  const draftTimerNameFontPx =
    timerDraft?.nameFontPx ?? settingsTimerNameFontPx;
  const draftTimerNameBannerHeightPx =
    timerDraft?.nameBannerHeightPx ?? settingsTimerNameBannerHeightPx;
  const draftTimerClockColor =
    timerDraft?.clockColor ?? settingsTimerClockColor;
  const draftTimerNameColor = timerDraft?.nameColor ?? settingsTimerNameColor;
  const draftTimerNameBannerEnabled =
    timerDraft?.nameBannerEnabled ?? settingsTimerNameBannerEnabled;
  const draftTimerNameBannerColor =
    timerDraft?.nameBannerColor ?? settingsTimerNameBannerColor;
  const draftTimerTitlePosition =
    timerDraft?.titlePosition ?? settingsTimerTitlePosition;
  const clampedDraftTimer = clampTimerLayout({
    xPercent: draftTimerXPercent,
    yPercent: draftTimerYPercent,
  });
  const clampedDraftTimerX = clampedDraftTimer.xPercent;
  const clampedDraftTimerY = clampedDraftTimer.yPercent;
  const clampedTimer = clampTimerLayout({
    xPercent: settingsTimerXPercent,
    yPercent: settingsTimerYPercent,
  });
  const clampedTimerX = clampedTimer.xPercent;
  const clampedTimerY = clampedTimer.yPercent;
  const timerStyle = useMemo(
    () => ({
      left: `${clampedDraftTimerX}%`,
      top: `${clampedDraftTimerY}%`,
      transform: "translate(-50%, -50%)",
    }),
    [clampedDraftTimerX, clampedDraftTimerY]
  );
  const timerClockFontPx = useMemo(
    () => Math.min(Math.max(draftTimerClockFontPx, minClockFont), maxClockFont),
    [draftTimerClockFontPx]
  );
  const timerTitleFontPx = useMemo(
    () => Math.min(Math.max(draftTimerNameFontPx, minNameFont), maxNameFont),
    [draftTimerNameFontPx]
  );
  const previewTimerClockFontPx = timerClockFontPx * timerPreviewScale;
  const previewTimerTitleFontPx = timerTitleFontPx * timerPreviewScale;
  const previewTimerBannerHeightPx =
    draftTimerNameBannerHeightPx * timerPreviewScale;

  // The audience timer is specified for a 1920 × 1080 output. Scale every
  // pixel-based part of this small editor preview by the same ratio, so its
  // text dimensions and the drag boundaries match the projected output.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;

    const updatePreviewScale = () => {
      const rect = preview.getBoundingClientRect();
      setTimerPreviewScale(
        Math.min(rect.width / 1920, rect.height / 1080) || 1,
      );
    };

    updatePreviewScale();
    const observer = new ResizeObserver(updatePreviewScale);
    observer.observe(preview);
    return () => observer.disconnect();
  }, [activeSection]);
  const hasPendingTimerChanges =
    normalizePercent(clampedDraftTimerX) !== normalizePercent(clampedTimerX) ||
    normalizePercent(clampedDraftTimerY) !== normalizePercent(clampedTimerY) ||
    timerClockFontPx !== settingsTimerClockFontPx ||
    timerTitleFontPx !== settingsTimerNameFontPx ||
    draftTimerNameBannerHeightPx !== settingsTimerNameBannerHeightPx ||
    draftTimerClockColor !== settingsTimerClockColor ||
    draftTimerNameColor !== settingsTimerNameColor ||
    draftTimerNameBannerEnabled !== settingsTimerNameBannerEnabled ||
    draftTimerNameBannerColor !== settingsTimerNameBannerColor ||
    draftTimerTitlePosition !== settingsTimerTitlePosition;

  const startPointerDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    mode: "move"
  ) => {
    if (!previewRef.current) {
      return;
    }
    event.preventDefault();
    previewRef.current.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      timerX: clampedDraftTimerX,
      timerY: clampedDraftTimerY,
    };
    setDragMode(mode);
  };

  const onPreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragMode || !dragStartRef.current || !previewRef.current) {
      return;
    }
    const rect = previewRef.current.getBoundingClientRect();
    const deltaXPct =
      ((event.clientX - dragStartRef.current.x) / rect.width) * 100;
    const deltaYPct =
      ((event.clientY - dragStartRef.current.y) / rect.height) * 100;

    if (dragMode === "move") {
      const timerRect = timerBoxRef.current?.getBoundingClientRect();
      const timerWidthPct = timerRect
        ? (timerRect.width / rect.width) * 100
        : 0;
      const timerHeightPct = timerRect
        ? (timerRect.height / rect.height) * 100
        : 0;
      const halfWidthPct = timerWidthPct / 2;
      const halfHeightPct = timerHeightPct / 2;
      const nextX = Math.min(
        Math.max(dragStartRef.current.timerX + deltaXPct, halfWidthPct),
        Math.max(100 - halfWidthPct, halfWidthPct)
      );
      const nextY = Math.min(
        Math.max(dragStartRef.current.timerY + deltaYPct, halfHeightPct),
        Math.max(100 - halfHeightPct, halfHeightPct)
      );
      updateTimerDraft({ xPercent: nextX, yPercent: nextY });
    }
  };

  const stopPointerDrag = () => {
    dragStartRef.current = null;
    setDragMode(null);
  };

  const getTimerSizePercent = () => {
    if (!previewRef.current || !timerBoxRef.current) {
      return { widthPct: 0, heightPct: 0 };
    }
    const previewRect = previewRef.current.getBoundingClientRect();
    const timerRect = timerBoxRef.current.getBoundingClientRect();
    if (previewRect.width === 0 || previewRect.height === 0) {
      return { widthPct: 0, heightPct: 0 };
    }
    return {
      widthPct: (timerRect.width / previewRect.width) * 100,
      heightPct: (timerRect.height / previewRect.height) * 100,
    };
  };

  const getTimerHalfSizePercent = () => {
    const { widthPct, heightPct } = getTimerSizePercent();
    return {
      halfWidthPct: widthPct / 2,
      halfHeightPct: heightPct / 2,
    };
  };

  const applyTimerLayout = () => {
    const { halfWidthPct, halfHeightPct } = getTimerHalfSizePercent();
    const nextX = Math.min(
      Math.max(clampedDraftTimerX, halfWidthPct),
      Math.max(100 - halfWidthPct, halfWidthPct)
    );
    const nextY = Math.min(
      Math.max(clampedDraftTimerY, halfHeightPct),
      Math.max(100 - halfHeightPct, halfHeightPct)
    );
    setSettingsTimerXPercent(nextX);
    setSettingsTimerYPercent(nextY);
    setSettingsTimerClockFontPx(timerClockFontPx);
    setSettingsTimerNameFontPx(timerTitleFontPx);
    setSettingsTimerNameBannerHeightPx(draftTimerNameBannerHeightPx);
    setSettingsTimerClockColor(draftTimerClockColor);
    setSettingsTimerNameColor(draftTimerNameColor);
    setSettingsTimerNameBannerEnabled(draftTimerNameBannerEnabled);
    setSettingsTimerNameBannerColor(draftTimerNameBannerColor);
    setSettingsTimerTitlePosition(draftTimerTitlePosition);
    setTimerDraft(null);
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex h-full w-64 shrink-0 flex-col gap-4 border-r border-border bg-card px-4 py-5">
        <div>
          <h1 className="text-sm font-semibold">Settings</h1>
          <p className="text-[11px] text-muted-foreground">
            Configure Present for your context
          </p>
        </div>

        <nav className="space-y-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveSection("screens")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "screens"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Screens
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("speech")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "speech"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Speech to Search
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("scripture")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "scripture"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Scripture
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("libraries")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "libraries"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Libraries
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("timer")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "timer"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Timer Layout
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("audio")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "audio"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Video &amp; Audio
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("connections")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "connections"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Connections
          </button>
        </nav>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-card px-6 py-3">
          <h2 className="text-sm font-semibold">
            {activeSection === "speech"
              ? "Speech to Search"
              : activeSection === "screens"
                ? "Screens"
              : activeSection === "scripture"
                ? "Scripture"
              : activeSection === "libraries"
                ? "Libraries"
                : activeSection === "timer"
                  ? "Timer Layout"
                  : activeSection === "audio"
                    ? "Video & Audio"
                    : "Connections"}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {activeSection === "speech"
              ? "Choose the language and microphone used for voice search across the app."
              : activeSection === "screens"
                ? "Route each output to a detected monitor and verify resolution."
              : activeSection === "scripture"
                ? "Set the default scripture presentation appearance."
              : activeSection === "libraries"
                ? "Set default typography used when creating new library slides."
                : activeSection === "timer"
                  ? "Drag timer position and customize timer/name style for output screens."
                  : activeSection === "audio"
                    ? "Choose where video sound plays and manage video playback behavior."
                    : "Manage projection routing and NDI streaming preferences."}
          </p>
        </div>

        <div className="flex flex-1 flex-col space-y-6 overflow-y-auto px-6 py-4">
          {activeSection === "screens" ? (
            <section className="space-y-5">
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Detected screens
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Present reads the monitor names reported by the operating system.
                    </p>
                  </div>
                  <span className="rounded-full border border-border bg-muted/35 px-2 py-1 text-[10px] font-medium text-muted-foreground">
                    {availableDisplays.length} found
                  </span>
                </div>

                <div className="grid gap-2 lg:grid-cols-2">
                  {availableDisplays.length > 0 ? (
                    availableDisplays.map((display) => (
                      <div
                        key={display.id}
                        className="rounded-md border border-border bg-card/70 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {getDisplayLabel(display)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              ID {display.id} · {getDisplayResolution(display)} · scale {display.scaleFactor}x
                            </p>
                          </div>
                          <div className="h-8 w-12 shrink-0 rounded-sm border border-border bg-black shadow-inner" />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
                      No screens are available yet. Connect displays and keep this settings page open.
                    </div>
                  )}
                </div>
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-amber-100">
                  HDMI splitters and mirrored hubs usually appear as one display
                  because macOS only receives one EDID/source. Present can route
                  separate audience, media, and worship outputs only to displays
                  the operating system exposes independently. Use separate GPU
                  outputs, a true multi-display adapter, DisplayLink hardware, or
                  receiver-based outputs when each TV needs different content.
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Output routing
                </h3>
                <div className="grid gap-3 xl:grid-cols-3">
                  {SCREEN_ROLE_OPTIONS.map((role) => {
                    const selectedDisplayId = settingsScreenDisplayIds[role.key];
                    const selectedDisplay = availableDisplays.find(
                      (display) => display.id === selectedDisplayId,
                    );
                    return (
                      <div
                        key={role.key}
                        className="rounded-md border border-border bg-card/70 p-3"
                      >
                        <div className="mb-3">
                          <p className="text-sm font-semibold text-foreground">
                            {role.label}
                          </p>
                          <p className="mt-0.5 min-h-8 text-[11px] leading-4 text-muted-foreground">
                            {role.description}
                          </p>
                        </div>
                        <Select
                          value={
                            selectedDisplayId === null
                              ? "auto"
                              : String(selectedDisplayId)
                          }
                          onValueChange={(value) =>
                            handleScreenDisplayChange(role.key, value)
                          }
                        >
                          <SelectTrigger className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                            <SelectValue placeholder="Select screen" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">
                              Auto (largest external)
                            </SelectItem>
                            {availableDisplays.map((display) => (
                              <SelectItem key={display.id} value={String(display.id)}>
                                {getDisplayLabel(display)} · {getDisplayResolution(display)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          {selectedDisplay
                            ? `${getDisplayResolution(selectedDisplay)} on ${getDisplayLabel(selectedDisplay)}`
                            : "Auto chooses the largest external screen when available."}
                        </p>
                        <div className="mt-3 space-y-1">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Resolution
                          </span>
                          <Select
                            value={settingsScreenResolutions[role.key]}
                            onValueChange={(value) =>
                              handleScreenResolutionChange(role.key, value)
                            }
                          >
                            <SelectTrigger className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                              <SelectValue placeholder="Select resolution" />
                            </SelectTrigger>
                            <SelectContent>
                              {SCREEN_RESOLUTION_OPTIONS.map((resolution) => (
                                <SelectItem key={resolution} value={resolution}>
                                  {resolution.replace("x", " x ")}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </section>
          ) : activeSection === "speech" ? (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Voice language
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Choose the language or accent voice search should expect when
                  identifying scripture and library queries.
                </p>
                <div className="mt-2 max-w-xs">
                  <Select value={settingsLang} onValueChange={setSettingsLang}>
                    <SelectTrigger className="w-full border border-input bg-background px-3 py-2 text-sm text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SETTINGS_LANGUAGE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sound input
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Pick the microphone voice search should listen to.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshAudioInputs()}
                    className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition hover:bg-muted"
                  >
                    Refresh
                  </button>
                </div>
                <div className="mt-2 max-w-lg space-y-2">
                  <Select
                    value={settingsSpeechInputDeviceId ?? "__default__"}
                    onValueChange={(value) =>
                      setSettingsSpeechInputDeviceId(
                        value === "__default__" ? null : value,
                      )
                    }
                  >
                    <SelectTrigger className="w-full border border-input bg-background px-3 py-2 text-sm text-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        System default microphone
                      </SelectItem>
                      {availableAudioInputs.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    {isLoadingAudioInputs
                      ? "Refreshing available sound inputs..."
                      : audioInputsError
                        ? audioInputsError
                        : `${availableAudioInputs.length} sound input(s) available.`}
                  </p>
                </div>
              </section>
            </>
          ) : activeSection === "scripture" ? (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Typography
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Set the default scripture typography used for new scripture
                  slides. Manual edits in the editor remain unchanged.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      Font family
                    </span>
                    <FontFamilySelect
                      value={settingsScriptureFontFamily}
                      onChange={setSettingsScriptureFontFamily}
                      className="h-9 w-full rounded-md border-border bg-muted/45 px-3 text-[12px] font-medium"
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        Font weight
                      </span>
                      <Select
                        value={resolvedScriptureFontWeight}
                        onValueChange={setSettingsScriptureFontWeight}
                      >
                        <SelectTrigger className="h-9 rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                          <SelectValue placeholder="Select weight" />
                        </SelectTrigger>
                        <SelectContent>
                          {(scriptureWeightOptions.length > 0
                            ? scriptureWeightOptions
                            : [
                                {
                                  value: resolvedScriptureFontWeight,
                                  label: resolvedScriptureFontWeight,
                                },
                              ]
                          ).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        Font size
                      </span>
                      <input
                        aria-label="Scripture font size"
                        type="number"
                        value={scriptureFontSizeDraft}
                        onChange={handleScriptureFontSizeInput}
                        onBlur={(event) =>
                          commitScriptureFontSizeDraft(event.target.value)
                        }
                        onKeyDown={handleDraftNumberKeyDown}
                        min={12}
                        step={1}
                        className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-center text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      />
                    </div>
                  </div>
                  <div className="max-w-[6rem] space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      Footer size
                    </span>
                    <input
                      aria-label="Scripture footer font size"
                      type="number"
                      value={scriptureFooterFontSizeDraft}
                      onChange={handleScriptureFooterFontSizeInput}
                      onBlur={(event) =>
                        commitScriptureFooterFontSizeDraft(event.target.value)
                      }
                      onKeyDown={handleDraftNumberKeyDown}
                      min={8}
                      step={1}
                      className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-center text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                    />
                  </div>
                </div>
              </section>
            </>
          ) : activeSection === "libraries" ? (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Default typography
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  New library items and generated lyric slides will start with
                  this typography. Manual changes in the editor stay untouched.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <span className="text-[11px] text-muted-foreground">
                      Font family
                    </span>
                    <FontFamilySelect
                      value={settingsLibraryFontFamily}
                      onChange={setSettingsLibraryFontFamily}
                      className="h-9 w-full rounded-md border-border bg-muted/45 px-3 text-[12px] font-medium"
                    />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        Font weight
                      </span>
                      <Select
                        value={resolvedLibraryFontWeight}
                        onValueChange={setSettingsLibraryFontWeight}
                      >
                        <SelectTrigger className="h-9 rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                          <SelectValue placeholder="Select weight" />
                        </SelectTrigger>
                        <SelectContent>
                          {(libraryWeightOptions.length > 0
                            ? libraryWeightOptions
                            : [
                                {
                                  value: resolvedLibraryFontWeight,
                                  label: resolvedLibraryFontWeight,
                                },
                              ]
                          ).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        Font size
                      </span>
                      <input
                        aria-label="Library font size"
                        type="number"
                        value={normalizedLibraryFontSize}
                        onChange={handleLibraryFontSizeInput}
                        min={24}
                        max={400}
                        step={1}
                        className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-center text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      />
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : activeSection === "timer" ? (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Output timer layout
              </h3>
              <div
                ref={previewRef}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={stopPointerDrag}
                onPointerCancel={stopPointerDrag}
                className="relative aspect-video w-full max-w-xl overflow-hidden rounded-sm border border-border/60 bg-black"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/35 to-black/55" />
                {draftTimerNameBannerEnabled ? (
                  <div
                    style={{
                      backgroundColor: draftTimerNameBannerColor,
                      color: draftTimerNameColor,
                      fontSize: `${previewTimerTitleFontPx}px`,
                      height: `${previewTimerBannerHeightPx}px`,
                    }}
                    className="absolute inset-x-0 top-0 z-20 flex items-center justify-center text-center font-medium uppercase tracking-wider"
                  >
                    Timer Name
                  </div>
                ) : null}
                <div
                  ref={timerBoxRef}
                  onPointerDown={(event) => startPointerDrag(event, "move")}
                  className="absolute z-20 box-border rounded-md bg-black/65 text-center font-semibold tracking-wide text-white outline outline-1 outline-primary/60 shadow-lg select-none cursor-move"
                  style={{
                    ...timerStyle,
                    padding: `${8 * timerPreviewScale}px ${16 * timerPreviewScale}px`,
                  }}
                >
                  {!draftTimerNameBannerEnabled &&
                  draftTimerTitlePosition === "top" ? (
                    <div
                      style={{
                        fontSize: `${previewTimerTitleFontPx}px`,
                        color: draftTimerNameColor,
                      }}
                      className="whitespace-nowrap overflow-hidden text-ellipsis font-medium uppercase tracking-wider"
                    >
                      Timer Name
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: `${previewTimerClockFontPx}px`,
                      color: draftTimerClockColor,
                    }}
                    className="whitespace-nowrap leading-none"
                  >
                    00:00:00
                  </div>
                  {!draftTimerNameBannerEnabled &&
                  draftTimerTitlePosition === "bottom" ? (
                    <div
                      style={{
                        fontSize: `${previewTimerTitleFontPx}px`,
                        color: draftTimerNameColor,
                      }}
                      className="whitespace-nowrap overflow-hidden text-ellipsis font-medium uppercase tracking-wider"
                    >
                      Timer Name
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Horizontal</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={clampedDraftTimerX}
                    onChange={(event) =>
                      updateTimerDraft({ xPercent: Number(event.target.value) })
                    }
                    className="w-full accent-primary"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Vertical</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={clampedDraftTimerY}
                    onChange={(event) =>
                      updateTimerDraft({ yPercent: Number(event.target.value) })
                    }
                    className="w-full accent-primary"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Timer font size</span>
                  <input
                    type="range"
                    min={minClockFont}
                    max={maxClockFont}
                    value={timerClockFontPx}
                    onChange={(event) =>
                      updateTimerDraft({
                        clockFontPx: Number(event.target.value),
                      })
                    }
                    className="w-full accent-primary"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Banner text size</span>
                  <select
                    value={timerTitleFontPx}
                    onChange={(event) =>
                      updateTimerDraft({ nameFontPx: Number(event.target.value) })
                    }
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
                  >
                    {[12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64].map((size) => (
                      <option key={size} value={size}>{size} px</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Banner height</span>
                  <select
                    value={draftTimerNameBannerHeightPx}
                    onChange={(event) =>
                      updateTimerDraft({ nameBannerHeightPx: Number(event.target.value) })
                    }
                    className="h-8 w-full rounded border border-border bg-background px-2 text-xs text-foreground"
                  >
                    {[36, 48, 64, 80, 96, 120, 160].map((height) => (
                      <option key={height} value={height}>{height} px</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Alignment
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const { halfWidthPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ xPercent: halfWidthPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Left
                </button>
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ xPercent: 50 })}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Center
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { halfWidthPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ xPercent: 100 - halfWidthPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Right
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { halfHeightPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ yPercent: halfHeightPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Top
                </button>
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ yPercent: 50 })}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Middle
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { halfHeightPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ yPercent: 100 - halfHeightPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Bottom
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Timer color</span>
                  <input
                    type="color"
                    value={draftTimerClockColor}
                    onChange={(event) =>
                      updateTimerDraft({ clockColor: event.target.value })
                    }
                    className="h-8 w-full rounded border border-border bg-transparent"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Name color</span>
                  <input
                    type="color"
                    value={draftTimerNameColor}
                    onChange={(event) =>
                      updateTimerDraft({ nameColor: event.target.value })
                    }
                    className="h-8 w-full rounded border border-border bg-transparent"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draftTimerNameBannerEnabled}
                  onChange={(event) =>
                    updateTimerDraft({
                      nameBannerEnabled: event.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                Name as top banner
              </label>
              {draftTimerNameBannerEnabled ? (
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Banner background</span>
                  <input
                    type="color"
                    value={draftTimerNameBannerColor}
                    onChange={(event) =>
                      updateTimerDraft({ nameBannerColor: event.target.value })
                    }
                    className="h-8 w-full rounded border border-border bg-transparent"
                  />
                </label>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ titlePosition: "top" })}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition",
                    draftTimerTitlePosition === "top"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  Title top
                </button>
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ titlePosition: "bottom" })}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition",
                    draftTimerTitlePosition === "bottom"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  Title bottom
                </button>
              </div>
              <button
                type="button"
                onClick={applyTimerLayout}
                disabled={!hasPendingTimerChanges}
                className={cn(
                  "rounded-md px-3 py-2 text-xs font-semibold transition",
                  hasPendingTimerChanges
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground"
                )}
              >
                Update timer layout
              </button>
            </section>
          ) : activeSection === "audio" ? (
            <section className="space-y-4">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Audio output
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Video sound plays once through the presenter audio engine, even when no projector is open.
                </p>
                <div className="max-w-sm">
                  <Select
                    value={settingsAudioOutputDeviceId ?? "__system_default__"}
                    onValueChange={(value) => void handleAudioOutputChange(value)}
                  >
                    <SelectTrigger className="h-9 rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                      <SelectValue placeholder="Select audio output" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__system_default__">System Default</SelectItem>
                      {availableAudioOutputs.map((device) => (
                        <SelectItem key={device.deviceId} value={device.deviceId}>
                          {device.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Current selection: {settingsAudioOutputDeviceLabel}
                </p>
              </section>
            </section>
          ) : (
            <section className="space-y-4">
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Output routing
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Choose where the main output should project. Select Auto to
                  keep the current smart external-display fallback.
                </p>
                <div className="max-w-sm">
                  <Select
                    value={
                      settingsOutputDisplayId === null
                        ? "auto"
                        : String(settingsOutputDisplayId)
                    }
                    onValueChange={handleOutputDisplayChange}
                  >
                    <SelectTrigger className="h-9 rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                      <SelectValue placeholder="Select output display" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto (largest external)
                      </SelectItem>
                      {availableDisplays.map((display) => (
                        <SelectItem key={display.id} value={String(display.id)}>
                          {display.isPrimary
                            ? `Primary (${display.bounds.width}x${display.bounds.height})`
                            : `${display.label?.trim() || `Display ${display.id}`} (${display.bounds.width}x${display.bounds.height})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </section>

              <NativeOutputSurfaceToggle />

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  NDI output
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Configure NDI source metadata used by the Media Stage screen
                  and livestream routing.
                </p>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={settingsNdiEnabled}
                    onChange={(event) =>
                      setSettingsNdiEnabled(event.target.checked)
                    }
                    className="accent-primary"
                  />
                  Enable NDI source
                </label>
                <div className="grid max-w-2xl gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-[11px] text-muted-foreground">
                    <span>Source name</span>
                    <input
                      type="text"
                      value={settingsNdiSourceName}
                      onChange={(event) =>
                        setSettingsNdiSourceName(event.target.value)
                      }
                      className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      placeholder="Present Main Output"
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-muted-foreground">
                    <span>NDI group</span>
                    <input
                      type="text"
                      value={settingsNdiGroupName}
                      onChange={(event) =>
                        setSettingsNdiGroupName(event.target.value)
                      }
                      className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                      placeholder="Public"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Status:{" "}
                  <span
                    className={cn(
                      "font-medium",
                      settingsNdiRuntimeStatus.running
                        ? "text-emerald-500"
                        : "text-muted-foreground"
                    )}
                  >
                    {settingsNdiRuntimeStatus.running ? "running" : "stopped"}
                  </span>
                  {" · "}
                  Source: {settingsNdiRuntimeStatus.sourceName}
                  {" · "}
                  Frames: {settingsNdiRuntimeStatus.framesSent}
                </p>
                {settingsNdiRuntimeStatus.lastError ? (
                  <p className="text-[11px] text-red-500">
                    NDI error: {settingsNdiRuntimeStatus.lastError}
                  </p>
                ) : null}
                {!settingsNdiRuntimeStatus.libraryLoaded ? (
                  <p className="text-[11px] text-red-500">
                    NDI native module is unavailable. Install dependencies and
                    restart the app.
                  </p>
                ) : null}
              </section>
            </section>
          )}

          {activeSection === "scripture" ? (
            <section className="flex flex-1 flex-col space-y-2 min-h-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scripture background
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Choose a media file to display behind scripture passages.
              </p>
              {allMediaItems.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Add media in the Media tab to pick a background.
                </p>
              ) : (
                <div className="mt-3 flex flex-1 flex-col space-y-3 min-h-0">
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSettingsScriptureBackgroundId(null)}
                      className={
                        settingsScriptureBackgroundId === null
                          ? "rounded-md border border-primary bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                          : "rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                      }
                    >
                      Use current media
                    </button>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      Background override media
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col space-y-2 min-h-0">
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted-foreground">
                        Folder
                      </span>
                      <Select
                        value={settingsMediaFolderId}
                        onValueChange={setSettingsMediaFolderId}
                      >
                        <SelectTrigger className="h-7 rounded-md border border-input bg-background px-2 text-[11px] text-foreground">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All folders</SelectItem>
                          {folders.map((folder) => (
                            <SelectItem key={folder.id} value={folder.id}>
                              {folder.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                      <div className="grid grid-cols-6 gap-1.5">
                        {settingsMediaItems.map((item) => {
                          const isActive =
                            settingsScriptureBackgroundId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSettingsScriptureBackgroundId(item.id);
                                selectMediaForOutput(item);
                              }}
                              className={
                                (isActive
                                  ? "border-primary ring-1 ring-primary "
                                  : "border-border hover:border-primary ") +
                                "relative aspect-video overflow-hidden rounded-md border bg-black"
                              }
                            >
                              {item.type === "image" ? (
                                <img
                                  src={item.url}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <video
                                  aria-label={`${item.name} preview`}
                                  src={item.url}
                                  className="h-full w-full object-cover"
                                  muted
                                  preload="none"
                                  playsInline
                                  onMouseEnter={(e) => {
                                    const playPromise = e.currentTarget.play();
                                    if (playPromise && typeof playPromise.catch === "function") {
                                      playPromise.catch((): void => undefined);
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    try {
                                      e.currentTarget.pause();
                                      e.currentTarget.currentTime = 0;
                                    } catch {
                                      // Ignore media reset errors.
                                    }
                                  }}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
