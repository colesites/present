"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, LibraryItemDraft } from "../../../shared/types";
import type { ScriptureSlide } from "../../../features/scripture/lib/slides";
import { parseReference, type ParsedReference } from "../../../features/scripture/lib/parser";
import {
  generateBibleSlides,
  mergeScriptureSlides,
} from "../../../features/scripture/lib/slides";
import type { BibleVerse, BibleBookRecord } from "../../../features/scripture/lib/db";
import { applyScriptureLayoutTemplate } from "../../../features/scripture/lib/layout-template";
import { useScriptureLayoutTemplateStore } from "../../../features/scripture/lib/layout-template-state";
import {
  ensureScriptureSlideElements,
  type ScriptureEditorDefaults,
} from "../../../features/scripture/lib/editor";

interface UseAppHandlersProps {
  // State Setters
  setSelected: (selected: { libraryId: string | null; index: number } | null) => void;
  setViewMode: (mode: "show" | "edit" | "settings") => void;
  setSelectedLibraryId: (id: string | null) => void;
  setScriptureSlides: Dispatch<SetStateAction<ScriptureSlide[]>>;
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
  updateExistingLibraryItem: (
    id: string,
    draft: LibraryItemDraft,
    categoryId?: string,
  ) => Promise<void>;
  
  // Context/Data
  libraryItems: LibraryItem[];
  selectedServiceId: Id<"services"> | null;
  selectedLibraryId: string | null;
  isOutputFrozen: boolean;
  availableBooks: BibleBookRecord[];
  lookupRef: (parsed: ParsedReference) => Promise<BibleVerse[]>;
  scriptureEditorDefaults: ScriptureEditorDefaults;
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
  scriptureEditorDefaults,
}: UseAppHandlersProps) {
  const resolveLibrarySlideIndex = useCallback(
    (libraryId: string, slideToken: string): number | null => {
      const item = libraryItems.find(
        (libraryItem) => String(libraryItem._id) === String(libraryId),
      );
      if (!item) {
        return null;
      }

      const matchedSlideIndex = item.slides.findIndex((slide) => slide.id === slideToken);
      if (matchedSlideIndex >= 0) {
        return matchedSlideIndex;
      }

      const parsedIndex = Number(slideToken);
      return Number.isFinite(parsedIndex) ? parsedIndex : null;
    },
    [libraryItems],
  );
  
  const handleSelectSlide = useCallback(
    async (slideId: string, text: string, footer?: string) => {
      setShowTextInOutput(true);
      await selectSlide(slideId, text, footer, {
        suppressBroadcast: isOutputFrozen,
      });

      const separatorIndex = slideId.indexOf(":");
      const idPart = separatorIndex >= 0 ? slideId.slice(0, separatorIndex) : slideId;
      const slideToken = separatorIndex >= 0 ? slideId.slice(separatorIndex + 1) : "";
      const parsedIndex = Number(slideToken);

      if (slideId.startsWith("scripture")) {
        setSelected({
          libraryId: null,
          index: Number.isFinite(parsedIndex) ? parsedIndex : 0,
        });
      } else if (slideId.includes(":")) {
        const resolvedIndex = resolveLibrarySlideIndex(idPart, slideToken);
        if (resolvedIndex != null) {
          setSelected({ libraryId: idPart, index: resolvedIndex });
        }
      }
    },
    [
      selectSlide,
      isOutputFrozen,
      resolveLibrarySlideIndex,
      setShowTextInOutput,
      setSelected,
    ]
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
    async (draft: LibraryItemDraft) => {
      const targetLibraryId = draft._id ? String(draft._id) : selectedLibraryId;
      if (!targetLibraryId) return;
      await updateExistingLibraryItem(targetLibraryId, draft);
    },
    [selectedLibraryId, updateExistingLibraryItem]
  );

  const handleRenameLibraryItem = useCallback(
    async (libraryId: string, newTitle: string, categoryId?: string) => {
      const item = libraryItems.find(
        (s) => String(s._id) === String(libraryId),
      );
      if (!item) return;
      await updateExistingLibraryItem(libraryId, {
        title: newTitle,
        body: item.body,
        slides: item.slides,
        content: item.content,
      }, categoryId);
    },
    [libraryItems, updateExistingLibraryItem]
  );

  const handleScriptureOutput = useCallback(
    async (slides: ScriptureSlide[]) => {
      const template = useScriptureLayoutTemplateStore.getState().template;
      const nextSlides = slides.map((slide, index) => {
        const templatedSlide = applyScriptureLayoutTemplate(slide, template);
        const canvasSize =
          templatedSlide.canvasSize ?? scriptureEditorDefaults.canvasSize;
        const elements =
          templatedSlide.elements && templatedSlide.elements.length > 0
            ? templatedSlide.elements
            : ensureScriptureSlideElements(
                {
                  ...templatedSlide,
                  canvasSize,
                },
                index,
                {
                  ...scriptureEditorDefaults,
                  canvasSize,
                },
              );

        return {
          ...templatedSlide,
          canvasSize,
          elements,
        };
      });

      setShowTextInOutput(true);
      setSelectedLibraryId(null);
      setScriptureSlides((previousSlides: ScriptureSlide[]) =>
        mergeScriptureSlides(
          previousSlides,
          nextSlides,
        ),
      );

      if (nextSlides.length > 0) {
        await handleSelectSlide(
          nextSlides[0].id ?? `scripture:0`,
          nextSlides[0].content,
          nextSlides[0].footer,
        );
      }
    },
    [
      handleSelectSlide,
      scriptureEditorDefaults,
      setSelectedLibraryId,
      setShowTextInOutput,
      setScriptureSlides,
    ]
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
