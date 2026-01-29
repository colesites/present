"use client";

import { useEffect, useRef } from "react";

type MediaItem =
  | {
      id: string;
      name: string;
      type: "image" | "video";
      url: string; // blob url in main app
    }
  | null
  | undefined;

type VideoSettings = {
  loop: boolean;
  muted: boolean;
};

type Params = {
  activeMediaItem: MediaItem;
  showText: boolean;
  showMedia: boolean;

  videoSettings: VideoSettings;
  mediaFilterCSS: string;

  isVideoPlaying: boolean;
  videoCurrentTime: number;
};

export function useOutputBroadcast({
  activeMediaItem,
  showText,
  showMedia,
  videoSettings,
  mediaFilterCSS,
  isVideoPlaying,
  videoCurrentTime,
}: Params) {
  const mediaCacheRef = useRef<{ id: string; blob: Blob } | null>(null);

  // 1. Handle full media updates - send Blob directly (fast, no conversion)
  useEffect(() => {
    const channel = new BroadcastChannel("present-output");
    let isCancelled = false;

    async function sendMediaUpdate() {
      let mediaBlob: Blob | null = null;
      let mediaId: string | null = null;
      let mediaName: string | null = null;
      let mediaType: "image" | "video" | null = null;

      if (activeMediaItem) {
        // Use cache if it's the same item
        if (mediaCacheRef.current?.id === activeMediaItem.id) {
          mediaBlob = mediaCacheRef.current.blob;
          mediaId = activeMediaItem.id;
          mediaName = activeMediaItem.name;
          mediaType = activeMediaItem.type;
        } else {
          try {
            // Fetch the blob from the blob URL (fast, no conversion)
            const response = await fetch(activeMediaItem.url);
            const blob = await response.blob();
            mediaCacheRef.current = { id: activeMediaItem.id, blob };
            mediaBlob = blob;
            mediaId = activeMediaItem.id;
            mediaName = activeMediaItem.name;
            mediaType = activeMediaItem.type;
          } catch (e) {
            console.error("Failed to fetch blob from URL", e);
          }
        }
      } else {
        mediaCacheRef.current = null;
      }

      if (!isCancelled) {
        channel.postMessage({
          type: "media-update",
          mediaBlob, // Send Blob directly (structured clone)
          mediaId,
          mediaName,
          mediaType,
          showText,
          showMedia,
          videoSettings,
          mediaFilterCSS,
          isVideoPlaying,
          videoCurrentTime,
        });
      }
    }

    sendMediaUpdate();

    return () => {
      isCancelled = true;
      channel.close();
    };
  }, [
    activeMediaItem?.id,
    showText,
    showMedia,
    videoSettings,
    mediaFilterCSS,
    isVideoPlaying,
    videoCurrentTime,
  ]);
}
