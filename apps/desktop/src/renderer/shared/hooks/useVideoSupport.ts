"use client";

/**
 * Which media files will not play, and what to do about them.
 *
 * ADR-002 chose the platform decoder and named the cost: AVFoundation opens
 * neither `.mkv` nor `.avi`, and `.webm` only sometimes. The ADR is explicit
 * that this creates a UI requirement rather than an implementation detail - a
 * volunteer dropping an unsupported file into a media folder needs to be told
 * before the service, not shown a black rectangle during it.
 *
 * **Tauri only.** Under Electron the media goes through Chromium, which opens
 * more, so flagging files there would warn about a problem that shell does not
 * have. That matches the standing call to fix in the rewrite rather than in the
 * shipping build.
 *
 * The check asks Rust once per folder load and gets back only the problems, so
 * a library of MP4s costs one round trip and an empty array.
 */

import { useEffect, useState } from "react";

const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Dynamic, so the Electron bundle never pulls in `@tauri-apps/api`. */
const runtime = () => import("@tauri-apps/api/core");

export type UnplayableMedia = { path: string; advice: string };

/**
 * Paths mapped to advice, for the media the decoder cannot open.
 *
 * Empty under Electron, and empty under Tauri until the check resolves - a
 * warning that flashes on during load and off again is worse than one that
 * arrives a moment late.
 */
export function useVideoSupport(paths: string[]): Map<string, string> {
  const [unplayable, setUnplayable] = useState<Map<string, string>>(new Map());

  // The paths array is rebuilt on every render, so the effect keys off a stable
  // join rather than the array identity. Without it this would re-check the
  // whole library whenever anything above it re-rendered.
  const key = paths.join(" ");

  useEffect(() => {
    if (!isTauriShell() || paths.length === 0) {
      setUnplayable((previous) => (previous.size === 0 ? previous : new Map()));
      return;
    }

    let cancelled = false;
    void (async () => {
      const { invoke } = await runtime();
      const reported = await invoke<UnplayableMedia[]>("check_video_support", {
        paths,
      });
      if (cancelled) return;

      setUnplayable(new Map(reported.map((item) => [item.path, item.advice])));
    })().catch((error: unknown) => {
      // A failed check must not hide the panel. The worst case is the warning
      // being absent, which is where this started.
      console.error("[Media] could not check video support", error);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return unplayable;
}
