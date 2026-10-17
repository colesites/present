"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MediaItem, VideoSettings } from "../../../features/media/hooks/useMediaFolders";
import { usePlaybackTransport } from "./usePlaybackTransport";
import { positionForVideo } from "../../../shared/lib/mirror-video-sync.mjs";

const audioCore = () => import("../../tauri/audio");

/**
 * The live video's transport, as the operator window drives it.
 *
 * The video's sound is played by Rust (`services/sound`): FFmpeg decodes it,
 * it goes to the audio device the graph names, and where it has got to is the
 * transport's position, which every screen follows. This window plays nothing.
 * It says which video is live and which file that is, and passes on the
 * operator's play, pause, seek, mute and level.
 *
 * Until 0.4.11 a `<video>` here was the sound, and the clock: a second decode
 * of the file, beside the one that draws the screens, on WebKit's clock. The
 * two drifted apart, and the sound stopped whenever WebKit paused the element
 * or the pane that held it went away.
 */
export function useShowVideoSync(params: {
  activeMediaItem: MediaItem;
  videoSettings: VideoSettings;

  // ✅ controlled from Home
  shouldAutoPlay: boolean;
  onAutoPlayConsumed: () => void;
  forcePlay?: boolean;
}) {
  const {
    activeMediaItem,
    videoSettings,
    shouldAutoPlay,
    onAutoPlayConsumed,
    forcePlay = false,
  } = params;

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  // Only the video on screen. A video the operator is only looking at — one
  // tap in the service, or the media panel — is not live: it has no sound and
  // does not move the transport, and plays in the center pane only when the
  // operator plays it there. It used to be followed when nothing else was
  // live, so one tap started its sound.
  const currentVideoItem = activeMediaItem?.type === "video" ? activeMediaItem : null;

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
    rate: 1,
  });

  const effectiveIsVideoPlaying = forcePlay || transport.playing;

  // Whose position the transport is holding (`mirror-video-sync.mjs`): until
  // Rust confirms the item on screen, the answer is the beginning, or a video
  // chosen again would be seeked to where the last one had got to.
  const followed = positionForVideo({
    transportMediaId: transport.mediaId,
    videoId: currentVideoItem?.id ?? null,
    positionSeconds: transport.positionSeconds,
    sampledAtMs: transport.positionSampledAtMs,
  });

  // Which item the transport is on, and the file whose sound Rust plays for
  // it. A different item starts from its beginning; the same one keeps its
  // place.
  const selectPlaybackMedia = transport.selectMedia;
  useEffect(() => {
    if (currentVideoItem?.type !== "video") {
      selectPlaybackMedia(null, null, false);
      return;
    }
    selectPlaybackMedia(currentVideoItem.id, currentVideoItem.url, shouldAutoPlay);
  }, [
    currentVideoItem?.id,
    currentVideoItem?.type,
    currentVideoItem?.url,
    selectPlaybackMedia,
    shouldAutoPlay,
  ]);

  // A video behind scripture or a slide always runs; it is the transport that
  // has to say so, or its sound — and the screens following it — would hold.
  const playTransport = transport.play;
  useEffect(() => {
    if (forcePlay && currentVideoItem?.type === "video" && transport.isRustOwned && !transport.playing) {
      playTransport();
    }
  }, [currentVideoItem?.type, forcePlay, playTransport, transport.isRustOwned, transport.playing]);

  // The preview's mute button and level are the video's level in the audio
  // graph, which the sound follows.
  useEffect(() => {
    void audioCore()
      .then((core) => core.setAudioSourceMuted("presentation-video", videoSettings.muted))
      .catch((error: unknown) => console.error("[Audio] could not mute the video", error));
  }, [videoSettings.muted]);
  useEffect(() => {
    const volume = Number.isFinite(videoSettings.volume) ? Math.min(1, Math.max(0, videoSettings.volume)) : 1;
    void audioCore()
      .then((core) => core.setAudioSourceGain("presentation-video", volume))
      .catch((error: unknown) => console.error("[Audio] could not set the video's level", error));
  }, [videoSettings.volume]);

  const toggleVideoPlayback = useCallback(() => {
    if (currentVideoItem?.type !== "video") {
      return;
    }
    setIsVideoPlaying((previous) => !previous);
    transport.toggle();
  }, [currentVideoItem?.type, transport]);

  const playLive = useCallback(() => {
    if (currentVideoItem?.type !== "video") return;
    setIsVideoPlaying(true);
    transport.play();
  }, [currentVideoItem?.type, transport]);

  const pauseLive = useCallback(() => {
    if (currentVideoItem?.type !== "video") return;
    setIsVideoPlaying(false);
    transport.pause();
  }, [currentVideoItem?.type, transport]);

  // The speed is kept from video to video (`services/playback.rs`), so it is
  // set with no video live as well: the next one starts at it.
  const setRateLive = useCallback(
    (rate: number) => {
      if (!Number.isFinite(rate)) return;
      transport.setRate(rate);
    },
    [transport],
  );

  const seekLive = useCallback(
    (position: number) => {
      if (currentVideoItem?.type !== "video" || !Number.isFinite(position)) return;
      setVideoCurrentTime(position);
      transport.seek(position);
    },
    [currentVideoItem?.type, transport],
  );

  return {
    /** The video on screen, whose sound Rust plays. */
    liveVideoItem: currentVideoItem,
    playLive,
    pauseLive,
    seekLive,
    setRateLive,
    /** How fast the live video plays: 1 as recorded. */
    videoRate: transport.rate,
    isVideoPlaying: effectiveIsVideoPlaying,
    // The beginning, until Rust confirms this item — so the audience screen,
    // the preview and the stream never seek to where a different video was.
    videoCurrentTime: followed.positionSeconds,
    videoTimeSampledAtMs: followed.sampledAtMs,
    toggleVideoPlayback,
  };
}
