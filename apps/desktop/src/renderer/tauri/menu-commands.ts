/**
 * The application menu, as the operator window carries it out.
 *
 * `services/app_menu.rs` builds the menu. The live controls — slides, items,
 * text and media on the output — it sends through the same path a foot pedal
 * takes. Everything else arrives here as `menu:command` with the item's id,
 * and runs the handler the window's own button runs: the component that owns
 * an action registers for its id with `useMenuCommand`, so the menu can never
 * do something differently from the screen it describes.
 *
 * A command can arrive before its handler exists. File ▸ New Service from the
 * Bible view has to bring the services list on screen first, and the list's
 * "new service" dialog cannot be asked to open until it has mounted — so a
 * command nobody has claimed waits a moment for whoever claims it.
 *
 * The ticks beside "Text on Output" and the rest are the window's to set:
 * `useMenuChecks` reports what is actually on, whenever it changes.
 */

import { useEffect, useRef } from "react";
import { aiOperatorBus } from "../ai-operator/operatorBus";

/** How long an unclaimed command waits for the component that handles it. */
const WAIT_FOR_HANDLER_MS = 2_000;

/**
 * Items carried out by the command set the AI operator already has, which
 * lives beside the state it changes (`usePresentAiToolProvider`).
 */
const THROUGH_THE_OPERATOR: Record<string, { name: string; arguments: Record<string, unknown> }> = {
  "view.slide-grid": { name: "toggle_slide_grid", arguments: {} },
  "view.sidebar.audio": { name: "open_sidebar_tab", arguments: { tab: "audio" } },
  "view.sidebar.text": { name: "open_sidebar_tab", arguments: { tab: "text" } },
  "view.sidebar.timer": { name: "open_sidebar_tab", arguments: { tab: "timer" } },
  "view.sidebar.messages": { name: "open_sidebar_tab", arguments: { tab: "messages" } },
  "view.sidebar.layers": { name: "open_sidebar_tab", arguments: { tab: "layers" } },
  "view.sidebar.masters": { name: "open_sidebar_tab", arguments: { tab: "masters" } },
  "presentation.timer": { name: "toggle_timer_layer", arguments: {} },
  "presentation.messages": { name: "toggle_message_layer", arguments: {} },
};

type Handler = () => void;

const handlers = new Map<string, Handler>();
const waiting = new Map<string, number>();

let calls = 0;

/** Carry out a menu item, or one command a menu item forwards to. */
export const runMenuCommand = (command: string): void => {
  const handler = handlers.get(command);
  if (handler) {
    handler();
    return;
  }
  const operator = THROUGH_THE_OPERATOR[command];
  if (operator) {
    calls += 1;
    void aiOperatorBus
      .executeTool({ id: `menu-${calls}`, name: operator.name, arguments: operator.arguments })
      .then((result) => {
        if (!result.ok) console.warn("[Menu] could not carry out", command, result.error);
      });
    return;
  }
  waiting.set(command, Date.now() + WAIT_FOR_HANDLER_MS);
};

/**
 * Carry out `command` whenever the menu asks, with the handler as it is now.
 * One component owns each command; the latest to mount wins.
 */
export function useMenuCommand(command: string, handler: Handler): void {
  // The handler as of the latest render, kept without re-registering: the
  // command's owner does not change when its handler does.
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    const run: Handler = () => latest.current();
    handlers.set(command, run);

    const until = waiting.get(command);
    if (until !== undefined) {
      waiting.delete(command);
      if (until >= Date.now()) window.setTimeout(run, 0);
    }

    return () => {
      if (handlers.get(command) === run) handlers.delete(command);
    };
  }, [command]);
}

const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Listen for the menu. Mounted once, by the operator window, and `enabled`
 * only there.
 *
 * Tauri delivers the menu's events to every window, and the Settings window
 * is the same app: listening there too carried each command out twice while
 * Settings was open, so closing a stage screen from the menu opened it again.
 */
export function useMenuCommandListener(enabled = true): void {
  useEffect(() => {
    if (!enabled || !isTauriShell()) return;
    let detach: (() => void) | null = null;
    let cancelled = false;

    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen<string>("menu:command", ({ payload }) => runMenuCommand(payload)))
      .then((unlisten) => {
        if (cancelled) unlisten();
        else detach = unlisten;
      })
      .catch((error: unknown) => {
        console.error("[Menu] could not listen for the application menu", error);
      });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [enabled]);
}

/** What the menu's ticks report, by the key `app_menu.rs` files them under. */
export type MenuCheck =
  | "text"
  | "media"
  | "background"
  | "timer"
  | "messages"
  | "freeze"
  | "grid"
  | "output"
  | "mediaStage"
  | "worshipStage";

/**
 * Keep the menu's ticks on what this window says is on. Only the keys given
 * are reported, so each part of the window reports what it owns, and nothing
 * while not `enabled`.
 */
export function useMenuChecks(checks: Partial<Record<MenuCheck, boolean>>, enabled = true): void {
  const key = JSON.stringify(checks);
  useEffect(() => {
    if (!enabled || !isTauriShell()) return;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("set_menu_checks", { checks: JSON.parse(key) as Record<string, boolean> }))
      .catch((): undefined => undefined);
  }, [enabled, key]);
}
