"use client";

import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { parseLyricsToSlides } from "@/lib/lyrics";
import type { Song } from "@/types";

// Local storage persistence removed to prevent state fighting

export function useSongs(orgId: Id<"organizations"> | null) {
  // Use plain Convex query - no caching to avoid data conflicts
  const songs = useQuery(api.songs.listByOrg, orgId ? { orgId } : "skip") as
    | Song[]
    | undefined;

  // Hydration logic removed - online only
  const createSong = useMutation(api.songs.create);
  const updateSong = useMutation(api.songs.update);
  const removeSong = useMutation(api.songs.remove);

  const [selectedSongId, setSelectedSongId] = useState<Id<"songs"> | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<Id<"categories"> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

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

    let result = songs;

    // Filter by category
    if (selectedCategoryId) {
      result = result.filter((s) => s.categoryId === selectedCategoryId);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.lyrics.toLowerCase().includes(query),
      );
    }

    return result;
  }, [songs, selectedCategoryId, searchQuery]);

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
    isLoading: songs === undefined,
    filteredSongs,
    selectedSong,
    selectedSongId,
    selectedCategoryId,
    searchQuery,
    setSelectedSongId,
    setSelectedCategoryId,
    setSearchQuery,
    createNewSong,
    updateExistingSong,
    deleteSong,
  };
}
