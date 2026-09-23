"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";

import { cn } from "../../../renderer/shared/lib/utils";

/**
 * A still of a video, decoded once in Rust and cached (`services/thumbnails.rs`).
 *
 * The panels drew a paused video element per file. Dozens of 4K decoders for
 * pictures that never move made the whole window blank and stutter after it
 * was minimised or lost focus, and slowed the video actually playing.
 */

/** Object URLs by path and modification time, kept for the life of the window. */
const loaded = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

async function fetchThumbnail(path: string, key: string): Promise<string> {
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<ArrayBuffer>("get_media_thumbnail", { path });
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    loaded.set(key, url);
    return url;
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
}

export function VideoThumbnail({
  path,
  lastModified,
  name,
  enabled = true,
  className,
  fit = "contain",
}: {
  path: string;
  lastModified?: number;
  name: string;
  /** Off until the card scrolls near view, so a long folder is not decoded at once. */
  enabled?: boolean;
  className?: string;
  fit?: "contain" | "cover";
}) {
  const key = `${path}|${lastModified ?? 0}`;
  const [url, setUrl] = useState<string | null>(() => loaded.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || loaded.has(key)) {
      return;
    }
    let cancelled = false;
    fetchThumbnail(path, key)
      .then((next) => {
        if (!cancelled) setUrl(next);
      })
      .catch((error: unknown) => {
        console.warn("[media] no thumbnail for", name, error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, name, path]);

  const shown = url ?? loaded.get(key) ?? null;
  if (shown) {
    return (
      <img
        src={shown}
        alt={name}
        draggable={false}
        className={cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-label={failed ? `${name}: no preview` : `${name}: loading preview`}
      className={cn("flex h-full w-full items-center justify-center bg-black text-white/40", className)}
    >
      <Video className="h-5 w-5" strokeWidth={1.6} />
    </span>
  );
}
