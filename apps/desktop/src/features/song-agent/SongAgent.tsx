"use client";

import { useSongAgent, type UseSongAgentOptions } from "./useSongAgent";

/**
 * The song agent, as a component of its own that draws nothing.
 *
 * Its speech hearings change state on every word the service sends, several
 * times a second from each. Run as a hook of the operator's screen, each of
 * those re-rendered the whole screen, previews and all, and with the screen
 * already projecting and recording that took the CPU to 90%. Here, they
 * re-render only this.
 */
export function SongAgent(props: UseSongAgentOptions): null {
  useSongAgent(props);
  return null;
}
