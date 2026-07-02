"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MediaItem, VideoSettings } from "../../../features/media/hooks/useMediaFolders";

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
  const lastTimeUpdateMsRef = useRef(0);

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const currentVideoItem =
    activeMediaItem?.type === "video"
      ? activeMediaItem
      : showViewMedia?.type === "video"
        ? showViewMedia
        : null;

  const previousActiveMediaIdRef = useRef(activeMediaItem?.id ?? null);

  useEffect(() => {
    if (activeMediaItem?.id === previousActiveMediaIdRef.current) {
      return;
    }

    previousActiveMediaIdRef.current = activeMediaItem?.id ?? null;
    setVideoCurrentTime(0);

    if (activeMediaItem?.type === "video" && shouldAutoPlay) {
      setIsVideoPlaying(true);
      onAutoPlayConsumed();
      return;
    }

    setIsVideoPlaying(false);
  }, [
    activeMediaItem?.id,
    activeMediaItem?.type,
    onAutoPlayConsumed,
    shouldAutoPlay,
  ]);

  useEffect(() => {
    if (activeMediaItem?.type !== "video" || !shouldAutoPlay) {
      return;
    }
    setIsVideoPlaying(true);
    onAutoPlayConsumed();
  }, [activeMediaItem?.type, onAutoPlayConsumed, shouldAutoPlay]);

  const effectiveIsVideoPlaying = forcePlay || isVideoPlaying;

  // Sync Show view video element with isVideoPlaying
  useEffect(() => {
    if (showVideoRef.current && currentVideoItem?.type === "video") {
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
  }, [currentVideoItem?.type, effectiveIsVideoPlaying]);

  const handleVideoPlay = useCallback(() => {
    if (!isProgrammaticPlayRef.current) setIsVideoPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    if (!isProgrammaticPlayRef.current) setIsVideoPlaying(false);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsVideoPlaying(false);
  }, []);

  const toggleVideoPlayback = useCallback(() => {
    if (currentVideoItem?.type !== "video") {
      return;
    }
    setIsVideoPlaying((previous) => !previous);
  }, [currentVideoItem?.type]);

  const handleVideoSeeked = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      setVideoCurrentTime(e.currentTarget.currentTime);
    },
    [],
  );

  const handleVideoTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const now = performance.now();
      if (now - lastTimeUpdateMsRef.current < 250) {
        return;
      }
      lastTimeUpdateMsRef.current = now;
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
    handleVideoTimeUpdate,
    toggleVideoPlayback,
  };
}
