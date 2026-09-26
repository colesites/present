"use client";

import { useEffect, useState } from "react";
import { areDisplayListsEqual } from "../../../renderer/shared/lib/display-list";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  SettingsGroup,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
} from "./settings-ui";

export type ScreenRole = "audience" | "media" | "worship";

const SCREEN_ROLES: Array<{ key: ScreenRole; label: string; description: string }> = [
  { key: "audience", label: "Audience", description: "What the congregation sees." },
  { key: "media", label: "Media stage", description: "For the media desk, or backstage." },
  { key: "worship", label: "Worship stage", description: "Words and what is next, for the band." },
];

const RESOLUTIONS = [
  "3840x2160",
  "2560x1440",
  "1920x1080",
  "1600x900",
  "1366x768",
  "1280x720",
  "1024x768",
  "800x600",
];

const displayName = (display: Display) =>
  display.label || (display.isPrimary ? "Built-in display" : `Screen ${display.id}`);

const displaySize = (display: Display) => `${display.bounds.width} × ${display.bounds.height}`;

/** The screens the operating system reports, asked again every few seconds. */
function useDisplays() {
  const [displays, setDisplays] = useState<Display[]>([]);
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      if (!window.electronAPI?.getDisplays) return;
      try {
        const next = await window.electronAPI.getDisplays();
        if (mounted) setDisplays((previous) => (areDisplayListsEqual(previous, next) ? previous : next));
      } catch {
        if (mounted) setDisplays((previous) => (previous.length === 0 ? previous : []));
      }
    };
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);
  return displays;
}

/** A screen drawn to its own shape, so a portrait panel looks like one. */
function ScreenShape({ display, roles }: { display: Display; roles: string[] }) {
  const { width, height } = display.bounds;
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  const boxWidth = ratio >= 1 ? 72 : Math.round(48 * ratio);
  const boxHeight = ratio >= 1 ? Math.round(72 / ratio) : 48;
  return (
    <div className="flex items-center gap-3.5 px-4 py-3">
      <div className="flex h-12 w-[72px] flex-none items-center justify-center">
        <div
          className={cn(
            "rounded-[5px] border-2 bg-gradient-to-br from-zinc-700 to-zinc-900",
            roles.length > 0 ? "border-primary/70" : "border-zinc-500/60",
          )}
          style={{ width: boxWidth, height: boxHeight }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-foreground">
          {displayName(display)}
          {display.isPrimary ? <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">Main</span> : null}
        </p>
        <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
          {displaySize(display)}
          {display.scaleFactor && display.scaleFactor !== 1 ? ` · ${display.scaleFactor}x` : ""}
        </p>
      </div>
      {roles.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1">
          {roles.map((role) => (
            <span key={role} className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
              {role}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ScreensSettings({
  screenDisplayIds,
  onScreenDisplayChange,
  screenResolutions,
  onScreenResolutionChange,
  audioOutputDeviceId,
  audioOutputDeviceLabel,
  audioOutputs,
  onAudioOutputChange,
}: {
  screenDisplayIds: Record<ScreenRole, number | null>;
  onScreenDisplayChange: (role: ScreenRole, displayId: number | null) => void;
  screenResolutions: Record<ScreenRole, string>;
  onScreenResolutionChange: (role: ScreenRole, resolution: string) => void;
  audioOutputDeviceId: string | null;
  audioOutputDeviceLabel: string;
  audioOutputs: Array<{ deviceId: string; label: string }>;
  onAudioOutputChange: (deviceId: string) => void;
}) {
  const displays = useDisplays();
  const rolesOn = (display: Display) =>
    SCREEN_ROLES.filter((role) => screenDisplayIds[role.key] === display.id).map((role) => role.label);

  return (
    <SettingsPage
      title="Screens & sound"
      description="Which screen each output goes to, and where the sound of videos plays."
    >
      <div>
        <SettingsGroup
          title="Connected screens"
          action={
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {displays.length === 1 ? "1 screen" : `${displays.length} screens`}
            </span>
          }
        >
          {displays.length > 0 ? (
            displays.map((display) => <ScreenShape key={display.id} display={display} roles={rolesOn(display)} />)
          ) : (
            <p className="px-4 py-5 text-center text-[12.5px] text-muted-foreground">
              Looking for screens. Connect one and it appears here.
            </p>
          )}
        </SettingsGroup>
        <SettingsNote>
          A splitter or a mirroring hub shows as one screen, so every TV on it shows the same thing. For
          different pictures on each, give each output its own port, a multi-display adapter, or a
          DisplayLink dock.
        </SettingsNote>
      </div>

      <SettingsGroup title="Outputs" description="Automatic uses the largest screen that isn't this one.">
        {SCREEN_ROLES.map((role) => {
          const displayId = screenDisplayIds[role.key];
          return (
            <SettingsRow key={role.key} label={role.label} description={role.description}>
              <SettingsSelect
                label={`${role.label} screen`}
                value={displayId === null ? "auto" : String(displayId)}
                onChange={(value) => onScreenDisplayChange(role.key, value === "auto" ? null : Number(value))}
                className="w-[210px]"
                options={[
                  { value: "auto", label: "Automatic" },
                  ...displays.map((display) => ({
                    value: String(display.id),
                    label: `${displayName(display)} · ${displaySize(display)}`,
                  })),
                  // A screen chosen before and not connected now is still the
                  // choice; say so rather than showing nothing chosen.
                  ...(displayId !== null && !displays.some((display) => display.id === displayId)
                    ? [{ value: String(displayId), label: "A screen not connected" }]
                    : []),
                ]}
              />
              <SettingsSelect
                label={`${role.label} resolution`}
                value={screenResolutions[role.key]}
                onChange={(value) => onScreenResolutionChange(role.key, value)}
                className="w-[124px]"
                options={RESOLUTIONS.map((resolution) => ({
                  value: resolution,
                  label: resolution.replace("x", " × "),
                }))}
              />
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Sound">
        <SettingsRow
          label="Video sound"
          description="Plays once, from this computer, whether or not a screen is open."
        >
          <SettingsSelect
            label="Video sound output"
            value={audioOutputDeviceId ?? "__system_default__"}
            onChange={onAudioOutputChange}
            options={[
              { value: "__system_default__", label: "System default" },
              ...audioOutputs.map((device) => ({ value: device.deviceId, label: device.label })),
              ...(audioOutputDeviceId && !audioOutputs.some((device) => device.deviceId === audioOutputDeviceId)
                ? [{ value: audioOutputDeviceId, label: audioOutputDeviceLabel || "A device not connected" }]
                : []),
            ]}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}
