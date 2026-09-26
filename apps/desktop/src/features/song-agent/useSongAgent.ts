"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { LibraryItem } from "../../shared/types";
import { useSpeechRecognition } from "../scripture/hooks/useSpeechRecognition";
import { useSongAgentStore } from "./songAgentStore";
import {
  buildSongIndex,
  confidentSong,
  createFollower,
  createHeardWords,
  findSongs,
  followSong,
} from "./song-match.mjs";

interface UseSongAgentOptions {
  libraryItems: LibraryItem[];
  /** The songs in the open service, which win a close call. */
  serviceSongIds: string[];
  /** The slide on screen, when it is a song's. */
  live: { libraryId: string | null; index: number } | null;
  showSlide: (libraryId: string, slideIndex: number, text: string) => Promise<void> | void;
  openSong: (libraryId: string) => void;
  sessionToken: string | null;
  lang: string;
  inputDeviceId: string | null;
  /** Move the song on screen along as it is sung. On unless set off. */
  follow?: boolean;
  /** Say when another song from the library is being sung. On unless set off. */
  suggest?: boolean;
}

/** How often, at most, a half-heard line is searched for in the library. */
const IDENTIFY_EVERY_MS = 1500;
/** How long a suggestion stays once the song stops being heard. */
const SUGGESTION_FOR_MS = 20_000;
/** How long a dismissed song isn't suggested again. */
const DISMISSED_FOR_MS = 60_000;

const labelOf = (item: LibraryItem | undefined, index: number) =>
  item?.slides[index]?.label?.trim() || null;

/**
 * The song agent: while it is on, it listens to the singing, moves the song
 * on screen along slide by slide, and when the band is singing another song
 * from the library, says which and waits for the operator to show it.
 *
 * Listening is the Bible agent's (AssemblyAI, through `useSpeechRecognition`)
 * on the "song" allowance, which Pro and Power include. What was heard is
 * matched on this computer, against the library it already holds.
 */
export function useSongAgent(options: UseSongAgentOptions) {
  const enabled = useSongAgentStore((state) => state.enabled);
  const setEnabled = useSongAgentStore((state) => state.setEnabled);
  const publish = useSongAgentStore((state) => state.publish);
  const setActions = useSongAgentStore((state) => state.setActions);

  const songs = useMemo(
    () =>
      options.libraryItems.filter(
        (item) => item.type !== "scripture" && !item.deleted && item.slides.length > 0,
      ),
    [options.libraryItems],
  );
  // Built only while it is on: a large library is worth indexing once, not
  // on every autosave while nobody is listening.
  const index = useMemo(
    () =>
      enabled
        ? buildSongIndex(
            songs.map((item) => ({
              id: String(item._id),
              title: item.title,
              slides: item.slides.map((slide) => ({ text: slide.text, label: slide.label })),
            })),
          )
        : null,
    [enabled, songs],
  );
  const lookup = useMemo(() => {
    const position = new Map<string, number>();
    const byId = new Map<string, LibraryItem>();
    songs.forEach((item, at) => {
      position.set(String(item._id), at);
      byId.set(String(item._id), item);
    });
    return { position, byId };
  }, [songs]);

  const [follower] = useState(createFollower);
  const [heard] = useState(() => createHeardWords());
  const lastSearchAt = useRef(0);
  const suggestedAt = useRef(0);
  const dismissed = useRef<{ songId: string; until: number } | null>(null);

  // What the speech callback reads, as of the last render.
  const latest = useRef({ options, index, lookup });
  useEffect(() => {
    latest.current = { options, index, lookup };
  });

  const onResult = useCallback(
    ({ transcript, isFinal }: { transcript: string; isFinal: boolean }) => {
      const { options: current, index: songIndex, lookup: songs } = latest.current;
      if (!songIndex) return;
      heard.hear(transcript, isFinal);
      const words = heard.words();
      const now = Date.now();

      // The song on screen, followed slide by slide.
      const liveId = current.live?.libraryId ?? null;
      const livePosition = liveId ? songs.position.get(liveId) : undefined;
      if (current.follow !== false && liveId && livePosition !== undefined && current.live) {
        const next = follower.step({
          slides: songIndex.slidePairs[livePosition],
          words,
          currentIndex: current.live.index,
          now,
        });
        const item = songs.byId.get(liveId);
        const slide = next !== null ? item?.slides[next] : undefined;
        if (next !== null && item && slide) {
          void current.showSlide(liveId, next, slide.text);
          publish({ following: { title: item.title, label: labelOf(item, next) } });
        }
      }

      // Another song? Asked of the whole library at the end of each line,
      // and now and then mid-line.
      if (current.suggest === false) {
        if (useSongAgentStore.getState().suggestion) publish({ suggestion: null });
        return;
      }
      if (!isFinal && now - lastSearchAt.current < IDENTIFY_EVERY_MS) return;
      lastSearchAt.current = now;
      const best = confidentSong(
        findSongs(songIndex, words, { prefer: new Set(current.serviceSongIds) }),
      );
      const { suggestion } = useSongAgentStore.getState();
      if (!best) {
        if (suggestion && now - suggestedAt.current > SUGGESTION_FOR_MS) publish({ suggestion: null });
        return;
      }
      const song = songIndex.songs[best.songIndex];
      if (song.id === liveId) {
        if (suggestion) publish({ suggestion: null });
        return;
      }
      // Still the song on screen, as far as its own words go: stay with it.
      if (livePosition !== undefined && current.live) {
        const own = followSong(songIndex.slidePairs[livePosition], words, current.live.index);
        if (own && own.hits >= 2) return;
      }
      if (dismissed.current && dismissed.current.songId === song.id && now < dismissed.current.until) return;
      suggestedAt.current = now;
      if (suggestion?.songId === song.id && suggestion.slideIndex === best.slideIndex) return;
      publish({
        suggestion: {
          songId: song.id,
          title: song.title,
          label: song.slides[best.slideIndex]?.label?.trim() || null,
          slideIndex: best.slideIndex,
        },
      });
    },
    [follower, heard, publish],
  );

  const keyterms = useMemo(
    () =>
      options.serviceSongIds
        .map((id) => lookup.byId.get(id)?.title.trim())
        .filter((title): title is string => Boolean(title))
        .slice(0, 20),
    [lookup, options.serviceSongIds],
  );

  const speech = useSpeechRecognition({
    onResult,
    sessionToken: options.sessionToken,
    lang: options.lang,
    inputDeviceId: options.inputDeviceId,
    usageSource: "song",
    keyterms,
  });
  const { startListening, stopListening } = speech;

  // On and off follow the operator's switch, once each way.
  const started = useRef(false);
  const reachedListening = useRef(false);
  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      reachedListening.current = false;
      heard.clear();
      follower.reset();
      void startListening();
    } else if (!enabled && started.current) {
      started.current = false;
      stopListening();
    }
  }, [enabled, follower, heard, startListening, stopListening]);

  useEffect(
    () => () => {
      if (started.current) stopListening();
    },
    [stopListening],
  );

  // Its state for the control, and off again when listening stops by
  // itself: it could not start, the allowance ran out, or the connection went.
  useEffect(() => {
    if (speech.isListening) reachedListening.current = true;
    publish({ status: speech.isStarting ? "starting" : speech.isListening ? "listening" : "off" });
    if (!enabled || !started.current || speech.isListening || speech.isStarting) return;
    if (!speech.error && !reachedListening.current) return;
    started.current = false;
    setEnabled(false);
    if (speech.error) {
      publish({ error: speech.error });
      toast.error(speech.error);
    }
  }, [enabled, publish, setEnabled, speech.error, speech.isListening, speech.isStarting]);

  // Where it is in the song on screen, as that changes.
  const liveId = options.live?.libraryId ?? null;
  const liveIndex = options.live?.index ?? -1;
  useEffect(() => {
    if (!enabled) return;
    const item = liveId ? lookup.byId.get(liveId) : undefined;
    publish({ following: item ? { title: item.title, label: labelOf(item, liveIndex) } : null });
  }, [enabled, liveId, liveIndex, lookup, publish]);

  useEffect(() => {
    setActions({
      accept: () => {
        const { suggestion } = useSongAgentStore.getState();
        if (!suggestion) return;
        const { options: current, lookup: songs } = latest.current;
        const item = songs.byId.get(suggestion.songId);
        const slide = item?.slides[suggestion.slideIndex];
        publish({ suggestion: null });
        if (!item || !slide) return;
        follower.reset();
        current.openSong(suggestion.songId);
        void current.showSlide(suggestion.songId, suggestion.slideIndex, slide.text);
      },
      dismiss: () => {
        const { suggestion } = useSongAgentStore.getState();
        if (suggestion) {
          dismissed.current = { songId: suggestion.songId, until: Date.now() + DISMISSED_FOR_MS };
        }
        publish({ suggestion: null });
      },
    });
    return () => setActions(null);
  }, [follower, publish, setActions]);
}
