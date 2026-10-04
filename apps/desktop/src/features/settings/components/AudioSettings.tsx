"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Volume2 } from "lucide-react";
import { cn } from "../../../renderer/shared/lib/utils";
import type { AudioDevice } from "../../../renderer/tauri/sound";
import {
  SettingsButton,
  SettingsGroup,
  SettingsNote,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
} from "./settings-ui";

const SYSTEM_DEFAULT = "__system_default__";

/** The level and mute on everything Present plays, from the audio graph. */
function useMasterLevel() {
  const [level, setLevel] = useState<{ gain: number; muted: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    void (async () => {
      const core = await import("../../../renderer/tauri/audio");
      const apply = (graph: Awaited<ReturnType<typeof core.getAudioGraph>>) => {
        if (!cancelled) setLevel({ gain: graph.sink.masterGain, muted: graph.sink.masterMuted });
      };
      const unlisten = await core.onAudioChanged(apply);
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;
      apply(await core.getAudioGraph());
    })().catch((error: unknown) => console.error("[Settings] could not read the audio level", error));
    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);

  const setGain = useCallback((gain: number) => {
    setLevel((previous) => (previous ? { ...previous, gain } : previous));
    void import("../../../renderer/tauri/audio")
      .then((core) => core.setAudioMasterGain(gain))
      .catch((error: unknown) => console.error("[Settings] could not set the level", error));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    setLevel((previous) => (previous ? { ...previous, muted } : previous));
    void import("../../../renderer/tauri/audio")
      .then((core) => core.setAudioMasterMuted(muted))
      .catch((error: unknown) => console.error("[Settings] could not mute", error));
  }, []);

  return { level, setGain, setMuted };
}

/** The choices for a device picker: the system default, each device, and a
 * chosen one that is not connected now. */
const deviceOptions = (devices: AudioDevice[], chosenId: string | null, chosenLabel: string) => {
  const defaultDevice = devices.find((device) => device.isDefault);
  return [
    {
      value: SYSTEM_DEFAULT,
      label: defaultDevice ? `System default (${defaultDevice.label})` : "System default",
    },
    ...devices.map((device) => ({ value: device.id, label: device.label })),
    ...(chosenId && !devices.some((device) => device.id === chosenId)
      ? [{ value: chosenId, label: `${chosenLabel || "A device"} (not connected)` }]
      : []),
  ];
};

export function AudioSettings({
  outputs,
  inputs,
  loading,
  problem,
  onRefresh,
  outputDeviceId,
  outputDeviceLabel,
  onOutputChange,
  inputDeviceId,
  onInputChange,
}: {
  outputs: AudioDevice[];
  inputs: AudioDevice[];
  loading: boolean;
  problem: string | null;
  onRefresh: () => void;
  outputDeviceId: string | null;
  outputDeviceLabel: string;
  onOutputChange: (device: AudioDevice | null) => void;
  inputDeviceId: string | null;
  onInputChange: (device: AudioDevice | null) => void;
}) {
  const { level, setGain, setMuted } = useMasterLevel();
  const [testing, setTesting] = useState(false);

  const playTest = () => {
    setTesting(true);
    void import("../../../renderer/tauri/sound")
      .then((sound) => sound.playTestSound())
      .catch((error: unknown) => console.error("[Settings] could not play the test sound", error))
      .finally(() => window.setTimeout(() => setTesting(false), 800));
  };

  const refresh = (
    <SettingsButton
      variant="ghost"
      onClick={onRefresh}
      disabled={loading}
      title="Look again"
      className="w-8 px-0"
    >
      <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
      <span className="sr-only">Look for audio devices again</span>
    </SettingsButton>
  );

  const inputLabel = inputs.find((device) => device.id === inputDeviceId)?.label ?? "";

  return (
    <SettingsPage
      title="Audio"
      description="Where Present's sound goes, and which microphone it listens through."
    >
      <SettingsGroup
        title="Output"
        description="Videos and backing tracks. Present plays the sound itself, once, on this computer, whether or not a screen is open."
        action={refresh}
      >
        <SettingsRow
          label="Output device"
          description={
            problem ??
            (outputs.length === 1 ? "1 output found." : `${outputs.length} outputs found.`)
          }
        >
          <SettingsSelect
            label="Output device"
            value={outputDeviceId ?? SYSTEM_DEFAULT}
            onChange={(value) =>
              onOutputChange(
                value === SYSTEM_DEFAULT
                  ? null
                  : (outputs.find((device) => device.id === value) ?? {
                      id: value,
                      label: outputDeviceLabel,
                      isDefault: false,
                    }),
              )
            }
            options={deviceOptions(outputs, outputDeviceId, outputDeviceLabel)}
            className="w-[280px]"
          />
        </SettingsRow>
        <SettingsRow label="Test" description="A short tone on the output above.">
          <SettingsButton onClick={playTest} disabled={testing}>
            <Volume2 className="h-3.5 w-3.5" aria-hidden />
            Play test sound
          </SettingsButton>
        </SettingsRow>
        <SettingsRow label="Volume" description="Everything Present plays, before the device's own volume.">
          <SettingsSlider
            label="Volume"
            min={0}
            max={100}
            suffix="%"
            value={Math.round((level?.gain ?? 1) * 100)}
            onChange={(value) => setGain(value / 100)}
          />
        </SettingsRow>
        <SettingsRow label="Mute" description="Silence everything Present plays.">
          <SettingsSwitch
            label="Mute"
            checked={level?.muted ?? false}
            onChange={setMuted}
            disabled={!level}
          />
        </SettingsRow>
      </SettingsGroup>

      <div>
        <SettingsGroup
          title="Input"
          description="The microphone the Bible and song agents listen through."
        >
          <SettingsRow
            label="Microphone"
            description={
              inputs.length === 0
                ? "No microphones found."
                : inputs.length === 1
                  ? "1 microphone found."
                  : `${inputs.length} microphones found.`
            }
          >
            <SettingsSelect
              label="Microphone"
              value={inputDeviceId ?? SYSTEM_DEFAULT}
              onChange={(value) =>
                onInputChange(
                  value === SYSTEM_DEFAULT ? null : (inputs.find((device) => device.id === value) ?? null),
                )
              }
              options={deviceOptions(inputs, inputDeviceId, inputLabel)}
              className="w-[280px]"
            />
          </SettingsRow>
        </SettingsGroup>
        <SettingsNote>
          The devices are the ones macOS lists in Sound settings. A device plugged in while Settings is open
          appears within a few seconds.
        </SettingsNote>
      </div>
    </SettingsPage>
  );
}
