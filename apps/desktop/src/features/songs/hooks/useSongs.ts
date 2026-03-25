"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { parseLyricsToSlides } from "../../../lib/lyrics";
import type { Song, ContentSource } from "../../../types";

// Local storage persistence removed to prevent state fighting

export function useSongs(
  input: { orgId: Id<"organizations"> | null; userId: Id<"users"> | null },
  contentSource: ContentSource,
) {
  const { orgId, userId } = input;
  // Use plain Convex query - no caching to avoid data conflicts
  const songs = useQuery(
    orgId ? api.songs.listByOrg : api.personalSongs.listByUser,
    orgId ? { orgId } : userId ? { userId } : "skip",
  ) as
    | Song[]
    | undefined;

  // Hydration logic removed - online only
  const createSong = useMutation(orgId ? api.songs.create : api.personalSongs.create);
  const updateSong = useMutation(orgId ? api.songs.update : api.personalSongs.update);
  const removeSong = useMutation(orgId ? api.songs.remove : api.personalSongs.remove);

  const [selectedSongId, setSelectedSongId] = useState<Id<"songs"> | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<Id<"categories"> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [prevSongs, setPrevSongs] = useState(songs);
  if (songs !== prevSongs) {
    setPrevSongs(songs);
    if (songs && selectedSongId) {
      const exists = songs.some((s) => s._id === selectedSongId);
      if (!exists) {
        setSelectedSongId(null);
      }
    }
  }

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

    // Filter by content source
    // For now, if "community" is selected, we show nothing (placeholder for public API)
    if (contentSource === "community") {
      return [];
    }

    return result;
  }, [songs, selectedCategoryId, searchQuery, contentSource]);

  const createNewSong = async (
    title: string,
    lyrics: string,
    categoryId?: Id<"categories">,
  ) => {
    if (!title.trim()) return null;
    if (!orgId && !userId) {
      throw new Error("Account not ready yet. Please wait a moment and try again.");
    }
    const slides = parseLyricsToSlides(lyrics);
    const id = await createSong(
      orgId
        ? ({
            orgId,
            title: title.trim(),
            lyrics,
            slides,
            categoryId,
          } as any)
        : ({
            userId,
            title: title.trim(),
            lyrics,
            slides,
            categoryId: categoryId as any,
          } as any),
    );
    return id;
  };

  const updateExistingSong = async (
    songId: Id<"songs">,
    title: string,
    lyrics: string,
  ) => {
    const slides = parseLyricsToSlides(lyrics);
    await updateSong({ songId, title, lyrics, slides } as any);
  };

  const deleteSong = async (songId: Id<"songs">) => {
    await removeSong({ songId } as any);
    if (selectedSongId === songId) {
      setSelectedSongId(null);
    }
  };

  return {
    songs: (songs ?? []) as any,
    isLoading: Boolean(orgId) && songs === undefined,
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
