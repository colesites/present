"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaItem, VideoSettings } from "../../../features/media/hooks/useMediaFolders";
import { applyAudioRouting, useAudioRouting } from "./useAudioRouting";
import { usePlaybackTransport } from "./usePlaybackTransport";

export function useShowVideoSync(params: {
  showViewMedia: MediaItem;
  activeMediaItem: MediaItem;
  videoSettings: VideoSettings;
  audioOutputDeviceId?: string | null;

  // ✅ controlled from Home
  shouldAutoPlay: boolean;
  onAutoPlayConsumed: () => void;
  forcePlay?: boolean;
}) {
  const {
    showViewMedia,
    activeMediaItem,
    videoSettings,
    audioOutputDeviceId,
    shouldAutoPlay,
    onAutoPlayConsumed,
    forcePlay = false,
  } = params;

  const showVideoRef = useRef<HTMLVideoElement>(null);
  const isProgrammaticPlayRef = useRef(false);
  const lastTimeUpdateMsRef = useRef(0);
  const showPlaybackByMediaIdRef = useRef<Record<string, boolean>>({});
  const showTimeByMediaIdRef = useRef<Record<string, number>>({});

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
    if (forcePlay || activeMediaItem?.type !== "video") {
      return;
    }
    if (activeMediaItem.id !== previousActiveMediaIdRef.current) {
      return;
    }
    showPlaybackByMediaIdRef.current[activeMediaItem.id] = isVideoPlaying;
  }, [activeMediaItem?.id, activeMediaItem?.type, forcePlay, isVideoPlaying]);

  useEffect(() => {
    if (forcePlay || activeMediaItem?.type !== "video") {
      return;
    }
    if (activeMediaItem.id !== previousActiveMediaIdRef.current) {
      return;
    }
    showTimeByMediaIdRef.current[activeMediaItem.id] = videoCurrentTime;
  }, [activeMediaItem?.id, activeMediaItem?.type, forcePlay, videoCurrentTime]);

  useEffect(() => {
    if (activeMediaItem?.id === previousActiveMediaIdRef.current) {
      return;
    }

    previousActiveMediaIdRef.current = activeMediaItem?.id ?? null;
    const restoredTime =
      activeMediaItem?.type === "video"
        ? showTimeByMediaIdRef.current[activeMediaItem.id]
        : undefined;
    setVideoCurrentTime(restoredTime ?? 0);

    if (activeMediaItem?.type === "video" && shouldAutoPlay) {
      setIsVideoPlaying(true);
      onAutoPlayConsumed();
      return;
    }

    if (
      activeMediaItem?.type === "video" &&
      showPlaybackByMediaIdRef.current[activeMediaItem.id]
    ) {
      setIsVideoPlaying(true);
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

  // The Rust transport, where there is one. It owns whether the video is
  // running and where it has got to, and it remembers both per media item -
  // behaviour that used to live in refs here and died with the component.
  //
  // Under Electron this returns the values passed in, so the shipping shell
  // keeps its own state and nothing about its timing changes.
  const transport = usePlaybackTransport({
    playing: isVideoPlaying,
    positionSeconds: videoCurrentTime,
    durationSeconds: null,
  });

  const effectiveIsVideoPlaying = forcePlay || transport.playing;
  const effectiveVideoTime = transport.positionSeconds;

  // Which item the transport is on. Rust keeps a resume point per media id, so
  // this is what makes stepping away from a video and back resume rather than
  // restart - the behaviour that used to live in two refs in this file.
  const selectPlaybackMedia = transport.selectMedia;
  useEffect(() => {
    if (currentVideoItem?.type !== "video") {
      selectPlaybackMedia(null, false);
      return;
    }
    selectPlaybackMedia(currentVideoItem.id, shouldAutoPlay);
  }, [currentVideoItem?.id, currentVideoItem?.type, selectPlaybackMedia, shouldAutoPlay]);

  // The presenter Show View is the application's only audible video player.
  // All external display windows are muted mirrors, so video audio works even
  // before a projector is opened.
  //
  // Under Tauri that sentence is no longer a convention this hook maintains:
  // the routing comes from the Rust audio graph, which refuses every surface
  // but the operator's and owns the one output device. Under Electron the
  // values below are exactly what this effect set inline before.
  const electronRouting = useMemo(
    () => ({
      audible: true,
      muted: videoSettings.muted,
      volume: videoSettings.volume,
      deviceId: audioOutputDeviceId ?? null,
    }),
    [videoSettings.muted, videoSettings.volume, audioOutputDeviceId],
  );
  const routing = useAudioRouting("presentation-video", "operator", electronRouting);

  useEffect(() => {
    const video = showVideoRef.current;
    if (!video || currentVideoItem?.type !== "video") return;

    applyAudioRouting(video, routing);
  }, [currentVideoItem?.id, currentVideoItem?.type, routing]);

  // Sync Show view video element with isVideoPlaying
  useEffect(() => {
    if (showVideoRef.current && currentVideoItem?.type === "video") {
      isProgrammaticPlayRef.current = true;
      // 0.5s, matching `OPERATOR_DRIFT_TOLERANCE` in services/playback.rs. The
      // operator's own player is corrected loosely so that scrubbing is not
      // fought; the audience mirror uses a much tighter 0.12s.
      if (
        Number.isFinite(effectiveVideoTime) &&
        Math.abs(showVideoRef.current.currentTime - effectiveVideoTime) > 0.5
      ) {
        showVideoRef.current.currentTime = effectiveVideoTime;
      }

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
  }, [currentVideoItem?.id, currentVideoItem?.type, effectiveIsVideoPlaying]);

  const handleVideoPlay = useCallback(() => {
    if (!isProgrammaticPlayRef.current) setIsVideoPlaying(true);
  }, []);

  const handleVideoPause = useCallback(() => {
    if (!isProgrammaticPlayRef.current) setIsVideoPlaying(false);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsVideoPlaying(false);
    transport.ended(videoSettings.loop);
  }, [transport, videoSettings.loop]);

  const toggleVideoPlayback = useCallback(() => {
    if (currentVideoItem?.type !== "video") {
      return;
    }
    setIsVideoPlaying((previous) => !previous);
    transport.toggle();
  }, [currentVideoItem?.type, transport]);

  const handleVideoSeeked = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const position = e.currentTarget.currentTime;
      setVideoCurrentTime(position);
      transport.seek(position);
    },
    [transport],
  );

  const handleVideoTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const now = performance.now();
      if (now - lastTimeUpdateMsRef.current < 100) {
        return;
      }
      lastTimeUpdateMsRef.current = now;
      const position = e.currentTarget.currentTime;
      setVideoCurrentTime(position);
      // An observation, not an instruction. Rust decides whether it is worth
      // telling anyone about.
      transport.reportPosition(position);
    },
    [transport],
  );

  return {
    showVideoRef,
    isVideoPlaying: effectiveIsVideoPlaying,
    videoCurrentTime: effectiveVideoTime,

    handleVideoPlay,
    handleVideoPause,
    handleVideoEnded,
    handleVideoSeeked,
    handleVideoTimeUpdate,
    toggleVideoPlayback,
  };
}
