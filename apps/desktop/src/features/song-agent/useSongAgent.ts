"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem } from "../../shared/types";
import { useSpeechRecognition } from "../scripture/hooks/useSpeechRecognition";
import { noteSongAgent } from "../../renderer/tauri/speech-stream";
import { useSongAgentStore } from "./songAgentStore";
import { useHearingThrough } from "./useHearingThrough";
import {
  createCatchUp,
  createFollower,
  createLibraryIndex,
  createHeardWords,
  findOtherSong,
  prepareSong,
  songKeyterms,
  versionOf,
  type HeardWord,
  type PreparedSong,
  type SongInput,
} from "./song-match.mjs";

export interface UseSongAgentOptions {
  libraryItems: LibraryItem[];
  /** The songs in the open service, in its order. */
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
  /** Say when another song is being sung. On unless set off. */
  suggest?: boolean;
  /** Put another song up by itself when it is plainly the one sung. On unless set off. */
  switchSongs?: boolean;
  /** Put the next slide up on the last word of the one showing. On unless set off. */
  ahead?: boolean;
  /** Listen a second time, through the band (`useHearingThrough`). On unless set off. */
  hearThrough?: boolean;
  /** Pick the singers' voices out of the band on this computer. On unless set off. */
  voiceFilter?: boolean;
}

/** How long the library is indexed at a time before the screen gets a turn. */
const INDEX_SLICE_MS = 8;
/** How often, at most, a half-sung line is searched for another song. */
const IDENTIFY_EVERY_MS = 500;
/** How long a suggestion stays once the song stops being heard. */
const SUGGESTION_FOR_MS = 20_000;
/**
 * How recently the song on screen must have been heard to count as still
 * being sung, when another song seems to be.
 */
const LIVE_SUNG_MS = 15_000;
/** How long after putting a song up it won't put up another. */
const SWITCHED_FOR_MS = 6000;
/** How long a dismissed song isn't suggested again. */
const DISMISSED_FOR_MS = 60_000;
/**
 * How long after the agent moves the slide it takes the move as done, even
 * if the screen hasn't said so yet.
 */
const MOVE_SETTLES_MS = 1500;

const labelOf = (item: LibraryItem | undefined, index: number) =>
  item?.slides[index]?.label?.trim() || null;

/** A slide as the control names it: its label, or its first words. */
const nameOf = (item: LibraryItem, index: number) => {
  const label = labelOf(item, index);
  if (label) return label;
  const words = (item.slides[index]?.text ?? "").split(/\s+/).filter(Boolean);
  return words.length > 4 ? `"${words.slice(0, 4).join(" ")}…"` : `"${words.join(" ")}"`;
};

const songOf = (item: LibraryItem): SongInput => ({
  id: String(item._id),
  title: item.title,
  // With its repeat marks ("x3", "Repeat"): the agent finishes a repeat
  // before it moves on, and waits for the band where one may come.
  slides: item.slides.map((slide) => ({
    text: slide.text,
    label: slide.label,
    modifier: slide.modifier ?? null,
    sectionRepeat: slide.sectionRepeat ?? null,
  })),
});

/**
 * The song agent: while it is on, it listens to the singing, moves the song
 * on screen along slide by slide, and when the band is singing another song,
 * says which and waits for the operator to show it.
 *
 * Another song is looked for in the open service first, where the song the
 * band is about to sing nearly always is, the next one in its order most of
 * all; only when none of the service's songs is being sung is the rest of the
 * library searched, and a song from there must be heard for longer.
 *
 * Listening is the Bible agent's (AssemblyAI, through `useSpeechRecognition`)
 * on the "song" allowance, which Pro and Power include, set for singing and
 * told the lines of the song on screen and the service's songs. What was
 * heard is matched on this computer (`song-match.mjs`).
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
  const lookup = useMemo(() => {
    const byId = new Map<string, LibraryItem>();
    for (const item of songs) byId.set(String(item._id), item);
    return byId;
  }, [songs]);

  const liveId = options.live?.libraryId ?? null;
  const liveIndex = options.live?.index ?? -1;
  const serviceKey = options.serviceSongIds.join(",");

  // The library, indexed while it is on: in slices of a few milliseconds,
  // so a library of thousands never holds up the screen, and only the songs
  // that changed are indexed again when the library does. Indexed all at
  // once, 5,000 songs held the screen for 2.5 s, at every autosave while it
  // listened.
  const [library] = useState(createLibraryIndex);
  useEffect(() => {
    if (!enabled) return;
    const wanted = new Set(songs.map((item) => String(item._id)));
    for (const id of [...library.songs.keys()]) if (!wanted.has(id)) library.remove(id);
    let next = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const work = () => {
      const until = performance.now() + INDEX_SLICE_MS;
      while (next < songs.length && performance.now() < until) {
        const song = songOf(songs[next]);
        const version = versionOf(song);
        if (!library.isCurrent(song.id, version)) library.set(song, version);
        next += 1;
      }
      timer = next < songs.length ? setTimeout(work, 0) : null;
    };
    work();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [enabled, library, songs]);
  const service = useMemo(() => {
    if (!enabled) return [];
    const seen = new Set<string>();
    const prepared: PreparedSong[] = [];
    for (const id of serviceKey.split(",")) {
      const item = lookup.get(id);
      if (!item || seen.has(id)) continue;
      seen.add(id);
      prepared.push(prepareSong(songOf(item)));
    }
    return prepared;
  }, [enabled, lookup, serviceKey]);
  const liveSong = useMemo(() => {
    const item = enabled && liveId ? lookup.get(liveId) : undefined;
    return item ? prepareSong(songOf(item)) : null;
  }, [enabled, liveId, lookup]);
  // The service's song after the one on screen: the likeliest to come next.
  const nextServiceId = useMemo(() => {
    const ids = service.map((song) => song.id);
    const at = liveId ? ids.indexOf(liveId) : -1;
    return ids[at + 1] ?? null;
  }, [liveId, service]);

  // Made again when "change on the last word" is switched, which is rare.
  const ahead = options.ahead !== false;
  const follower = useMemo(() => createFollower({ ahead }), [ahead]);
  /** The song on screen, where it is, and where it is expected to go next. */
  const followingOf = useCallback(
    (item: LibraryItem, song: PreparedSong | null, index: number) => {
      const next = song ? follower.expected(song, index, Date.now()) : -1;
      return {
        title: item.title,
        label: labelOf(item, index),
        next: next >= 0 && next !== index ? nameOf(item, next) : null,
      };
    },
    [follower],
  );
  const [heard] = useState(() => createHeardWords());
  // The second hearing, through the band (`useHearingThrough`): its own
  // words, and the catching up they do.
  const [heardThrough] = useState(() => createHeardWords());
  const [catchUp] = useState(createCatchUp);
  const lastSearchAt = useRef({ own: 0, through: 0 });
  const suggestedAt = useRef(0);
  const dismissed = useRef<{ songId: string; until: number } | null>(null);
  const switchedAt = useRef(-Infinity);
  // The agent's own last move, until the screen shows it.
  const moved = useRef<{ libraryId: string; index: number; at: number } | null>(null);

  // What the speech callback reads, as of the last render.
  const latest = useRef({ options, library, service, liveSong, nextServiceId, lookup });
  useEffect(() => {
    latest.current = { options, library, service, liveSong, nextServiceId, lookup };
  });

  // The slide on screen changed. If the agent didn't move it, the operator
  // did: what was heard before says nothing about where to go from there.
  useEffect(() => {
    const own = moved.current;
    if (own && own.libraryId === liveId && own.index === liveIndex) return;
    moved.current = null;
    follower.anchor(heard.count());
    catchUp.shown(heardThrough.count());
  }, [catchUp, follower, heard, heardThrough, liveId, liveIndex]);

  /**
   * The song on screen that is being followed, and the slide showing (the
   * agent's own last move until the screen shows it), or null while the
   * agent is putting up another song.
   */
  const following = useCallback((now: number) => {
    const { options: current, liveSong: song } = latest.current;
    const live = current.live;
    const own = moved.current;
    const switching = own !== null && own.libraryId !== live?.libraryId && now - own.at < MOVE_SETTLES_MS;
    if (current.follow === false || !song || live?.libraryId !== song.id || switching) return null;
    const showing = own && own.libraryId === song.id && now - own.at < MOVE_SETTLES_MS ? own.index : live.index;
    return { song, showing };
  }, []);

  /** Put up slide `to` of the song on screen, said in the log with why. */
  const moveTo = useCallback(
    (song: PreparedSong, from: number, to: number, now: number, why: string, words: HeardWord[]) => {
      const item = latest.current.lookup.get(song.id);
      const slide = item?.slides[to];
      if (!item || !slide) return false;
      moved.current = { libraryId: song.id, index: to, at: now };
      void latest.current.options.showSlide(song.id, to, slide.text);
      publish({ following: followingOf(item, song, to) });
      noteSongAgent(
        "moved",
        `${item.title}: slide ${from + 1} to ${to + 1}${why}, on "${words
          .slice(-6)
          .map((word) => word.text)
          .join(" ")}"`,
      );
      return true;
    },
    [followingOf, publish],
  );

  /**
   * Another song? Looked for at the end of each line, and now and then
   * mid-line, in either hearing's words: put up when it is plainly that
   * song, suggested when it is likely.
   */
  const lookForOtherSong = useCallback(
    (words: HeardWord[], now: number, isFinal: boolean, source: "own" | "through") => {
      const { options: current, library: index, service: serviceSongs, liveSong: song } = latest.current;
      const live = current.live;
      if (current.suggest === false) {
        if (useSongAgentStore.getState().suggestion) publish({ suggestion: null });
        return;
      }
      const { suggestion } = useSongAgentStore.getState();
      // The song it suggested is up: it has been taken, one way or another.
      if (suggestion && suggestion.songId === live?.libraryId) publish({ suggestion: null });
      if (!isFinal && now - lastSearchAt.current[source] < IDENTIFY_EVERY_MS) return;
      lastSearchAt.current[source] = now;
      const best = findOtherSong(words, {
        live: song,
        service: serviceSongs,
        nextServiceId: latest.current.nextServiceId,
        library: index,
        liveSung: song !== null && now - follower.heardSongAt() < LIVE_SUNG_MS,
      });
      if (!best) {
        if (suggestion && now - suggestedAt.current > SUGGESTION_FOR_MS) publish({ suggestion: null });
        return;
      }
      if (dismissed.current && dismissed.current.songId === best.song.id && now < dismissed.current.until) {
        return;
      }
      // Plainly that song: up it goes, at the slide being sung, and the
      // follower takes it from there.
      const sure = best.sure && current.switchSongs !== false && now - switchedAt.current > SWITCHED_FOR_MS;
      const found = latest.current.lookup.get(best.song.id);
      const foundSlide = found?.slides[best.slide];
      if (sure && found && foundSlide) {
        switchedAt.current = now;
        moved.current = { libraryId: best.song.id, index: best.slide, at: now };
        follower.begin(heard.count(), now);
        catchUp.shown(heardThrough.count());
        if (suggestion) publish({ suggestion: null });
        current.openSong(best.song.id);
        void current.showSlide(best.song.id, best.slide, foundSlide.text);
        publish({ following: followingOf(found, best.song, best.slide) });
        noteSongAgent(
          "switched",
          `${best.song.title}, slide ${best.slide + 1} (${best.from}${source === "through" ? ", heard through the band" : ""}), on "${words
            .slice(-6)
            .map((word) => word.text)
            .join(" ")}"`,
        );
        return;
      }
      suggestedAt.current = now;
      if (suggestion?.songId === best.song.id && suggestion.slideIndex === best.slide) return;
      const item = latest.current.lookup.get(best.song.id);
      publish({
        suggestion: {
          songId: best.song.id,
          title: best.song.title,
          label: labelOf(item, best.slide),
          slideIndex: best.slide,
        },
      });
      if (suggestion?.songId !== best.song.id) {
        noteSongAgent("suggested", `${best.song.title}, slide ${best.slide + 1}`);
      }
    },
    [catchUp, follower, followingOf, heard, heardThrough, publish],
  );

  const onResult = useCallback(
    ({
      transcript,
      isFinal,
      session,
      turn,
    }: {
      transcript: string;
      isFinal: boolean;
      session?: number;
      turn?: number;
    }) => {
      if (!useSongAgentStore.getState().enabled) return;
      heard.hear(transcript, isFinal, turn === undefined ? null : `${session ?? 0}:${turn}`);
      if (isFinal) noteSongAgent("heard", transcript);
      const words = heard.words();
      const now = Date.now();

      // The song on screen, followed slide by slide, the moment a word is sung.
      const at = following(now);
      if (at) {
        const { song, showing } = at;
        const next = follower.step({ song, heard: words, currentIndex: showing, now });
        // "One more time", "to the bridge": where it now expects to go.
        const call = follower.takeCall();
        const item = latest.current.lookup.get(song.id);
        if (call && item) {
          publish({ following: followingOf(item, song, next ?? showing) });
          noteSongAgent("called", `"${call.said}": ${item.title}, slide ${call.slide + 1}`);
        }
        if (next !== null && moveTo(song, showing, next, now, "", words)) {
          catchUp.shown(heardThrough.count());
        }
      }
      lookForOtherSong(words, now, isFinal, "own");
    },
    [catchUp, follower, following, followingOf, heard, heardThrough, lookForOtherSong, moveTo, publish],
  );

  // The words heard through the band: later, but right. They move the slide
  // on when the agent's own hearing missed the words that would have, and
  // find songs it couldn't make out.
  const onHeardThrough = useCallback(
    ({ transcript, isFinal, turn }: { transcript: string; isFinal: boolean; turn: number | null }) => {
      if (!useSongAgentStore.getState().enabled) return;
      heardThrough.hear(transcript, isFinal, turn === null ? null : `through:${turn}`);
      if (isFinal) noteSongAgent("heard through", transcript);
      const words = heardThrough.words();
      const now = Date.now();
      const at = following(now);
      if (at) {
        const { song, showing } = at;
        const next = catchUp.step({ song, heard: words, currentIndex: showing, now });
        if (next !== null && moveTo(song, showing, next, now, " (heard through the band)", words)) {
          follower.adopt(song, showing, next, now, heard.count());
          catchUp.shown(heardThrough.count());
        }
      }
      lookForOtherSong(words, now, isFinal, "through");
    },
    [catchUp, follower, following, heard, heardThrough, lookForOtherSong, moveTo],
  );

  // What the service is told to listen for: the lines of the song on
  // screen, then of the service's next song, then of the rest of the service.
  const keyterms = useMemo(() => {
    const ordered: SongInput[] = [];
    const add = (id: string | null) => {
      const item = id ? lookup.get(id) : undefined;
      if (item && !ordered.some((song) => song.id === id)) ordered.push(songOf(item));
    };
    add(liveId);
    add(nextServiceId);
    for (const id of serviceKey.split(",")) add(id);
    return songKeyterms(ordered);
  }, [liveId, lookup, nextServiceId, serviceKey]);

  const speech = useSpeechRecognition({
    onResult,
    sessionToken: options.sessionToken,
    lang: options.lang,
    inputDeviceId: options.inputDeviceId,
    usageSource: "song",
    keyterms,
    singing: true,
    voiceFilter: options.voiceFilter !== false,
  });
  const { startListening, stopListening } = speech;

  useHearingThrough({
    active: enabled && speech.isListening && options.hearThrough !== false,
    inputDeviceId: options.inputDeviceId,
    keyterms,
    onTurn: onHeardThrough,
  });

  // On and off follow the operator's switch, once each way.
  const started = useRef(false);
  const reachedListening = useRef(false);
  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      reachedListening.current = false;
      heard.clear();
      heardThrough.clear();
      follower.reset();
      catchUp.reset();
      moved.current = null;
      void startListening();
    } else if (!enabled && started.current) {
      started.current = false;
      stopListening();
    }
  }, [catchUp, enabled, follower, heard, heardThrough, startListening, stopListening]);

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
      // Already said in a toast by `useSpeechRecognition`, in plain words.
      publish({ error: speech.error });
    }
  }, [enabled, publish, setEnabled, speech.error, speech.isListening, speech.isStarting]);

  // Where it is in the song on screen, as that changes.
  useEffect(() => {
    if (!enabled) return;
    const item = liveId ? lookup.get(liveId) : undefined;
    publish({ following: item ? followingOf(item, liveSong, liveIndex) : null });
  }, [enabled, followingOf, liveId, liveIndex, liveSong, lookup, publish]);

  useEffect(() => {
    setActions({
      accept: () => {
        const { suggestion } = useSongAgentStore.getState();
        if (!suggestion) return;
        const { options: current, lookup: byId } = latest.current;
        const item = byId.get(suggestion.songId);
        const slide = item?.slides[suggestion.slideIndex];
        publish({ suggestion: null });
        if (!item || !slide) return;
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
  }, [publish, setActions]);
}
