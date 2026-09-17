import { useCallback, useEffect, useState } from "react";

import { cn } from "../../../renderer/shared/lib/utils";
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
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pedals, MIDI and OSC
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {error ?? "Reading the control settings…"}
        </p>
      </section>
    );
  }

  const { config, midiPorts, midiListening, oscPort } = status;

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pedals, MIDI and OSC
        </h3>
        <p className="text-[11px] text-muted-foreground">
          Drive the service from a foot pedal or a control surface over MIDI, or from a
          lighting desk, QLab or a phone over the network with OSC.
        </p>
      </div>

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <section className="space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={config.midi.enabled}
            onChange={(event) =>
              save({ ...config, midi: { ...config.midi, enabled: event.target.checked } })
            }
          />
          <span>MIDI in</span>
          {config.midi.enabled ? (
            <span
              className={cn(
                "text-[11px]",
                midiListening ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {midiListening ? "listening" : "no device"}
            </span>
          ) : null}
        </label>

        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-20">Device</span>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs"
            value={config.midi.port ?? ""}
            onChange={(event) =>
              save({
                ...config,
                midi: { ...config.midi, port: event.target.value || null },
              })
            }
          >
            <option value="">Every device</option>
            {midiPorts.map((port) => (
              <option key={port} value={port}>
                {port}
              </option>
            ))}
          </select>
        </label>

        <ul className="space-y-1">
          {config.midi.bindings.map((binding, index) => (
            <li
              key={`${describeMidiMessage(binding)}-${index}`}
              className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[11px]"
            >
              <span>
                {describeMidiMessage(binding)} → {actionLabel(binding)}
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
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
              </button>
            </li>
          ))}
          {config.midi.bindings.length === 0 ? (
            <li className="text-[11px] text-muted-foreground">
              Nothing bound yet. Choose what a button should do, then press it.
            </li>
          ) : null}
        </ul>

        <div className="flex items-center gap-2">
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs"
            value={pending}
            onChange={(event) => setPending(event.target.value as ControlActionChoice)}
          >
            {CONTROL_ACTION_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            disabled={listening}
            onClick={() => void learn()}
          >
            {listening ? "Press the button now…" : "Bind a button"}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={config.osc.enabled}
            onChange={(event) =>
              save({ ...config, osc: { ...config.osc, enabled: event.target.checked } })
            }
          />
          <span>OSC in</span>
          {config.osc.enabled ? (
            <span
              className={cn(
                "text-[11px]",
                oscPort ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {oscPort ? `listening on ${oscPort}` : "port unavailable"}
            </span>
          ) : null}
        </label>

        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="w-20">Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            className="w-24 rounded border border-border bg-background px-2 py-1 text-xs"
            value={config.osc.port}
            onChange={(event) => {
              const port = Number(event.target.value);
              if (Number.isInteger(port) && port > 0 && port < 65536) {
                save({ ...config, osc: { ...config.osc, port } });
              }
            }}
          />
        </label>

        <ul className="space-y-1">
          {config.osc.bindings.map((binding) => (
            <li
              key={binding.address}
              className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-[11px]"
            >
              <code>{binding.address}</code>
              <span className="text-muted-foreground">{actionLabel(binding)}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Send to this computer&apos;s address on the port above. A slide number or a
          scripture reference goes in the message: <code>/present/slide/go 12</code>,{" "}
          <code>/present/scripture &quot;John 3:16&quot;</code>.
        </p>
      </section>
    </section>
  );
}
