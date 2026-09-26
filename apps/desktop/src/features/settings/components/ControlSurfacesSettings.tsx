import { useCallback, useEffect, useState } from "react";

import {
  SettingsBlock,
  SettingsButton,
  SettingsGroup,
  SettingsNumber,
  SettingsRow,
  SettingsSelect,
  SettingsStatus,
  SettingsSwitch,
} from "./settings-ui";
import {
  actionLabel,
  addMidiBinding,
  CONTROL_ACTION_CHOICES,
  describeMidiMessage,
  getControlSettings,
  learnMidiMessage,
  setControlSettings,
  type ControlActionChoice,
  type ControlStatus,
} from "../../../renderer/tauri/control";

/**
 * Foot pedals, MIDI and OSC.
 *
 * Both are off until they are set up here, so nothing a stray note or a packet
 * on the network does can move a service by accident. A MIDI binding is made
 * by pressing the pedal, not by naming the note it sends.
 */
export function ControlSurfacesSettings() {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState<ControlActionChoice>("nextSlide");

  const load = useCallback(() => {
    void getControlSettings()
      .then(setStatus)
      .catch(() => setError("Unable to read the control settings"));
  }, []);

  useEffect(load, [load]);

  const save = useCallback(
    (next: ControlStatus["config"]) => {
      setError(null);
      void setControlSettings(next)
        .then(setStatus)
        .catch(() => setError("Unable to save the control settings"));
    },
    [],
  );

  const learn = useCallback(async () => {
    if (!status) return;
    setError(null);
    setListening(true);
    try {
      const learned = await learnMidiMessage();
      if (!learned) {
        setError("Nothing arrived. Is the device plugged in and sending?");
        return;
      }
      save(addMidiBinding(status.config, learned, pending));
    } catch {
      setError("Unable to listen for a MIDI message");
    } finally {
      setListening(false);
    }
  }, [pending, save, status]);

  if (!status) {
    return (
      <SettingsGroup title="Pedals and MIDI">
        <SettingsRow label="MIDI in" description={error ?? "Reading the control settings…"} />
      </SettingsGroup>
    );
  }

  const { config, midiPorts, midiListening, oscPort } = status;

  return (
    <>
      <SettingsGroup
        title="Pedals and MIDI"
        description="Drive the service from a foot pedal or a control surface. A button is bound by pressing it."
      >
        <SettingsRow
          label="MIDI in"
          description={
            error ? (
              <span className="text-red-400">{error}</span>
            ) : config.midi.enabled ? (
              midiListening ? (
                "Listening."
              ) : (
                <span className="text-red-400">No device is sending.</span>
              )
            ) : (
              "Off, so a stray note moves nothing."
            )
          }
        >
          {config.midi.enabled ? (
            <SettingsStatus tone={midiListening ? "ok" : "warn"}>{midiListening ? "Listening" : "No device"}</SettingsStatus>
          ) : null}
          <SettingsSwitch
            label="MIDI in"
            checked={config.midi.enabled}
            onChange={(enabled) => save({ ...config, midi: { ...config.midi, enabled } })}
          />
        </SettingsRow>
        <SettingsRow label="Device">
          <SettingsSelect
            label="MIDI device"
            value={config.midi.port ?? "__every__"}
            onChange={(value) =>
              save({ ...config, midi: { ...config.midi, port: value === "__every__" ? null : value } })
            }
            options={[
              { value: "__every__", label: "Every device" },
              ...midiPorts.map((port) => ({ value: port, label: port })),
              ...(config.midi.port && !midiPorts.includes(config.midi.port)
                ? [{ value: config.midi.port, label: config.midi.port }]
                : []),
            ]}
          />
        </SettingsRow>
        {config.midi.bindings.map((binding, index) => (
          <SettingsRow
            key={`${describeMidiMessage(binding)}-${index}`}
            label={actionLabel(binding)}
            description={describeMidiMessage(binding)}
            className="min-h-[48px]"
          >
            <SettingsButton
              variant="ghost"
              onClick={() =>
                save({
                  ...config,
                  midi: {
                    ...config.midi,
                    bindings: config.midi.bindings.filter((_, at) => at !== index),
                  },
                })
              }
            >
              Remove
            </SettingsButton>
          </SettingsRow>
        ))}
        <SettingsRow
          label="Bind a button"
          description={
            listening
              ? "Press the pedal or button now."
              : config.midi.bindings.length === 0
                ? "Nothing is bound yet. Choose what it does, then press it."
                : "Choose what it does, then press it."
          }
        >
          <SettingsSelect
            label="What the button does"
            value={pending}
            onChange={(value) => setPending(value as ControlActionChoice)}
            className="w-[180px]"
            options={CONTROL_ACTION_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
          />
          <SettingsButton onClick={() => void learn()} disabled={listening}>
            {listening ? "Listening…" : "Bind"}
          </SettingsButton>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="OSC"
        description="From a lighting desk, QLab or a phone app, over the network."
      >
        <SettingsRow
          label="OSC in"
          description={
            config.osc.enabled
              ? oscPort
                ? `Listening on port ${oscPort}.`
                : <span className="text-red-400">That port could not be opened. Something else may be using it.</span>
              : "Off."
          }
        >
          {config.osc.enabled ? (
            <SettingsStatus tone={oscPort ? "ok" : "warn"}>{oscPort ? "Listening" : "Port busy"}</SettingsStatus>
          ) : null}
          <SettingsSwitch
            label="OSC in"
            checked={config.osc.enabled}
            onChange={(enabled) => save({ ...config, osc: { ...config.osc, enabled } })}
          />
        </SettingsRow>
        <SettingsRow label="Port">
          <SettingsNumber
            label="OSC port"
            value={config.osc.port}
            min={1}
            max={65535}
            onChange={(port) => save({ ...config, osc: { ...config.osc, port } })}
          />
        </SettingsRow>
        <SettingsBlock>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Send to this computer&apos;s address, on the port above. A slide number or a reference goes in the
            message, like <code className="text-foreground">/present/slide/go 12</code> or{" "}
            <code className="text-foreground">/present/scripture &quot;John 3:16&quot;</code>.
          </p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 text-[12px]">
            {config.osc.bindings.map((binding) => (
              <div key={binding.address} className="contents">
                <code className="truncate text-foreground">{binding.address}</code>
                <span className="text-right text-muted-foreground">{actionLabel(binding)}</span>
              </div>
            ))}
          </div>
        </SettingsBlock>
      </SettingsGroup>
    </>
  );
}
