"use client";

import { useEffect, useRef, useState } from "react";
import { AutoFitText } from "./components/AutoFitText";
import { stripBracketsForDisplay } from "./lib/lyrics";
import { cn } from "./lib/utils";


type VideoSettings = {
  loop: boolean;
  muted: boolean;
};

type LibraryStyle = {
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
};

// State matching what useOutputBroadcast sends
type OutputState = {
  mediaUrl: string | null;
  mediaType: "image" | "video" | null;
  mediaId: string | null;
  showText: boolean;
  showMedia: boolean;
  videoSettings: VideoSettings;
  mediaFilterCSS: string;
  isVideoPlaying: boolean;
  videoCurrentTime: number;
  shouldSyncTime: boolean;
  
  // Text details
  activeSlideId: string | null;
  slideText: string | null;
  slideFooter: string | null;
  
  scriptureStyle: {
    fontSize: number;
    fontFamily: string;
    textAlign: "left" | "center" | "right";
  };
  libraryStyle: LibraryStyle;
};

export function OutputWindow() {
  const [state, setState] = useState<OutputState>({
    mediaUrl: null,
    mediaType: null,
    mediaId: null,
    showText: true,
    showMedia: true,
    videoSettings: { loop: true, muted: true },
    mediaFilterCSS: "",
    isVideoPlaying: false,
    videoCurrentTime: 0,
    shouldSyncTime: false,
    activeSlideId: null,
    slideText: null,
    slideFooter: null,
    scriptureStyle: {
      fontSize: 72,
      fontFamily: "Inter",
      textAlign: "center"
    },
    libraryStyle: {
      fontFamily: "Inter",
      fontSize: 72,
      fontBold: false,
      fontItalic: false,
      fontUnderline: false,
    }
  });

  const videoRef = useRef<HTMLVideoElement>(null);

  // Listen to IPC messages from main window (relayed through main process)
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onOutputData((data: unknown) => {
      const msg = data as Record<string, unknown>;
      
      if (msg.type === "media-update") {
        setState(prev => ({
          ...prev,
          mediaUrl: msg.mediaUrl !== undefined ? msg.mediaUrl as string | null : prev.mediaUrl,
          mediaType: msg.mediaType !== undefined ? msg.mediaType as "image" | "video" | null : prev.mediaType,
          mediaId: msg.mediaId !== undefined ? msg.mediaId as string | null : prev.mediaId,
          showText: msg.showText as boolean,
          showMedia: msg.showMedia as boolean,
          videoSettings: msg.videoSettings as VideoSettings,
          mediaFilterCSS: msg.mediaFilterCSS as string,
          isVideoPlaying: msg.isVideoPlaying as boolean,
          videoCurrentTime: msg.videoCurrentTime as number,
          shouldSyncTime: msg.shouldSyncTime as boolean,
          scriptureStyle: msg.scriptureStyle as OutputState["scriptureStyle"],
          libraryStyle: msg.libraryStyle ? msg.libraryStyle as LibraryStyle : prev.libraryStyle,
        }));
      } 
      else if (msg.type === "active-slide") {
        setState(prev => ({
          ...prev,
          activeSlideId: msg.slideId as string | null,
          slideText: (msg.slideText as string) || null,
          slideFooter: (msg.slideFooter as string) || null
        }));
      }
      else if (msg.type === "clear") {
        setState(prev => ({
          ...prev,
          activeSlideId: null,
          slideText: null,
          slideFooter: null,
          mediaUrl: null,
          mediaType: null,
          mediaId: null
        }));
      }
    });
    
    // Tell the main window we're ready to receive state
    window.electronAPI.notifyOutputReady();
  }, []);

  // Sync video playback
  useEffect(() => {
    if (videoRef.current && state.mediaType === "video") {
      if (state.isVideoPlaying) {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.pause();
      }
      
      if (state.shouldSyncTime) {
        if (Math.abs(videoRef.current.currentTime - state.videoCurrentTime) > 0.5) {
          videoRef.current.currentTime = state.videoCurrentTime;
        }
      }
    }
  }, [state.isVideoPlaying, state.videoCurrentTime, state.shouldSyncTime, state.mediaType, state.mediaUrl]);

  // Determine if this is a scripture slide
  const isScripture = state.activeSlideId?.startsWith("scripture:") ?? false; 

  // Pick the right style based on slide type
  const textStyle = isScripture 
    ? {
        fontFamily: state.scriptureStyle.fontFamily,
        textAlign: state.scriptureStyle.textAlign as "left" | "center" | "right",
        fontWeight: "normal" as const,
        fontStyle: "normal" as const,
        textDecoration: "none" as const,
      }
    : {
        fontFamily: state.libraryStyle.fontFamily,
        textAlign: "center" as const,  // Items are always centered
        fontWeight: state.libraryStyle.fontBold ? "bold" as const : "normal" as const,
        fontStyle: state.libraryStyle.fontItalic ? "italic" as const : "normal" as const,
        textDecoration: state.libraryStyle.fontUnderline ? "underline" as const : "none" as const,
      };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex flex-col items-center justify-center">
      {/* Media Layer (Background) */}
      {state.showMedia && state.mediaUrl && (
        <div className="absolute inset-0 z-0">
          {state.mediaType === "image" ? (
            <img 
              src={state.mediaUrl} 
              alt="Background" 
              className="w-full h-full object-cover"
              style={{ filter: state.mediaFilterCSS }}
            />
          ) : state.mediaType === "video" ? (
            <video
              ref={videoRef}
              src={state.mediaUrl}
              className="w-full h-full object-cover"
              style={{ filter: state.mediaFilterCSS }}
              loop={state.videoSettings.loop}
              muted={state.videoSettings.muted}
              playsInline
            />
          ) : null}
        </div>
      )}

      {/* Text Layer (Foreground) */}
      {state.showText && state.slideText && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-[4vw]">
          <div className="flex flex-1 w-full h-full min-h-0 items-center justify-center">
            <AutoFitText
              text={stripBracketsForDisplay(state.slideText)}
              className={cn(
                "text-white leading-relaxed drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)] pointer-events-none select-none",
              )}
              style={textStyle}
              maxFontSize={
                isScripture
                  ? state.scriptureStyle.fontSize
                  : state.libraryStyle.fontSize
              }
              minScale={isScripture ? 0.3 : 0.1}
            />
          </div>
          
          {state.slideFooter && (
            <div className="mt-4 text-[2vw] font-semibold tracking-wide text-white/90 drop-shadow-md uppercase">
              {state.slideFooter}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
