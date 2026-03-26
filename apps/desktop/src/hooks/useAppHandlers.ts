"use client";

import { useCallback } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem } from "../types";
import type { ScriptureSlide } from "../features/scripture/lib/slides";
import { parseReference, type ParsedReference } from "../features/scripture/lib/parser";
import { generateBibleSlides } from "../features/scripture/lib/slides";
import type { BibleVerse, BibleBookRecord } from "../features/scripture/lib/db";

interface UseAppHandlersProps {
  // State Setters
  setSelected: (selected: { libraryId: string | null; index: number } | null) => void;
  setViewMode: (mode: "show" | "edit" | "settings") => void;
  setSelectedLibraryId: (id: string | null) => void;
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
  addLibraryItemToService: (serviceId: Id<"services">, libraryId: string) => Promise<void>;
  addMediaToService: (serviceId: Id<"services">, mediaId: string, mediaName: string) => Promise<void>;
  updateExistingLibraryItem: (id: string, title: string, body: string) => Promise<void>;
  
  // Context/Data
  libraryItems: LibraryItem[];
  selectedServiceId: Id<"services"> | null;
  selectedLibraryId: string | null;
  isOutputFrozen: boolean;
  availableBooks: BibleBookRecord[];
  lookupRef: (parsed: ParsedReference) => Promise<BibleVerse[]>;
}

export function useAppHandlers({
  setSelected,
  setViewMode,
  setSelectedLibraryId,
  setScriptureSlides,
  setShowTextInOutput,
  setEditScrollToSlide,
  selectSlide,
  removeFromService,
  addLibraryItemToService,
  addMediaToService,
  updateExistingLibraryItem,
  libraryItems,
  selectedServiceId,
  selectedLibraryId,
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
        setSelected({ libraryId: null, index });
      } else if (slideId.includes(":")) {
        setSelected({ libraryId: idPart, index });
      }
    },
    [selectSlide, isOutputFrozen, setShowTextInOutput, setSelected]
  );

  const handleEditSlide = useCallback(
    (libraryId: string, slideIndex: number) => {
      setSelectedLibraryId(libraryId);
      setViewMode("edit");
      setSelected({ libraryId, index: slideIndex });
      setEditScrollToSlide(slideIndex);
    },
    [setSelectedLibraryId, setViewMode, setSelected, setEditScrollToSlide]
  );

  const handleRemoveFromService = useCallback(
    async (index: number) => {
      if (!selectedServiceId) return;
      await removeFromService(selectedServiceId, index);
    },
    [selectedServiceId, removeFromService]
  );

  const handleAddToService = useCallback(
    async (libraryId: string) => {
      if (!selectedServiceId) return;
      await addLibraryItemToService(selectedServiceId, libraryId);
    },
    [selectedServiceId, addLibraryItemToService]
  );

  const handleAddMediaToService = useCallback(
    async (mediaId: string, mediaName: string) => {
      if (!selectedServiceId) return;
      await addMediaToService(selectedServiceId, mediaId, mediaName);
    },
    [selectedServiceId, addMediaToService]
  );

  const handleSaveLibraryItem = useCallback(
    async (title: string, body: string) => {
      if (!selectedLibraryId) return;
      await updateExistingLibraryItem(selectedLibraryId, title, body);
    },
    [selectedLibraryId, updateExistingLibraryItem]
  );

  const handleRenameLibraryItem = useCallback(
    async (libraryId: string, newTitle: string) => {
      const item = libraryItems.find((s) => s._id === libraryId);
      if (!item) return;
      await updateExistingLibraryItem(libraryId, newTitle, item.body);
    },
    [libraryItems, updateExistingLibraryItem]
  );

  const handleScriptureOutput = useCallback(
    async (slides: ScriptureSlide[]) => {
      setShowTextInOutput(true);
      setSelectedLibraryId(null);
      setScriptureSlides(slides);

      if (slides.length > 0) {
        await handleSelectSlide(
          `scripture:0`,
          slides[0].content,
          slides[0].footer
        );
      }
    },
    [handleSelectSlide, setSelectedLibraryId, setShowTextInOutput, setScriptureSlides]
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
    handleSaveLibraryItem,
    handleRenameLibraryItem,
    handleScriptureOutput,
    handleSelectScripture,
  };
}
