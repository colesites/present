"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { LibraryItem, LibraryItemDraft } from "../../../shared/types";
import {
  joinScriptureParts,
  scriptureSlideAt,
  splitScriptureSlide,
  type ScriptureSlide,
} from "../../../features/scripture/lib/slides";
import { useScriptureOverflowStore } from "../../../features/scripture/lib/overflow-state";
import { measureWords } from "../../../features/scripture/lib/measure-words";
import { type ParsedReference } from "../../../features/scripture/lib/parser";
import { parseScriptureReference } from "../../tauri/scripture";
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
  scriptureSlides: ScriptureSlide[];
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
  scriptureSlides,
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
  
  const scriptureSlidesRef = useRef(scriptureSlides);
  useEffect(() => {
    scriptureSlidesRef.current = scriptureSlides;
  }, [scriptureSlides]);

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
        // A verse's own id ("scripture:kjv|gen|1|2"), or its place in the deck.
        const inDeck = scriptureSlidesRef.current.findIndex((slide) => slide.id === slideId);
        setSelected({
          libraryId: null,
          index: inDeck >= 0 ? inDeck : Number.isFinite(parsedIndex) ? parsedIndex : 0,
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

  /**
   * Verse slides as the screen shows them: in the layout designed in Bible
   * edit, or the one made from the settings, and a long verse split as
   * "Long verses" says (`splitScriptureSlide`).
   */
  const prepareScriptureSlides = useCallback(
    (slides: ScriptureSlide[]): ScriptureSlide[] => {
      const template = useScriptureLayoutTemplateStore.getState().template;
      const overflow = useScriptureOverflowStore.getState().overflow;
      const laidOut = slides.map((slide, index) => {
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
                  overflow,
                },
              );

        return {
          ...templatedSlide,
          canvasSize,
          elements,
        };
      });
      return laidOut.flatMap((slide) => splitScriptureSlide(slide, overflow, measureWords));
    },
    [scriptureEditorDefaults],
  );

  /** The slide the Bible agent last followed a reading to (`handleFollowScripture`). */
  const followedRef = useRef<string | null>(null);

  const handleScriptureOutput = useCallback(
    async (slides: ScriptureSlide[]) => {
      const nextSlides = prepareScriptureSlides(slides);
      scriptureSlidesRef.current = nextSlides;
      followedRef.current = nextSlides[0]?.id ?? null;

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
      prepareScriptureSlides,
      setSelectedLibraryId,
      setShowTextInOutput,
      setScriptureSlides,
    ]
  );

  // "Long verses" changed: the verses up now split again the new way. Their
  // layout is made again from the settings unless one was designed.
  useEffect(
    () =>
      useScriptureOverflowStore.subscribe((state, previous) => {
        if (state.overflow === previous.overflow) return;
        const designed = useScriptureLayoutTemplateStore.getState().template !== null;
        setScriptureSlides((current) =>
          current.length === 0
            ? current
            : prepareScriptureSlides(
                joinScriptureParts(current).map((slide) =>
                  designed ? slide : { ...slide, elements: undefined },
                ),
              ),
        );
      }),
    [prepareScriptureSlides, setScriptureSlides],
  );

  /**
   * The slide of `verse`, among the verses up now, with its `word`th word:
   * the Bible agent following a reading through a passage, or through a
   * verse split over several slides. Nothing when it is the one up already.
   */
  const handleFollowScripture = useCallback(
    (verse: number, word: number) => {
      const slide = scriptureSlideAt(scriptureSlidesRef.current, verse, word);
      if (!slide?.id || followedRef.current === slide.id) return;
      followedRef.current = slide.id;
      void handleSelectSlide(slide.id, slide.content, slide.footer);
    },
    [handleSelectSlide],
  );

  const handleSelectScripture = useCallback(
    async (refString: string) => {
      if (availableBooks.length === 0) return;

      const parsed = await parseScriptureReference(refString, availableBooks);
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
    handleFollowScripture,
  };
}
