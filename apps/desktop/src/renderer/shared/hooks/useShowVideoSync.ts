"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaItem, VideoSettings } from "../../../features/media/hooks/useMediaFolders";
import { applyAudioRouting, useAudioRouting } from "./useAudioRouting";
import { usePlaybackTransport } from "./usePlaybackTransport";
import { positionForVideo } from "../../../shared/lib/mirror-video-sync.mjs";
import { isOperatorPause, shouldResume } from "../../../shared/lib/show-video-pause.mjs";

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
  /**
   * When the operator last touched the player: a click or a key on it, or a
   * media key. A pause that follows one is theirs; one that does not is the
   * system's, and is not a reason to stop the video on every screen.
   */
  const operatorTouchedAtRef = useRef(Number.NEGATIVE_INFINITY);
  /** When the operator last paused, so it is not undone as a stray pause. */
  const operatorPausedAtRef = useRef(Number.NEGATIVE_INFINITY);

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
    mediaId: currentVideoItem?.id ?? null,
    playing: isVideoPlaying,
    positionSeconds: videoCurrentTime,
    durationSeconds: null,
    positionSampledAtMs: null,
  });

  const effectiveIsVideoPlaying = forcePlay || transport.playing;
  const effectiveVideoTime = transport.positionSeconds;

  // Whose position the transport is holding (`mirror-video-sync.mjs`): until
  // Rust confirms the item on screen, the answer is the beginning, or a video
  // chosen again would be seeked to where the last one had got to.
  const followed = positionForVideo({
    transportMediaId: transport.mediaId,
    videoId: currentVideoItem?.id ?? null,
    positionSeconds: transport.positionSeconds,
    sampledAtMs: transport.positionSampledAtMs,
  });
  const positionIsForThisVideo =
    !currentVideoItem || transport.mediaId === currentVideoItem.id;

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
        positionIsForThisVideo &&
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
  }, [
    currentVideoItem?.id,
    currentVideoItem?.type,
    effectiveIsVideoPlaying,
    positionIsForThisVideo,
  ]);

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
      // Not the operator: this hook's own pause; the end of a video that does
      // not loop, which the transport hears as `ended`; a hidden window, which
      // WebKit pauses and resumes itself; or a pause nobody asked for. WebKit
      // pauses the player when the computer sleeps, with the window still
      // showing. Taken as the operator's, that paused the video on every
      // screen, and the pause this hook then made to match stopped WebKit
      // resuming it on waking, so the service woke with its video stopped.
      const now = performance.now();
      if (
        !isOperatorPause({
          nowMs: now,
          touchedAtMs: operatorTouchedAtRef.current,
          programmatic: isProgrammaticPlayRef.current,
          ended: Boolean(event?.currentTarget.ended),
          hidden: document.visibilityState === "hidden",
        })
      ) {
        return;
      }
      operatorPausedAtRef.current = now;
      setIsVideoPlaying(false);
      transport.pause();
    },
    [transport],
  );

  // What counts as the operator touching the player.
  useEffect(() => {
    const video = showVideoRef.current;
    if (!video || currentVideoItem?.type !== "video") return;
    const touched = () => {
      operatorTouchedAtRef.current = performance.now();
    };
    video.addEventListener("pointerdown", touched, true);
    video.addEventListener("keydown", touched, true);
    return () => {
      video.removeEventListener("pointerdown", touched, true);
      video.removeEventListener("keydown", touched, true);
    };
  }, [currentVideoItem?.id, currentVideoItem?.type]);

  // The keyboard's play and pause keys, and the Now Playing controls, are the
  // operator too. Without these, WebKit pauses the player for them itself,
  // which looks like the system.
  useEffect(() => {
    const video = showVideoRef.current;
    const session = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!video || !session?.setActionHandler || currentVideoItem?.type !== "video") return;
    const handle = (action: MediaSessionAction, run: () => void) => {
      try {
        session.setActionHandler(action, () => {
          operatorTouchedAtRef.current = performance.now();
          run();
        });
      } catch {
        // This action is not supported here; WebKit handles it as before.
      }
    };
    handle("play", () => {
      video.play().catch((): void => undefined);
    });
    handle("pause", () => video.pause());
    return () => {
      for (const action of ["play", "pause"] as const) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // Nothing was set.
        }
      }
    };
  }, [currentVideoItem?.id, currentVideoItem?.type]);

  // The player follows the transport. While the video is meant to be playing,
  // a player found paused that the operator did not pause is started again:
  // once the computer wakes from sleep, or after anything else that paused it
  // without asking.
  useEffect(() => {
    if (!effectiveIsVideoPlaying || currentVideoItem?.type !== "video") return;
    const resume = () => {
      const video = showVideoRef.current;
      if (
        !video ||
        !shouldResume({
          nowMs: performance.now(),
          transportPlaying: true,
          paused: video.paused,
          ended: video.ended,
          seeking: video.seeking,
          hidden: document.visibilityState === "hidden",
          operatorPausedAtMs: operatorPausedAtRef.current,
        })
      ) {
        return;
      }
      isProgrammaticPlayRef.current = true;
      video.play().catch((): void => undefined);
      window.setTimeout(() => {
        isProgrammaticPlayRef.current = false;
      }, 100);
    };
    const intervalId = window.setInterval(resume, 1000);
    window.addEventListener("focus", resume);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", resume);
    };
  }, [currentVideoItem?.id, currentVideoItem?.type, effectiveIsVideoPlaying]);

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
    // The beginning, until Rust confirms this item — so the audience screen,
    // the preview and the stream never seek to where a different video was.
    videoCurrentTime: followed.positionSeconds,
    videoTimeSampledAtMs: followed.sampledAtMs,

    handleVideoPlay,
    handleVideoPause,
    handleVideoEnded,
    handleVideoSeeked,
    handleVideoTimeUpdate,
    toggleVideoPlayback,
  };
}
