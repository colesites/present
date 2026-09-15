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

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const currentVideoItem =
    activeMediaItem?.type === "video"
      ? activeMediaItem
      : showViewMedia?.type === "video"
        ? showViewMedia
        : null;

  const previousActiveMediaIdRef = useRef(activeMediaItem?.id ?? null);

  // A newly chosen video starts from the beginning (owner, 2026-09-15). This
  // used to restore where each item was left; `services/playback.rs` says why
  // it no longer does, and holds the same rule under Tauri.
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

  // The Rust transport owns whether the video is running and where it has got
  // to; the local values stand in until it answers.
  const transport = usePlaybackTransport({
    playing: isVideoPlaying,
    positionSeconds: videoCurrentTime,
    durationSeconds: null,
    positionSampledAtMs: null,
  });

  const effectiveIsVideoPlaying = forcePlay || transport.playing;
  const effectiveVideoTime = transport.positionSeconds;

  // Which item the transport is on. A different item starts from its
  // beginning; the same one keeps its place.
  const selectPlaybackMedia = transport.selectMedia;
  useEffect(() => {
    if (currentVideoItem?.type !== "video") {
      selectPlaybackMedia(null, false);
      return;
    }
    selectPlaybackMedia(currentVideoItem.id, shouldAutoPlay);
  }, [currentVideoItem?.id, currentVideoItem?.type, selectPlaybackMedia, shouldAutoPlay]);

  // The presenter Show View is the application's only audible video player.
  // The routing comes from the Rust audio graph, which refuses every surface
  // but the operator's and owns the one output device; the values below stand
  // in until it answers.
  const initialRouting = useMemo(
    () => ({
      audible: true,
      muted: videoSettings.muted,
      volume: videoSettings.volume,
      deviceId: audioOutputDeviceId ?? null,
    }),
    [videoSettings.muted, videoSettings.volume, audioOutputDeviceId],
  );
  const routing = useAudioRouting("presentation-video", "operator", initialRouting);

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

  // The element's own controls. They have to reach the transport: every player
  // follows it, so a pause that stayed in local state left the transport
  // playing and the players disagreeing about whether the video had stopped.
  const handleVideoPlay = useCallback(() => {
    if (isProgrammaticPlayRef.current) return;
    setIsVideoPlaying(true);
    transport.play();
  }, [transport]);

  const handleVideoPause = useCallback(
    (event?: React.SyntheticEvent<HTMLVideoElement>) => {
      if (isProgrammaticPlayRef.current) return;
      // The element pauses itself at the end of a video that does not loop;
      // that is `ended`, which the transport hears separately.
      if (event?.currentTarget.ended) return;
      // WebKit pauses a video itself when its window is hidden — covered by the
      // output window, minimised, or behind another app — and resumes it when
      // the window is seen again. Nobody can press pause on a hidden page, so
      // that is not the operator stopping the video.
      if (document.visibilityState === "hidden") return;
      setIsVideoPlaying(false);
      transport.pause();
    },
    [transport],
  );

  // Coming back to the window: WebKit resumes the video from where it paused
  // it, which is behind the mirrors that kept playing on another screen. Jump
  // it to where it would have got to, so the output does not follow it back.
  const hiddenAtRef = useRef<{ elementSeconds: number; atMs: number } | null>(null);
  useEffect(() => {
    const onVisibility = () => {
      const video = showVideoRef.current;
      if (!video) return;
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = effectiveIsVideoPlaying
          ? { elementSeconds: video.currentTime, atMs: Date.now() }
          : null;
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (!hiddenAt || !effectiveIsVideoPlaying) return;
      let target = hiddenAt.elementSeconds + (Date.now() - hiddenAt.atMs) / 1000;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        target = video.loop ? target % video.duration : Math.min(target, video.duration);
      }
      isProgrammaticPlayRef.current = true;
      if (Math.abs(video.currentTime - target) > 0.5) {
        video.currentTime = target;
      }
      video.play().catch((): void => undefined);
      window.setTimeout(() => {
        isProgrammaticPlayRef.current = false;
      }, 100);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [effectiveIsVideoPlaying]);

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
    videoTimeSampledAtMs: transport.positionSampledAtMs,

    handleVideoPlay,
    handleVideoPause,
    handleVideoEnded,
    handleVideoSeeked,
    handleVideoTimeUpdate,
    toggleVideoPlayback,
  };
}
