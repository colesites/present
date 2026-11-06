"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { userMessage } from "../../../renderer/shared/lib/user-error";
import type {
  ProjectionCapabilities,
  ProjectionFrameRate,
  ProjectionPreset,
  ProjectionResolution,
  ProjectionSettings as Settings,
  ProjectionStatus,
} from "../../../renderer/tauri/projection";
import {
  SettingsGroup,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsStatus,
  SettingsSwitch,
} from "./settings-ui";

const PRESETS: Array<{ value: ProjectionPreset; label: string }> = [
  { value: "veryLow", label: "Very Low — 1280 × 720, 24 fps" },
  { value: "low", label: "Low — 1920 × 1080, 30 fps" },
  { value: "medium", label: "Medium — 1920 × 1080, 30–60 fps" },
  { value: "balanced", label: "Balanced — 1920 × 1080, 60 fps" },
  { value: "high", label: "High — 2560 × 1440, 60 fps" },
  { value: "highest", label: "Highest — 3840 × 2160, 60 fps" },
  { value: "custom", label: "Custom" },
];

const RESOLUTIONS: Array<{ value: ProjectionResolution; label: string }> = [
  { value: "r720", label: "1280 × 720" },
  { value: "r1080", label: "1920 × 1080" },
  { value: "r1440", label: "2560 × 1440" },
  { value: "r2160", label: "3840 × 2160" },
  { value: "native", label: "Each display's own" },
];

const FRAME_RATES: Array<{ value: ProjectionFrameRate; label: string }> = [
  { value: "fps24", label: "24 fps" },
  { value: "fps30", label: "30 fps" },
  { value: "adaptive", label: "30–60 fps, as needed" },
  { value: "fps60", label: "60 fps" },
];

const label = <T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
) => options.find((option) => option.value === value)?.label ?? value;

/** The operator's projection settings, kept in the Rust core and read by every screen. */
function useProjection() {
  const [status, setStatus] = useState<ProjectionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      import("../../../renderer/tauri/projection")
        .then((projection) => projection.getProjectionSettings())
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch((error: unknown) =>
          console.error(
            "[Settings] could not read the projection settings",
            error,
          ),
        );
    void read();
    // The automatic adjustment can step the screens down and back up while
    // this page is open.
    const id = window.setInterval(() => {
      void read();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const change = useCallback((patch: Partial<Settings>) => {
    setStatus((previous) => {
      if (!previous) return previous;
      const settings = { ...previous.settings, ...patch };
      void import("../../../renderer/tauri/projection")
        .then((projection) => projection.setProjectionSettings(settings))
        .then(setStatus)
        .catch((error: unknown) =>
          toast.error(
            userMessage(
              error,
              "The projection settings could not be saved.",
              "Settings",
            ),
          ),
        );
      return { ...previous, settings };
    });
  }, []);

  return { status, change };
}

function useCapabilities() {
  const [found, setFound] = useState<ProjectionCapabilities | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("../../../renderer/tauri/projection")
      .then((projection) => projection.getProjectionCapabilities())
      .then((next) => {
        if (!cancelled) setFound(next);
      })
      .catch((error: unknown) =>
        console.error(
          "[Settings] could not read what this computer can do",
          error,
        ),
      );
    return () => {
      cancelled = true;
    };
  }, []);
  return found;
}

export function ProjectionSettings() {
  const { status, change } = useProjection();
  const capabilities = useCapabilities();
  const settings = status?.settings;
  // Only macOS draws the audience screens natively; elsewhere the web view
  // draws them and only hardware decoding applies.
  const native = capabilities?.layers ?? true;
  const locked = !settings || !native;

  return (
    <SettingsPage
      title="Projection"
      description="How the audience screens are drawn: their quality, how smoothly they move, and the work it takes."
    >
      {native ? null : (
        <SettingsNote>
          On this computer the audience screens are drawn by the app's web view,
          so only Hardware decoding applies here. The other settings take effect
          on a Mac.
        </SettingsNote>
      )}
      <SettingsGroup
        title="Quality"
        description="Targets for what the screens show. A video is never decoded smaller than the screen it is on, and a screen smaller than the target is drawn at its own size."
      >
        <SettingsRow label="Preset">
          <SettingsSelect
            label="Projection preset"
            value={settings?.preset ?? "highest"}
            options={PRESETS}
            disabled={locked}
            onChange={(value) => change({ preset: value as ProjectionPreset })}
          />
        </SettingsRow>
        <SettingsRow
          label="Resolution"
          description="The most pixels a screen's slide and picture are drawn at. Displays scale it to fit."
        >
          <SettingsSelect
            label="Projection resolution"
            value={settings?.resolution ?? "r2160"}
            options={RESOLUTIONS}
            disabled={locked}
            onChange={(value) =>
              change({
                preset: "custom",
                resolution: value as ProjectionResolution,
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Frame rate"
          description="How often a screen is drawn, at most. A video still plays at its own rate up to this."
        >
          <SettingsSelect
            label="Projection frame rate"
            value={settings?.frameRate ?? "fps60"}
            options={FRAME_RATES}
            disabled={locked}
            onChange={(value) =>
              change({
                preset: "custom",
                frameRate: value as ProjectionFrameRate,
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Video quality"
          description="High scales a video to each screen's exact size on the GPU; Standard lets the display scale it."
        >
          <SettingsSelect
            label="Video playback quality"
            value={settings?.videoQuality ?? "high"}
            options={[
              { value: "high", label: "High" },
              { value: "standard", label: "Standard" },
            ]}
            disabled={locked}
            onChange={(value) =>
              change({ videoQuality: value as Settings["videoQuality"] })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Adjust automatically"
          description={
            status && status.adjustedBy > 0
              ? `The screens fell behind, so they are being drawn at ${label(RESOLUTIONS, status.resolution)} and ${label(FRAME_RATES, status.frameRate)} until they keep up again.`
              : "Steps the resolution, then the frame rate, down if the screens fall behind, and back up once they keep up."
          }
        >
          <SettingsSwitch
            label="Adjust quality automatically"
            checked={settings?.autoAdjust ?? true}
            disabled={locked}
            onChange={(autoAdjust) => change({ autoAdjust })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Performance" description="Where the work is done.">
        <SettingsRow
          label="Hardware decoding"
          description="Auto uses the GPU for every codec this computer's GPU decodes, macOS's own decoder for ProRes, and software for the rest."
        >
          <SettingsSelect
            label="Hardware decoding"
            value={settings?.hardwareDecoding ?? "auto"}
            options={[
              { value: "auto", label: "Auto" },
              { value: "enabled", label: "Enabled" },
              { value: "disabled", label: "Disabled" },
            ]}
            disabled={!settings}
            onChange={(value) =>
              change({
                hardwareDecoding: value as Settings["hardwareDecoding"],
              })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Rendering"
          description="Automatic shows a video as the GPU decoded it, with the slide over it. Compatibility draws every picture on the processor, as earlier versions did."
        >
          <SettingsSelect
            label="Rendering mode"
            value={settings?.rendering ?? "automatic"}
            options={[
              { value: "automatic", label: "Automatic" },
              { value: "gpu", label: "GPU" },
              { value: "compatibility", label: "Compatibility" },
            ]}
            disabled={locked}
            onChange={(value) =>
              change({ rendering: value as Settings["rendering"] })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Power"
          description="Efficiency draws transitions and scrolling messages at up to 30 fps, and checks still screens less often."
        >
          <SettingsSelect
            label="Power mode"
            value={settings?.power ?? "performance"}
            options={[
              { value: "performance", label: "Performance" },
              { value: "efficiency", label: "Efficiency" },
            ]}
            disabled={locked}
            onChange={(value) => change({ power: value as Settings["power"] })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="This computer">
        <SettingsRow
          label="Graphics"
          description={
            capabilities
              ? capabilities.gpus
                  .map(
                    (gpu) =>
                      `${gpu.name}${gpu.lowPower ? " (integrated)" : ""}${gpu.removable ? " (external)" : ""}`,
                  )
                  .join(", ") || "None found"
              : "Looking…"
          }
        />
        <SettingsRow
          label="Decoded on the GPU"
          description={capabilities ? undefined : "Looking…"}
        >
          {capabilities ? (
            <div className="flex max-w-[360px] flex-wrap justify-end gap-1.5">
              {capabilities.decoding.map((codec) => (
                <SettingsStatus
                  key={codec.codec}
                  tone={codec.gpu ? "ok" : "off"}
                >
                  {codec.codec}
                </SettingsStatus>
              ))}
            </div>
          ) : null}
        </SettingsRow>
        <SettingsRow
          label="Displays"
          description={
            capabilities
              ? capabilities.displays
                  .map(
                    (display) =>
                      `${display.width} × ${display.height}${display.refreshHz > 0 ? ` at ${Math.round(display.refreshHz)} Hz` : ""}${display.builtIn ? " (built in)" : ""}`,
                  )
                  .join(", ") || "None found"
              : "Looking…"
          }
        />
      </SettingsGroup>
      <SettingsNote>
        A codec not decoded on the GPU still plays: it is decoded on the
        processor, which takes more of it.
      </SettingsNote>
    </SettingsPage>
  );
}
