"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { AudioLines, Cable, Monitor, Sparkles, Timer, Type } from "lucide-react";
import type { AgentSettings as AgentSettingsValue } from "../lib/constants";
import { cn } from "../../../renderer/shared/lib/utils";
import { MediaItem, MediaFolder } from "../../media/hooks/useMediaFolders";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";
import { NDI_FRAME_RATES } from "../../../renderer/shared/hooks/useAppSettings";
import { AgentSettings } from "./AgentSettings";
import { AudioSettings } from "./AudioSettings";
import { ControlSurfacesSettings } from "./ControlSurfacesSettings";
import { PhoneRemoteSettings } from "./PhoneRemoteSettings";
import { ScreensSettings, type ScreenRole } from "./ScreensSettings";
import { SlidesSettings } from "./SlidesSettings";
import { TimerSettings } from "./TimerSettings";
import { DEFAULT_TIME_UP, type TimeUpSettings } from "../../../renderer/shared/hooks/useTimers";
import type { AudioDevice, AudioDevices } from "../../../renderer/tauri/sound";
import {
  SETTINGS_FIELD,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsStatus,
  SettingsSwitch,
} from "./settings-ui";

type SectionKey = "screens" | "audio" | "agent" | "slides" | "timer" | "connections";

/** What NDI can be sent at. */
const NDI_SIZES = ["3840x2160", "2560x1440", "1920x1080", "1600x900", "1280x720", "1024x768", "800x600"];

const SECTIONS: Array<{
  key: SectionKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
  tile: string;
}> = [
  { key: "screens", label: "Screens", icon: Monitor, tile: "bg-sky-500" },
  { key: "audio", label: "Audio", icon: AudioLines, tile: "bg-rose-500" },
  { key: "agent", label: "Agent", icon: Sparkles, tile: "bg-violet-500" },
  { key: "slides", label: "Slides", icon: Type, tile: "bg-amber-500" },
  { key: "timer", label: "Timer", icon: Timer, tile: "bg-emerald-500" },
  { key: "connections", label: "Connections", icon: Cable, tile: "bg-slate-500" },
];

/** Which page was open last, so Settings opens where it was left. */
const SECTION_KEY = "present-settings-section";

const readSection = (): SectionKey => {
  try {
    const stored = window.localStorage.getItem(SECTION_KEY);
    return SECTIONS.some((section) => section.key === stored) ? (stored as SectionKey) : "screens";
  } catch {
    return "screens";
  }
};

/**
 * The microphones and outputs this computer has, as the system lists them
 * (`services/sound`). Not the webview's list: WebKit shows no devices at all
 * until a page has opened the microphone, and names none of them, which left
 * Settings with nothing to choose from.
 *
 * Looked at again every few seconds while Settings is open, so a device
 * plugged in appears.
 */
function useAudioDevices() {
  const [devices, setDevices] = useState<AudioDevices>({ outputs: [], inputs: [] });
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** The list has been read at least once. */
  const [read, setRead] = useState(false);

  const look = useCallback(async (shown: boolean) => {
    if (shown) setLoading(true);
    try {
      const { listAudioDevices } = await import("../../../renderer/tauri/sound");
      const next = await listAudioDevices();
      setDevices((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
      setRead(true);
      setProblem(next.outputs.length === 0 ? "This computer has no audio outputs." : null);
    } catch (error) {
      console.error("[Settings] could not list the audio devices", error);
      setProblem("Unable to read the audio devices on this computer.");
    } finally {
      if (shown) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout((): void => void look(true), 0);
    const intervalId = window.setInterval((): void => void look(false), 3000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [look]);

  return {
    inputs: devices.inputs,
    outputs: devices.outputs,
    loading,
    problem,
    read,
    refresh: () => look(true),
  };
}

/** Text that is saved when it is left, not on every key. */
function SettingsText({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      aria-label={label}
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(event) => {
        if (event.currentTarget.value !== value) onChange(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={cn(SETTINGS_FIELD, "w-[240px]")}
    />
  );
}

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
  settingsTimerShowName?: boolean;
  setSettingsTimerShowName?: (value: boolean) => void;
  settingsTimerNameBannerColor: string;
  setSettingsTimerNameBannerColor: (value: string) => void;
  settingsTimerTitlePosition: "top" | "bottom";
  setSettingsTimerTitlePosition: (value: "top" | "bottom") => void;
  settingsTimerBoxColor?: string;
  setSettingsTimerBoxColor: (value: string) => void;
  settingsTimerTimeUp?: TimeUpSettings;
  setSettingsTimerTimeUp: (value: TimeUpSettings) => void;
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
  settingsNdiFrameRate: number;
  setSettingsNdiFrameRate: (rate: number) => void;
  setSettingsNdiGroupName: (value: string) => void;
  settingsAgent: AgentSettingsValue;
  setSettingsAgent: (patch: Partial<AgentSettingsValue>) => void;
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
  settingsTimerShowName = true,
  setSettingsTimerShowName,
  settingsTimerNameBannerColor,
  setSettingsTimerNameBannerColor,
  settingsTimerTitlePosition,
  setSettingsTimerTitlePosition,
  settingsTimerBoxColor = "",
  setSettingsTimerBoxColor,
  settingsTimerTimeUp = DEFAULT_TIME_UP,
  setSettingsTimerTimeUp,
  setSettingsOutputDisplayId,
  setSettingsScreenDisplayIds,
  settingsScreenResolutions,
  setSettingsScreenResolutions,
  settingsNdiEnabled,
  setSettingsNdiEnabled,
  settingsNdiSourceName,
  setSettingsNdiSourceName,
  settingsNdiGroupName,
  settingsNdiFrameRate,
  setSettingsNdiFrameRate,
  setSettingsNdiGroupName,
  settingsNdiRuntimeStatus,
  settingsAgent,
  setSettingsAgent,
  allMediaItems,
  selectMediaForOutput,
}: SettingsScreenProps) {
  const [section, setSection] = useState<SectionKey>(readSection);
  // Screens ▸ Configure Screens… in the menu, with Settings already open.
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("settings:section", ({ payload }) => {
          if (SECTIONS.some((each) => each.key === payload)) setSection(payload as SectionKey);
        }),
      )
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
  const choose = (next: SectionKey) => {
    setSection(next);
    try {
      window.localStorage.setItem(SECTION_KEY, next);
    } catch {
      // Opens on the first page next time, which is fine.
    }
  };

  const audio = useAudioDevices();

  // A device chosen before 0.4.11 was saved by the webview's id, which the
  // system does not know. The name is the same in both, so it is found by
  // its name and saved by the system's id.
  useEffect(() => {
    if (!audio.read) return;
    if (
      settingsAudioOutputDeviceId &&
      !audio.outputs.some((device) => device.id === settingsAudioOutputDeviceId)
    ) {
      const same = audio.outputs.find((device) => device.label === settingsAudioOutputDeviceLabel.trim());
      if (same) setSettingsAudioOutputDeviceId(same.id);
    }
  }, [
    audio.outputs,
    audio.read,
    settingsAudioOutputDeviceId,
    settingsAudioOutputDeviceLabel,
    setSettingsAudioOutputDeviceId,
  ]);

  const handleAudioOutputChange = useCallback(
    (device: AudioDevice | null) => {
      setSettingsAudioOutputDeviceId(device?.id ?? null);
      setSettingsAudioOutputDeviceLabel(device?.label ?? "System Default");
    },
    [setSettingsAudioOutputDeviceId, setSettingsAudioOutputDeviceLabel],
  );

  const handleScreenDisplayChange = (role: ScreenRole, displayId: number | null) => {
    setSettingsScreenDisplayIds((previous) => ({ ...previous, [role]: displayId }));
    if (role === "audience") {
      setSettingsOutputDisplayId(displayId);
    }
    if (window.electronAPI?.setPreferredDisplay) {
      // A screen that is on moves to its new place now, not the next time it
      // is turned on.
      void window.electronAPI
        .setPreferredDisplay(role, displayId)
        .then(() => import("@tauri-apps/api/core"))
        .then(({ invoke }) => invoke("reconcile_displays"))
        .catch((error: unknown) => console.error("[Settings] could not move the screen", error));
    } else if (role === "audience" && window.electronAPI?.setPreferredOutputDisplay) {
      void window.electronAPI.setPreferredOutputDisplay(displayId);
    }
  };

  const page = (() => {
    switch (section) {
      case "screens":
        return (
          <ScreensSettings onScreenDisplayChange={handleScreenDisplayChange} />
        );
      case "audio":
        return (
          <AudioSettings
            outputs={audio.outputs}
            inputs={audio.inputs}
            loading={audio.loading}
            problem={audio.problem}
            onRefresh={() => void audio.refresh()}
            outputDeviceId={settingsAudioOutputDeviceId}
            outputDeviceLabel={settingsAudioOutputDeviceLabel}
            onOutputChange={handleAudioOutputChange}
            inputDeviceId={settingsSpeechInputDeviceId}
            onInputChange={(device) => setSettingsSpeechInputDeviceId(device?.id ?? null)}
          />
        );
      case "agent":
        return (
          <AgentSettings
            lang={settingsLang}
            onLangChange={setSettingsLang}
            microphoneLabel={
              audio.inputs.find((device) => device.id === settingsSpeechInputDeviceId)?.label ??
              "System default"
            }
            onChooseMicrophone={() => choose("audio")}
            agent={settingsAgent}
            onAgentChange={setSettingsAgent}
          />
        );
      case "slides":
        return (
          <SlidesSettings
            libraryFontFamily={settingsLibraryFontFamily}
            onLibraryFontFamilyChange={setSettingsLibraryFontFamily}
            libraryFontWeight={settingsLibraryFontWeight}
            onLibraryFontWeightChange={setSettingsLibraryFontWeight}
            libraryFontSize={Math.min(Math.max(Math.round(settingsLibraryFontSize), 24), 400)}
            onLibraryFontSizeChange={setSettingsLibraryFontSize}
            scriptureFontFamily={settingsScriptureFontFamily}
            onScriptureFontFamilyChange={setSettingsScriptureFontFamily}
            scriptureFontWeight={settingsScriptureFontWeight}
            onScriptureFontWeightChange={setSettingsScriptureFontWeight}
            scriptureFontSize={Math.max(Math.round(settingsScriptureFontSize), 12)}
            onScriptureFontSizeChange={setSettingsScriptureFontSize}
            scriptureFooterFontSize={Math.max(Math.round(settingsScriptureFooterFontSize), 8)}
            onScriptureFooterFontSizeChange={setSettingsScriptureFooterFontSize}
            scriptureBackgroundId={settingsScriptureBackgroundId}
            onScriptureBackgroundChange={(item) => {
              setSettingsScriptureBackgroundId(item?.id ?? null);
              if (item) selectMediaForOutput(item);
            }}
            allMediaItems={allMediaItems}
          />
        );
      case "timer":
        return (
          <TimerSettings
            layout={{
              xPercent: settingsTimerXPercent,
              yPercent: settingsTimerYPercent,
              clockFontPx: settingsTimerClockFontPx,
              nameFontPx: settingsTimerNameFontPx,
              nameBannerHeightPx: settingsTimerNameBannerHeightPx,
              clockColor: settingsTimerClockColor,
              nameColor: settingsTimerNameColor,
              nameBannerEnabled: settingsTimerNameBannerEnabled,
              showName: settingsTimerShowName,
              nameBannerColor: settingsTimerNameBannerColor,
              titlePosition: settingsTimerTitlePosition,
              boxColor: settingsTimerBoxColor,
              timeUp: settingsTimerTimeUp,
            }}
            onApply={(layout) => {
              setSettingsTimerXPercent(layout.xPercent);
              setSettingsTimerYPercent(layout.yPercent);
              setSettingsTimerClockFontPx(layout.clockFontPx);
              setSettingsTimerNameFontPx(layout.nameFontPx);
              setSettingsTimerNameBannerHeightPx(layout.nameBannerHeightPx);
              setSettingsTimerClockColor(layout.clockColor);
              setSettingsTimerNameColor(layout.nameColor);
              setSettingsTimerNameBannerEnabled(layout.nameBannerEnabled);
              setSettingsTimerShowName?.(layout.showName);
              setSettingsTimerNameBannerColor(layout.nameBannerColor);
              setSettingsTimerTitlePosition(layout.titlePosition);
              setSettingsTimerBoxColor(layout.boxColor);
              setSettingsTimerTimeUp(layout.timeUp);
            }}
          />
        );
      case "connections":
        return (
          <SettingsPage
            title="Connections"
            description="A phone, a pedal, a lighting desk or a vision mixer, working with Present."
          >
            <PhoneRemoteSettings />
            <ControlSurfacesSettings />
            <SettingsGroup
              title="NDI"
              description="Send the audience picture over the network, to a vision mixer or streaming software."
            >
              <SettingsRow
                label="NDI output"
                description={
                  settingsNdiRuntimeStatus.running
                    ? `Sending as ${settingsNdiRuntimeStatus.sourceName}. ${settingsNdiRuntimeStatus.framesSent.toLocaleString()} frames so far.`
                    : settingsNdiEnabled
                      ? "Starting…"
                      : "Off."
                }
              >
                {settingsNdiEnabled ? (
                  <SettingsStatus
                    tone={
                      settingsNdiRuntimeStatus.lastError || !settingsNdiRuntimeStatus.libraryLoaded
                        ? "warn"
                        : settingsNdiRuntimeStatus.running
                          ? "ok"
                          : "off"
                    }
                  >
                    {settingsNdiRuntimeStatus.running ? "Sending" : "Stopped"}
                  </SettingsStatus>
                ) : null}
                <SettingsSwitch label="NDI output" checked={settingsNdiEnabled} onChange={setSettingsNdiEnabled} />
              </SettingsRow>
              <SettingsRow label="Source name" description="What it is called on other computers.">
                <SettingsText
                  label="NDI source name"
                  value={settingsNdiSourceName}
                  onChange={setSettingsNdiSourceName}
                  placeholder="Present Main Output"
                />
              </SettingsRow>
              <SettingsRow label="Group" description="Leave as Public unless your network uses groups.">
                <SettingsText
                  label="NDI group"
                  value={settingsNdiGroupName}
                  onChange={setSettingsNdiGroupName}
                  placeholder="Public"
                />
              </SettingsRow>
              <SettingsRow
                label="Frame rate"
                description="A 4K background on a modest computer may not keep up with 50 or 60."
              >
                <SettingsSelect
                  label="NDI frame rate"
                  value={String(settingsNdiFrameRate)}
                  onChange={(value) => setSettingsNdiFrameRate(Number(value))}
                  className="w-[120px]"
                  options={NDI_FRAME_RATES.map((rate) => ({ value: String(rate), label: `${rate} fps` }))}
                />
              </SettingsRow>
              <SettingsRow label="Size" description="The picture's size as it goes out over the network.">
                <SettingsSelect
                  label="NDI size"
                  value={settingsScreenResolutions.audience}
                  onChange={(value) =>
                    setSettingsScreenResolutions((previous) => ({ ...previous, audience: value }))
                  }
                  className="w-[140px]"
                  options={NDI_SIZES.map((size) => ({ value: size, label: size.replace("x", " × ") }))}
                />
              </SettingsRow>
              {settingsNdiRuntimeStatus.lastError || !settingsNdiRuntimeStatus.libraryLoaded ? (
                <SettingsRow
                  label="Needs a look"
                  description={
                    <span className="text-red-400">
                      {settingsNdiRuntimeStatus.lastError ??
                        "NDI isn't installed on this computer. Install NDI Tools, then open Present again."}
                    </span>
                  }
                />
              ) : null}
            </SettingsGroup>
          </SettingsPage>
        );
    }
  })();

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-[220px] flex-none flex-col border-r border-border/70 bg-card/40 px-3 py-4">
        <nav aria-label="Settings" className="space-y-0.5">
          {SECTIONS.map(({ key, label, icon: Icon, tile }) => {
            const active = section === key;
            return (
              <button
                key={key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => choose(key)}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] transition",
                  active
                    ? "bg-foreground/[0.08] font-medium text-foreground"
                    : "text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                <span className={cn("flex h-6 w-6 flex-none items-center justify-center rounded-md text-white shadow-sm", tile)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Keyed by page, so each opens at its top. */}
      <main key={section} className="min-w-0 flex-1 overflow-y-auto">
        {page}
      </main>
    </div>
  );
}
