"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/ui/AutoFitText";
import { stripBracketsForDisplay } from "@/lib/lyrics";

type ActiveSlideMessage = {
  type: "active-slide";
  orgId: Id<"organizations">;
  slideId: string;
  slideText?: string;
};

export default function OutputPage() {
  const { isSignedIn } = useAuth();
  const current = useQuery(api.users.getCurrentWithOrg);
  const playback = useQuery(
    api.playback.getByOrg,
    current?.org ? { orgId: current.org._id } : "skip",
  );
  const songs = useQuery(api.songs.listByOrg, current?.org ? { orgId: current.org._id } : "skip");
  const [overrideSlideId, setOverrideSlideId] = useState<string | null>(null);
  const [overrideSlideText, setOverrideSlideText] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const channel = new BroadcastChannel("present-output");
    const handler = (event: MessageEvent<ActiveSlideMessage>) => {
      if (event.data?.type === "active-slide") {
        setOverrideSlideId(event.data.slideId);
        setOverrideSlideText(event.data.slideText ?? null);
      }
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  }, []);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }, []);

  // Press F or F11 to toggle fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleFullscreen]);

  const activeSlideId = overrideSlideId ?? playback?.activeSlideId ?? null;
  const activeSlide = useMemo(() => {
    if (overrideSlideText) {
      return { text: overrideSlideText };
    }
    if (!activeSlideId || !songs) return null;
    const [songId, indexString] = activeSlideId.split(":");
    const song = songs.find((item) => item._id === (songId as Id<"songs">));
    if (!song) return null;
    const index = Number(indexString);
    return song.slides[index];
  }, [activeSlideId, overrideSlideText, songs]);

  // Font styling from playback
  const fontFamily = playback?.fontFamily ?? "Inter";
  const fontSize = playback?.fontSize ?? 72;
  const fontBold = playback?.fontBold ?? false;
  const fontItalic = playback?.fontItalic ?? false;
  const fontUnderline = playback?.fontUnderline ?? false;

  return (
    <div 
      className="flex h-screen w-screen items-center justify-center bg-black text-white cursor-none select-none"
      onDoubleClick={toggleFullscreen}
    >
      {activeSlide ? (
        // Active slide - clean output for projection with auto-fit
        <div className="h-full w-full p-8">
          <AutoFitText
            text={stripBracketsForDisplay(activeSlide.text)}
            className={cn(
              "leading-relaxed text-white",
              fontBold && "font-bold",
              fontItalic && "italic",
              fontUnderline && "underline"
            )}
            style={{ fontFamily, fontSize: `${fontSize}px` }}
            minScale={0.3}
          />
        </div>
      ) : (
        // No slide - show instructions (only visible when not projecting)
        <div className="text-center">
          <h1 className="text-4xl font-semibold text-zinc-300">Ready to project</h1>
          <p className="mt-4 text-zinc-500">
            Select a slide from the controller to display here.
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            Press <kbd className="rounded bg-zinc-800 px-2 py-1">F</kbd> or double-click for fullscreen
          </p>
          {!isFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="mt-6 rounded-md bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              Enter Fullscreen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
