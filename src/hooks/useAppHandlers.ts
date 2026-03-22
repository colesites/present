"use client";

import { useCallback } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import type { Song } from "../types";
import type { ScriptureSlide } from "../features/scripture/lib/slides";
import { parseReference, type ParsedReference } from "../features/scripture/lib/parser";
import { generateBibleSlides } from "../features/scripture/lib/slides";
import type { BibleVerse, BibleBookRecord } from "../features/scripture/lib/db";

interface UseAppHandlersProps {
  // State Setters
  setSelected: (selected: { songId: Id<"songs"> | null; index: number } | null) => void;
  setViewMode: (mode: "show" | "edit" | "settings") => void;
  setSelectedSongId: (id: Id<"songs"> | null) => void;
  setScriptureSlides: (slides: ScriptureSlide[]) => void;
  setShowTextInOutput: (show: boolean) => void;
  setEditScrollToSlide: (index: number | null) => void;
  
  // Mutations & Actions
  selectSlide: (
    slideId: string,
    text: string,
    footer?: string,
    options?: { suppressBroadcast?: boolean }
  ) => Promise<void>;
  removeFromService: (serviceId: Id<"services">, index: number) => Promise<void>;
  addSongToService: (serviceId: Id<"services">, songId: Id<"songs">) => Promise<void>;
  addMediaToService: (serviceId: Id<"services">, mediaId: string, mediaName: string) => Promise<void>;
  updateExistingSong: (id: Id<"songs">, title: string, lyrics: string) => Promise<void>;
  
  // Context/Data
  songs: Song[];
  selectedServiceId: Id<"services"> | null;
  selectedSongId: Id<"songs"> | null;
  isOutputFrozen: boolean;
  availableBooks: BibleBookRecord[];
  lookupRef: (parsed: ParsedReference) => Promise<BibleVerse[]>;
}

export function useAppHandlers({
  setSelected,
  setViewMode,
  setSelectedSongId,
  setScriptureSlides,
  setShowTextInOutput,
  setEditScrollToSlide,
  selectSlide,
  removeFromService,
  addSongToService,
  addMediaToService,
  updateExistingSong,
  songs,
  selectedServiceId,
  selectedSongId,
  isOutputFrozen,
  availableBooks,
  lookupRef,
}: UseAppHandlersProps) {
  
  const handleSelectSlide = useCallback(
    async (slideId: string, text: string, footer?: string) => {
      setShowTextInOutput(true);
      await selectSlide(slideId, text, footer, {
        suppressBroadcast: isOutputFrozen,
      });

      const [idPart, indexStr] = slideId.split(":");
      const index = Number(indexStr);

      if (slideId.startsWith("scripture")) {
        setSelected({ songId: null, index });
      } else if (slideId.includes(":")) {
        setSelected({ songId: idPart as Id<"songs">, index });
      }
    },
    [selectSlide, isOutputFrozen, setShowTextInOutput, setSelected]
  );

  const handleEditSlide = useCallback(
    (songId: Id<"songs">, slideIndex: number) => {
      setSelectedSongId(songId);
      setViewMode("edit");
      setSelected({ songId, index: slideIndex });
      setEditScrollToSlide(slideIndex);
    },
    [setSelectedSongId, setViewMode, setSelected, setEditScrollToSlide]
  );

  const handleRemoveFromService = useCallback(
    async (index: number) => {
      if (!selectedServiceId) return;
      await removeFromService(selectedServiceId, index);
    },
    [selectedServiceId, removeFromService]
  );

  const handleAddToService = useCallback(
    async (songId: Id<"songs">) => {
      if (!selectedServiceId) return;
      await addSongToService(selectedServiceId, songId);
    },
    [selectedServiceId, addSongToService]
  );

  const handleAddMediaToService = useCallback(
    async (mediaId: string, mediaName: string) => {
      if (!selectedServiceId) return;
      await addMediaToService(selectedServiceId, mediaId, mediaName);
    },
    [selectedServiceId, addMediaToService]
  );

  const handleSaveSong = useCallback(
    async (title: string, lyrics: string) => {
      if (!selectedSongId) return;
      await updateExistingSong(selectedSongId, title, lyrics);
    },
    [selectedSongId, updateExistingSong]
  );

  const handleRenameSong = useCallback(
    async (songId: Id<"songs">, newTitle: string) => {
      const song = songs.find((s) => s._id === songId);
      if (!song) return;
      await updateExistingSong(songId, newTitle, song.lyrics);
    },
    [songs, updateExistingSong]
  );

  const handleScriptureOutput = useCallback(
    async (slides: ScriptureSlide[]) => {
      setShowTextInOutput(true);
      setSelectedSongId(null);
      setScriptureSlides(slides);

      if (slides.length > 0) {
        await handleSelectSlide(
          `scripture:0`,
          slides[0].content,
          slides[0].footer
        );
      }
    },
    [handleSelectSlide, setSelectedSongId, setShowTextInOutput, setScriptureSlides]
  );

  const handleSelectScripture = useCallback(
    async (refString: string) => {
      if (availableBooks.length === 0) return;

      const parsed = parseReference(refString, availableBooks);
      if (!parsed.book || parsed.errors.length > 0) {
        console.warn(
          "Failed to parse scripture ref from service:",
          refString,
          parsed.errors
        );
        return;
      }

      const verses = await lookupRef(parsed);

      if (verses.length > 0) {
        const slides = generateBibleSlides(verses, {
          verseNumberMode: "inline",
          maxLines: 40,
          maxCharsPerLine: 100,
          versionName: parsed.versionCode ?? undefined,
        });
        handleScriptureOutput(slides);
      }
    },
    [availableBooks, lookupRef, handleScriptureOutput]
  );

  return {
    handleSelectSlide,
    handleEditSlide,
    handleRemoveFromService,
    handleAddToService,
    handleAddMediaToService,
    handleSaveSong,
    handleRenameSong,
    handleScriptureOutput,
    handleSelectScripture,
  };
}
