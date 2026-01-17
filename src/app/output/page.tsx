"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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

type MediaMessage = {
  type: "media-update";
  mediaItem: {
    id: string;
    name: string;
    type: "image" | "video";
    url: string; // Will receive blob URL or data URL
  } | null;
  showText: boolean;
  showMedia: boolean;
  videoSettings: {
    loop: boolean;
    muted: boolean;
    volume: number;
  };
  mediaFilterCSS: string;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
};

type OutputMessage = ActiveSlideMessage | MediaMessage;

export default function OutputPage() {
  const { isSignedIn } = useAuth();
  const current = useQuery(api.users.getCurrentWithOrg);
  const playback = useQuery(
    api.playback.getByOrg,
    current?.org ? { orgId: current.org._id } : "skip",
  );
  const songs = useQuery(
    api.songs.listByOrg,
    current?.org ? { orgId: current.org._id } : "skip",
  );
  const [overrideSlideId, setOverrideSlideId] = useState<string | null>(null);
  const [overrideSlideText, setOverrideSlideText] = useState<string | null>(
    null,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Media state
  const [mediaItem, setMediaItem] = useState<MediaMessage["mediaItem"]>(null);
  const [showText, setShowText] = useState(true);
  const [showMedia, setShowMedia] = useState(true);
  const [videoSettings, setVideoSettings] = useState({
    loop: true,
    muted: false,
    volume: 1,
  });
  const [mediaFilterCSS, setMediaFilterCSS] = useState("none");
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const channel = new BroadcastChannel("present-output");
    const handler = (event: MessageEvent<OutputMessage>) => {
      if (event.data?.type === "active-slide") {
        setOverrideSlideId(event.data.slideId);
        setOverrideSlideText(event.data.slideText ?? null);
      } else if (event.data?.type === "media-update") {
        setMediaItem(event.data.mediaItem);
        setShowText(event.data.showText);
        setShowMedia(event.data.showMedia);
        setVideoSettings(event.data.videoSettings);
        setMediaFilterCSS(event.data.mediaFilterCSS ?? "none");
        setIsVideoPlaying(event.data.isVideoPlaying ?? false);
        setVideoCurrentTime(event.data.videoCurrentTime ?? 0);
      }
    };
    channel.addEventListener("message", handler);
    return () => {
      channel.removeEventListener("message", handler);
      channel.close();
    };
  }, []);

  // Apply video settings (always keep muted - audio comes from Show view)
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.loop = videoSettings.loop;
      // Don't set muted from videoSettings - output is always muted
      // Audio comes from the Show view on the presenter's machine
    }
  }, [videoSettings]);

  // Sync video playback with Show view
  useEffect(() => {
    if (videoRef.current && mediaItem?.type === "video") {
      if (isVideoPlaying) {
        videoRef.current.play().catch(() => {
          // Autoplay might be blocked
        });
      } else {
        videoRef.current.pause();
      }
    }
  }, [isVideoPlaying, mediaItem]);

  // Sync video position with Show view
  useEffect(() => {
    if (videoRef.current && mediaItem?.type === "video") {
      // Only seek if the difference is significant (more than 0.5 seconds)
      if (Math.abs(videoRef.current.currentTime - videoCurrentTime) > 0.5) {
        videoRef.current.currentTime = videoCurrentTime;
      }
    }
  }, [videoCurrentTime, mediaItem]);

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

  const hasContent = activeSlide || mediaItem;

  return (
    <div
      className="relative flex h-screen w-screen cursor-none select-none items-center justify-center bg-black text-white"
      onDoubleClick={toggleFullscreen}
    >
      {hasContent ? (
        <>
          {/* Media layer (background) with filters */}
          {showMedia &&
            mediaItem &&
            (mediaItem.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaItem.url}
                alt={mediaItem.name}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: mediaFilterCSS }}
              />
            ) : (
              <video
                ref={videoRef}
                src={mediaItem.url}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: mediaFilterCSS }}
                loop={videoSettings.loop}
                muted // Audio comes from Show view, not output window
                playsInline
              />
            ))}

          {/* Text layer (foreground) */}
          {showText && activeSlide && (
            <div className="relative h-full w-full p-8">
              <AutoFitText
                text={stripBracketsForDisplay(activeSlide.text)}
                className={cn(
                  "leading-relaxed text-white",
                  fontBold && "font-bold",
                  fontItalic && "italic",
                  fontUnderline && "underline",
                  // Add text shadow for better readability over media
                  mediaItem && "drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]",
                )}
                style={{ fontFamily, fontSize: `${fontSize}px` }}
                minScale={0.3}
              />
            </div>
          )}
        </>
      ) : (
        // No slide - show instructions (only visible when not projecting)
        <div className="text-center">
          <h1 className="text-4xl font-semibold text-zinc-300">
            Ready to project
          </h1>
          <p className="mt-4 text-zinc-500">
            Select a slide from the controller to display here.
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            Press <kbd className="rounded bg-zinc-800 px-2 py-1">F</kbd> or
            double-click for fullscreen
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
