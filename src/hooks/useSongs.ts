"use client";

import { useMemo, useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { parseLyricsToSlides } from "@/lib/lyrics";
import { useCachedConvexQuery } from "./useConvexCache";
import type { Song } from "@/types";

const SONGS_CACHE_KEY = "present-songs-cache";
const SONGS_STATE_KEY = "present-songs-state";

// Load songs from localStorage for immediate display
function loadCachedSongs(): Song[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(SONGS_CACHE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// Save songs to localStorage
function saveSongsCache(songs: Song[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SONGS_CACHE_KEY, JSON.stringify(songs));
  } catch (e) {
    console.error("Failed to cache songs:", e);
  }
}

// Load song selection state
function loadSongsState() {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(SONGS_STATE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// Save song selection state
function saveSongsState(state: {
  selectedSongId: string | null;
  selectedCategoryId: string | null;
}) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SONGS_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save songs state:", e);
  }
}

export function useSongs(orgId: Id<"organizations"> | null) {
  // Use cached query for offline support
  const convexSongs = useCachedConvexQuery(
    api.songs.listByOrg,
    orgId ? { orgId } : "skip",
    "songs",
  );

  // Local cache for immediate display on reload (null on server, loaded after hydration)
  const [localSongs, setLocalSongs] = useState<Song[] | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Use convex data when available, fallback to local cache
  const songs: Song[] | null =
    (convexSongs as Song[] | undefined) ?? localSongs;

  // Load cached songs after hydration
  useEffect(() => {
    const cached = loadCachedSongs();
    if (cached) {
      setLocalSongs(cached);
    }
    setIsHydrated(true);
  }, []);

  // Update local cache when convex data loads
  useEffect(() => {
    if (convexSongs && convexSongs.length > 0) {
      setLocalSongs(convexSongs as Song[]);
      saveSongsCache(convexSongs as Song[]);
    }
  }, [convexSongs]);

  const createSong = useMutation(api.songs.create);
  const updateSong = useMutation(api.songs.update);
  const removeSong = useMutation(api.songs.remove);

  // Initialize with defaults (matches server render)
  const [selectedSongId, setSelectedSongId] = useState<Id<"songs"> | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<Id<"categories"> | null>(null);

  // Restore selection from localStorage after hydration
  useEffect(() => {
    const state = loadSongsState();
    if (state) {
      if (state.selectedSongId) {
        setSelectedSongId(state.selectedSongId as Id<"songs">);
      }
      if (state.selectedCategoryId) {
        setSelectedCategoryId(state.selectedCategoryId as Id<"categories">);
      }
    }
  }, []);

  // Persist selection state (only after hydration)
  useEffect(() => {
    if (!isHydrated) return;
    saveSongsState({
      selectedSongId: selectedSongId as string | null,
      selectedCategoryId: selectedCategoryId as string | null,
    });
  }, [isHydrated, selectedSongId, selectedCategoryId]);

  // Validate selection still exists
  useEffect(() => {
    if (songs && selectedSongId) {
      const exists = songs.some((s) => s._id === selectedSongId);
      if (!exists) {
        setSelectedSongId(null);
      }
    }
  }, [songs, selectedSongId]);

  const selectedSong = useMemo(() => {
    if (!selectedSongId || !songs) return null;
    return songs.find((s) => s._id === selectedSongId) ?? null;
  }, [selectedSongId, songs]);

  const filteredSongs = useMemo(() => {
    if (!songs) return [];
    if (!selectedCategoryId) return songs;
    return songs.filter((s) => s.categoryId === selectedCategoryId);
  }, [songs, selectedCategoryId]);

  const createNewSong = async (
    title: string,
    lyrics: string,
    categoryId?: Id<"categories">,
  ) => {
    if (!orgId || !title.trim()) return null;
    const slides = parseLyricsToSlides(lyrics);
    const id = await createSong({
      orgId,
      title: title.trim(),
      lyrics,
      slides,
      categoryId,
    });
    return id;
  };

  const updateExistingSong = async (
    songId: Id<"songs">,
    title: string,
    lyrics: string,
  ) => {
    const slides = parseLyricsToSlides(lyrics);
    await updateSong({ songId, title, lyrics, slides });
  };

  const deleteSong = async (songId: Id<"songs">) => {
    await removeSong({ songId });
    if (selectedSongId === songId) {
      setSelectedSongId(null);
    }
  };

  return {
    songs: songs ?? [],
    filteredSongs,
    selectedSong,
    selectedSongId,
    selectedCategoryId,
    setSelectedSongId,
    setSelectedCategoryId,
    createNewSong,
    updateExistingSong,
    deleteSong,
  };
}
