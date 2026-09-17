"use client";

/**
 * What a foot pedal, a lighting desk or a phone asks the operator window to do.
 *
 * The Rust core carries out what it owns — the slide position — and announces
 * the rest as `control:action` (`services/control`). This turns each one into
 * the same handler a click would reach, so a pedal press and a button press are
 * the same thing happening.
 */

import { useEffect, useRef } from "react";

export type ControlSwitch = "on" | "off" | "toggle";

export type ControlAction =
  | { action: "nextSlide" }
  | { action: "previousSlide" }
  | { action: "goToSlide"; index: number }
  | { action: "nextItem" }
  | { action: "previousItem" }
  | { action: "text"; to: ControlSwitch }
  | { action: "media"; to: ControlSwitch }
  | { action: "background"; to: ControlSwitch }
  | { action: "freeze"; to: ControlSwitch }
  | { action: "clearMedia" }
  | { action: "goToScripture"; reference: string };

/** What the window can do about one. */
export type ControlHandlers = {
  onNextItem: () => void;
  onPreviousItem: () => void;
  onText: (to: ControlSwitch) => void;
  onMedia: (to: ControlSwitch) => void;
  onBackground: (to: ControlSwitch) => void;
  onFreeze: (to: ControlSwitch) => void;
  onClearMedia: () => void;
  onScripture: (reference: string) => void;
};

/** A switch the core did not send, or sent as something unknown, is a toggle. */
function switchOf(value: unknown): ControlSwitch {
  return value === "on" || value === "off" ? value : "toggle";
}

export function useControlActions(handlers: ControlHandlers): void {
  // The handlers change every render; the listener should not.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<ControlAction>("control:action", ({ payload }) => {
        const current = latest.current;
        switch (payload.action) {
          case "nextItem":
            return current.onNextItem();
          case "previousItem":
            return current.onPreviousItem();
          case "text":
            return current.onText(switchOf(payload.to));
          case "media":
            return current.onMedia(switchOf(payload.to));
          case "background":
            return current.onBackground(switchOf(payload.to));
          case "freeze":
            return current.onFreeze(switchOf(payload.to));
          case "clearMedia":
            return current.onClearMedia();
          case "goToScripture":
            if (payload.reference.trim()) current.onScripture(payload.reference);
            return;
          default:
            // A newer core asking for something this window does not know.
            console.warn("[Control] unknown action", payload);
        }
      });
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;
    })().catch((error: unknown) => {
      console.error("[Control] could not listen for control actions", error);
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, []);
}
