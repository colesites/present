"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MediaItem, VideoSettings } from "../features/media/hooks/useMediaFolders";

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
    shouldAutoPlay,
    onAutoPlayConsumed,
    forcePlay = false,
  } = params;

  const showVideoRef = useRef<HTMLVideoElement>(null);
  const isProgrammaticPlayRef = useRef(false);

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);

  const [prevMediaId, setPrevMediaId] = useState(activeMediaItem?.id);
  if (activeMediaItem?.id !== prevMediaId) {
    setPrevMediaId(activeMediaItem?.id);
    setVideoCurrentTime(0);

    if (activeMediaItem?.id) {
      if (shouldAutoPlay && activeMediaItem?.type === "video") {
        setIsVideoPlaying(true);
        onAutoPlayConsumed();
      } else {
        setIsVideoPlaying(false);
      }
    } else {
      setIsVideoPlaying(false);
    }
  }

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
