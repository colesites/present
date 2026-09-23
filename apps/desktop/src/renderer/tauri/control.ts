/**
 * The control surfaces, as the settings screen sees them.
 *
 * The core holds the bindings and does the listening (`services/control`);
 * this is the vocabulary the settings screen needs to show them and the labels
 * a person reads.
 */

import { invoke } from "@tauri-apps/api/core";

export type ControlSwitchValue = "on" | "off" | "toggle";

/** What a binding does. Mirrors `services::control::Action`. */
export type ControlAction =
  | { action: "nextSlide" }
  | { action: "previousSlide" }
  | { action: "goToSlide"; index: number }
  | { action: "nextItem" }
  | { action: "previousItem" }
  | { action: "text"; to: ControlSwitchValue }
  | { action: "media"; to: ControlSwitchValue }
  | { action: "background"; to: ControlSwitchValue }
  | { action: "freeze"; to: ControlSwitchValue }
  | { action: "clearMedia" }
  | { action: "goToScripture"; reference: string };

export type MidiMessage =
  | { kind: "note"; note: number }
  | { kind: "controller"; controller: number }
  | { kind: "program"; program: number };

export type MidiBinding = ControlAction & {
  channel: number | null;
  message: MidiMessage;
};

export type OscBinding = ControlAction & { address: string };

export type ControlConfig = {
  midi: { enabled: boolean; port: string | null; bindings: MidiBinding[] };
  osc: { enabled: boolean; port: number; bindings: OscBinding[] };
};

export type ControlStatus = {
  config: ControlConfig;
  midiListening: boolean;
  oscPort: number | null;
  midiPorts: string[];
};

export type LearnedMidi = { channel: number | null; message: MidiMessage };

/** The actions worth binding a button to, in the order a person would look. */
export const CONTROL_ACTION_CHOICES = [
  { value: "nextSlide", label: "Next slide" },
  { value: "previousSlide", label: "Previous slide" },
  { value: "nextItem", label: "Next item" },
  { value: "previousItem", label: "Previous item" },
  { value: "text", label: "Show or hide the words" },
  { value: "media", label: "Show or hide the media" },
  { value: "background", label: "Show or hide the background" },
  { value: "freeze", label: "Freeze or unfreeze" },
  { value: "clearMedia", label: "Clear the media" },
] as const;

export type ControlActionChoice = (typeof CONTROL_ACTION_CHOICES)[number]["value"];

/** That choice as the action the core stores. */
export function actionFor(choice: ControlActionChoice): ControlAction {
  switch (choice) {
    case "text":
    case "media":
    case "background":
    case "freeze":
      return { action: choice, to: "toggle" };
    default:
      return { action: choice };
  }
}

/** What a binding does, in words. */
export function actionLabel(action: ControlAction): string {
  const choice = CONTROL_ACTION_CHOICES.find((entry) => entry.value === action.action);
  if (choice) return choice.label;
  if (action.action === "goToSlide") return `Go to slide ${action.index + 1}`;
  if (action.action === "goToScripture") return "Go to a scripture reference";
  return action.action;
}

/** What a MIDI binding listens for, in words. */
export function describeMidiMessage(binding: MidiBinding): string {
  const channel = binding.channel ? ` on channel ${binding.channel}` : "";
  switch (binding.message.kind) {
    case "note":
      return `Note ${binding.message.note}${channel}`;
    case "controller":
      return `Control ${binding.message.controller}${channel}`;
    case "program":
      return `Program ${binding.message.program}${channel}`;
  }
}

/** The settings with one more MIDI binding, replacing any on the same button. */
export function addMidiBinding(
  config: ControlConfig,
  learned: LearnedMidi,
  choice: ControlActionChoice,
): ControlConfig {
  const binding: MidiBinding = {
    channel: learned.channel,
    message: learned.message,
    ...actionFor(choice),
  };
  const same = (entry: MidiBinding) =>
    entry.channel === binding.channel &&
    JSON.stringify(entry.message) === JSON.stringify(binding.message);
  return {
    ...config,
    midi: {
      ...config.midi,
      // Turning MIDI on is what binding a button means.
      enabled: true,
      bindings: [...config.midi.bindings.filter((entry) => !same(entry)), binding],
    },
  };
}

export const getControlSettings = () => invoke<ControlStatus>("get_control_settings");

export const setControlSettings = (config: ControlConfig) =>
  invoke<ControlStatus>("set_control_settings", { config });

export const learnMidiMessage = (seconds?: number) =>
  invoke<LearnedMidi | null>("learn_midi_message", { seconds });

export const runControlAction = (action: ControlAction) =>
  invoke<void>("run_control_action", { action });
