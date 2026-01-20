"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/AutoFitText";
import { stripBracketsForDisplay } from "@/lib/lyrics";
import { X } from "lucide-react";

type ActiveSlideMessage = {
  type: "active-slide";
  orgId: Id<"organizations">;
  slideId: string;
  slideText?: string;
  slideFooter?: string;
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

type PlaybackSyncMessage = {
  type: "playback-sync";
  isVideoPlaying: boolean;
  videoCurrentTime: number;
};

type OutputMessage = ActiveSlideMessage | MediaMessage | PlaybackSyncMessage;

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
  const [overrideSlideFooter, setOverrideSlideFooter] = useState<string | null>(
    null,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      const data = event.data;
      if (!data) return;

      if (data.type === "active-slide") {
        setOverrideSlideId(data.slideId);
        setOverrideSlideText(data.slideText ?? null);
        setOverrideSlideFooter(data.slideFooter ?? null);
      } else if (data.type === "media-update") {
        setMediaItem(data.mediaItem);
        setShowText(data.showText);
        setShowMedia(data.showMedia);
        setVideoSettings(data.videoSettings);
        setMediaFilterCSS(data.mediaFilterCSS ?? "none");
        setIsVideoPlaying(data.isVideoPlaying ?? false);
        setVideoCurrentTime(data.videoCurrentTime ?? 0);
      } else if (data.type === "playback-sync") {
        setIsVideoPlaying(data.isVideoPlaying);
        setVideoCurrentTime(data.videoCurrentTime);
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

  // Press F or F11 to toggle fullscreen, Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F" || e.key === "F11") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "Escape" && !document.fullscreenElement) {
        // Close window if Escape pressed and not in fullscreen
        window.close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleFullscreen]);

  // Show controls on mouse move, hide after 2 seconds of inactivity
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 2000);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Close the output window
  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const activeSlideId = overrideSlideId ?? playback?.activeSlideId ?? null;
  const activeSlide = useMemo(() => {
    if (overrideSlideText) {
      return { text: overrideSlideText, footer: overrideSlideFooter };
    }
    if (!activeSlideId || !songs) return null;
    const [songId, indexString] = activeSlideId.split(":");
    const song = songs.find((item) => item._id === (songId as Id<"songs">));
    if (!song) return null;
    const index = Number(indexString);
    return song.slides[index] as { text: string; footer?: string };
  }, [activeSlideId, overrideSlideText, overrideSlideFooter, songs]);

  // Font styling from playback
  const fontFamily = playback?.fontFamily ?? "Inter";
  const fontSize = playback?.fontSize ?? 72;
  const fontBold = playback?.fontBold ?? false;
  const fontItalic = playback?.fontItalic ?? false;
  const fontUnderline = playback?.fontUnderline ?? false;

  const hasContent = activeSlide || mediaItem;

  return (
    <div
      className={cn(
        "relative flex h-screen w-screen select-none items-center justify-center bg-black text-white",
        showControls ? "cursor-default" : "cursor-none",
      )}
      onDoubleClick={toggleFullscreen}
      onMouseMove={handleMouseMove}
    >
      {/* Close button - appears on mouse move */}
      <button
        type="button"
        onClick={handleClose}
        className={cn(
          "absolute right-4 top-4 z-50 rounded-full bg-black/60 p-2 text-white/80 backdrop-blur-sm transition-all hover:bg-red-600 hover:text-white",
          showControls
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-2 pointer-events-none",
        )}
        title="Close output window (Esc)"
      >
        <X className="h-5 w-5" />
      </button>

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
            <div className="relative flex h-full w-full flex-col items-center justify-center p-8">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
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
              {activeSlide.footer && (
                <div
                  className="mt-4 text-[2vh] font-semibold uppercase tracking-wide text-white/90 drop-shadow-lg"
                  style={{ fontFamily }}
                >
                  {activeSlide.footer}
                </div>
              )}
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
