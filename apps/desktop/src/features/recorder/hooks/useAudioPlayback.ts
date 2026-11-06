import { useCallback, useEffect, useRef } from "react";
import {
  SILENT_DB,
  getTrackPlayback,
  type TrackMix,
} from "../../../renderer/tauri/recorder";

/** What playback needs to know about a track. */
export type PlayableTrack = {
  id: number;
  revision: number;
  /** Where the take begins on the timeline, in seconds. */
  start: number;
  seconds: number;
  mix: TrackMix;
};

type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
  mono: boolean;
};

/**
 * The fader as a multiplier, with the track's mute and the session's solo.
 * A mono take is lifted by √2 so it is as loud in the middle as it was
 * recorded: the same law export uses (`recorder_strip.rs`, `pan_frame`).
 */
export function trackGain(mix: TrackMix, anySolo: boolean, mono: boolean): number {
  if (mix.mute || (anySolo && !mix.solo) || mix.volumeDb <= SILENT_DB) return 0;
  return 10 ** (mix.volumeDb / 20) * (mono ? Math.SQRT2 : 1);
}

/**
 * Plays every track at once, each through its own gain and pan, so the
 * header's fader, pan, mute and solo are heard as they move. A track's take is
 * fetched once per revision; a new take or a smart-control change fetches it
 * again, a fader move does not.
 */
export function useAudioPlayback() {
  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<number, { revision: number; buffer: Promise<AudioBuffer | null> }>());
  const voices = useRef(new Map<number, Voice>());
  /** The context time the timeline position `seconds` was heard at. */
  const origin = useRef<{ ctxTime: number; seconds: number } | null>(null);
  const epoch = useRef(0);

  const context = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext({ latencyHint: "interactive" });
    }
    return ctxRef.current;
  }, []);

  const bufferFor = useCallback(
    (track: PlayableTrack) => {
      const known = buffers.current.get(track.id);
      if (known && known.revision === track.revision) return known.buffer;
      const ctx = context();
      const buffer = getTrackPlayback(track.id)
        .then((bytes) => ctx.decodeAudioData(bytes.slice(0)))
        .catch((): null => null);
      buffers.current.set(track.id, { revision: track.revision, buffer });
      return buffer;
    },
    [context],
  );

  /** Forget a track's take, so the next play fetches it again. */
  const invalidate = useCallback((trackId?: number) => {
    if (trackId == null) buffers.current.clear();
    else buffers.current.delete(trackId);
  }, []);

  const stop = useCallback(() => {
    epoch.current += 1;
    origin.current = null;
    for (const voice of voices.current.values()) {
      voice.source.onended = null;
      try {
        voice.source.stop();
      } catch {
        // Already stopped.
      }
      voice.source.disconnect();
      voice.gain.disconnect();
      voice.panner.disconnect();
    }
    voices.current.clear();
  }, []);

  /**
   * Play `tracks` from `from` seconds. Resolves true once sound is scheduled,
   * false when there is nothing to hear (the transport then keeps time on
   * its own) or a newer play or stop took over.
   */
  const play = useCallback(
    async (from: number, tracks: PlayableTrack[]): Promise<boolean> => {
      stop();
      const mine = epoch.current;
      const ctx = context();
      if (ctx.state === "suspended") await ctx.resume().catch((): undefined => undefined);
      const recorded = tracks.filter((track) => track.seconds > 0 && track.start + track.seconds > from);
      const loaded = await Promise.all(recorded.map((track) => bufferFor(track)));
      if (epoch.current !== mine) return false;
      const anySolo = tracks.some((track) => track.mix.solo);
      // A moment's lead so every track starts on the same sample.
      const at = ctx.currentTime + 0.03;
      let scheduled = false;
      recorded.forEach((track, index) => {
        const buffer = loaded[index];
        if (!buffer) return;
        const into = from - track.start;
        if (into >= buffer.duration) return;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const mono = buffer.numberOfChannels === 1;
        const gain = ctx.createGain();
        gain.gain.value = trackGain(track.mix, anySolo, mono);
        const panner = ctx.createStereoPanner();
        panner.pan.value = track.mix.pan;
        source.connect(gain).connect(panner).connect(ctx.destination);
        if (into >= 0) source.start(at, into);
        else source.start(at - into, 0);
        voices.current.set(track.id, { source, gain, panner, mono });
        scheduled = true;
      });
      if (scheduled) origin.current = { ctxTime: at, seconds: from };
      return scheduled;
    },
    [bufferFor, context, stop],
  );

  /** Volume, pan, mute and solo, heard now. */
  const setMixes = useCallback((tracks: { id: number; mix: TrackMix }[]) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const anySolo = tracks.some((track) => track.mix.solo);
    for (const track of tracks) {
      const voice = voices.current.get(track.id);
      if (!voice) continue;
      voice.gain.gain.setTargetAtTime(trackGain(track.mix, anySolo, voice.mono), ctx.currentTime, 0.015);
      voice.panner.pan.setTargetAtTime(track.mix.pan, ctx.currentTime, 0.015);
    }
  }, []);

  /** Where playback is on the timeline, by the audio clock. Null when not playing sound. */
  const position = useCallback((): number | null => {
    const ctx = ctxRef.current;
    const at = origin.current;
    if (!ctx || !at) return null;
    return at.seconds + Math.max(0, ctx.currentTime - at.ctxTime);
  }, []);

  useEffect(
    () => () => {
      stop();
      const ctx = ctxRef.current;
      if (ctx && ctx.state !== "closed") void ctx.close().catch((): undefined => undefined);
    },
    [stop],
  );

  return { play, stop, invalidate, setMixes, position };
}
