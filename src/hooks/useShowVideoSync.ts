"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type MediaItem =
  | {
      id: string;
      name: string;
      type: "image" | "video";
      url: string;
    }
  | null;

type VideoSettings = {
  loop: boolean;
  muted: boolean;
};

export function useShowVideoSync(params: {
  showViewMedia: MediaItem;
  activeMediaItem: MediaItem;
  videoSettings: VideoSettings;

  // ✅ controlled from Home
  shouldAutoPlay: boolean;
  onAutoPlayConsumed: () => void;
  forcePlay?: boolean;
}) {
  const {
    showViewMedia,
    activeMediaItem,
    videoSettings,
    shouldAutoPlay,
    onAutoPlayConsumed,
    forcePlay = false,
  } = params;

  const showVideoRef = useRef<HTMLVideoElement>(null);
  const isProgrammaticPlayRef = useRef(false);

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);

  // Reset video state & handle autoplay when OUTPUT media changes
  const prevMediaIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const currentId = activeMediaItem?.id;

    if (currentId && currentId !== prevMediaIdRef.current) {
      setVideoCurrentTime(0);

      // Autoplay if requested and output is video
      if (shouldAutoPlay && activeMediaItem?.type === "video") {
        setIsVideoPlaying(true);
        onAutoPlayConsumed();
      } else {
        // Only reset playing if we've switched to a different media item
        setIsVideoPlaying(false);
      }

      prevMediaIdRef.current = currentId;
    } else if (!currentId && prevMediaIdRef.current) {
      // Cleared media
      setIsVideoPlaying(false);
      setVideoCurrentTime(0);
      prevMediaIdRef.current = undefined;
    }
  }, [
    activeMediaItem?.id,
    activeMediaItem?.type,
    shouldAutoPlay,
    onAutoPlayConsumed,
  ]);

  const effectiveIsVideoPlaying = forcePlay || isVideoPlaying;

  // Sync Show view video element with isVideoPlaying
  useEffect(() => {
    if (showVideoRef.current && showViewMedia?.type === "video") {
      isProgrammaticPlayRef.current = true;

      if (effectiveIsVideoPlaying) {
        showVideoRef.current.play().catch(() => {
          // autoplay may be blocked
          isProgrammaticPlayRef.current = false;
        });
      } else {
        showVideoRef.current.pause();
      }

      setTimeout(() => {
        isProgrammaticPlayRef.current = false;
      }, 100);
    }
  }, [effectiveIsVideoPlaying, showViewMedia?.type]);

  const handleVideoPlay = useCallback(() => {
    if (!isProgrammaticPlayRef.current) setIsVideoPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    if (!isProgrammaticPlayRef.current) setIsVideoPlaying(false);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  const handleVideoSeeked = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      setVideoCurrentTime(e.currentTarget.currentTime);
    },
    [],
  );

  return {
    showVideoRef,
    isVideoPlaying: effectiveIsVideoPlaying,
    videoCurrentTime,

    handleVideoPlay,
    handleVideoPause,
    handleVideoEnded,
    handleVideoSeeked,
  };
}
