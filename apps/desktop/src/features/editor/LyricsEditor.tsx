"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../renderer/shared/components/ui/resizable";
import type {
  CanvasSizePreset,
  LibraryContent,
  LibraryItem,
  LibraryItemDraft,
  LibrarySlide,
  SlideElement,
  SlideElementStyle,
  SlideElementType,
} from "../../shared/types";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import {
  buildSlidesFromBody,
  createDraftFromLibraryItem,
  DEFAULT_CANVAS_SIZE,
  getCanvasSizeDimensions,
  getLibraryLabelOptions,
  getSlideBackgroundColor,
  normalizeLibraryContent,
  normalizeLibrarySlide,
  normalizePresentationSettings,
  reorderLibrarySlides,
  reorderSlideElements,
  scaleSlidesToCanvas,
  slidesToBody,
} from "../library/lib/library-items";
import type { LibraryTextStyleDefaults } from "../library/lib/library-items";
import { normalizeEditableRichTextHtml } from "../../renderer/shared/lib/rich-text";
import { breakLyricsIntoChunks } from "../../renderer/shared/lib/lyrics";
import { Dialog } from "../../renderer/shared/components/Dialog";
import { EditorHeader } from "./components/EditorHeader";
import { SlideList } from "./components/SlideList";
import { EditorCanvas } from "./components/EditorCanvas";
import { EditorInspector } from "./components/EditorInspector";
import { useThemesModalStore } from "../../renderer/shared/store/themesModal";

interface LyricsEditorProps {
  libraryItem: LibraryItem | null;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  libraryDefaultFontFamily: string;
  libraryDefaultFontSize: number;
  libraryDefaultFontWeight: string;
  scriptureDefaultFontFamily: string;
  scriptureDefaultFontSize: number;
  scriptureDefaultFontWeight: string;
  scrollToSlideIndex?: number | null;
  onSave: (draft: LibraryItemDraft) => Promise<void>;
  onFixLyrics: (body: string) => Promise<string>;
  onFontStyleChange: (styles: {
    fontFamily?: string;
    fontSize?: number;
    fontBold?: boolean;
    fontItalic?: boolean;
    fontUnderline?: boolean;
  }) => void;
  onUpdateOutput?: (payload: {
    slideId: string;
    text: string;
    elements: SlideElement[];
    canvasSize: CanvasSizePreset;
    backgroundColor: string | null;
  }) => void;
  onScrollComplete?: () => void;
}

type EditorViewMode = "slides" | "source";
type GeneralInspectorTab = "presentation" | "slide";
type ObjectInspectorTab = "text" | "shape" | "image";
type InspectorTab = GeneralInspectorTab | ObjectInspectorTab;

function isGeneralInspectorTab(tab: InspectorTab): tab is GeneralInspectorTab {
  return tab === "presentation" || tab === "slide";
}

function getInspectorTabForElementType(
  type: SlideElementType | null | undefined,
): ObjectInspectorTab | null {
  if (type === "text" || type === "shape" || type === "image") {
    return type;
  }

  return null;
}

function buildDraftWithNormalizedContent(
  draft: LibraryItemDraft,
  slides: LibrarySlide[],
  content?: LibraryContent,
  textDefaults?: LibraryTextStyleDefaults,
  options?: {
    preserveBody?: boolean;
  },
): LibraryItemDraft {
  const normalizedContent = normalizeLibraryContent(content ?? draft.content, slides);
  const canvasSize =
    normalizedContent.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const nextSlides = slides.map((slide) =>
    normalizeLibrarySlide(slide, canvasSize, textDefaults),
  );
  return {
    ...draft,
    body: options?.preserveBody ? draft.body : slidesToBody(nextSlides),
    slides: nextSlides,
    content: normalizedContent,
  };
}

function getPrimarySlideTextFromElements(
  elements: SlideElement[],
  fallbackText: string,
) {
  return (
    (
      elements.find(
        (element) =>
          element.type === "text" &&
          !element.isPlaceholder &&
          element.contentRole === "scriptureVerse",
      ) ??
      elements.find(
        (element) => element.type === "text" && !element.isPlaceholder,
      )
    )?.content ?? fallbackText
  );
}

export const LyricsEditor = memo(function LyricsEditor({
  libraryItem,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  libraryDefaultFontFamily,
  libraryDefaultFontSize,
  libraryDefaultFontWeight,
  scriptureDefaultFontFamily,
  scriptureDefaultFontSize,
  scriptureDefaultFontWeight,
  scrollToSlideIndex,
  onSave,
  onFixLyrics,
  onFontStyleChange,
  onUpdateOutput,
  onScrollComplete,
}: LyricsEditorProps) {
  const libraryDefaultTextStyle = useMemo<LibraryTextStyleDefaults>(
    () => ({
      fontFamily: libraryDefaultFontFamily,
      fontSize: libraryDefaultFontSize,
      fontWeight: libraryDefaultFontWeight,
    }),
    [libraryDefaultFontFamily, libraryDefaultFontSize, libraryDefaultFontWeight],
  );
  const scriptureDefaultTextStyle = useMemo<LibraryTextStyleDefaults>(
    () => ({
      fontFamily: scriptureDefaultFontFamily,
      fontSize: scriptureDefaultFontSize,
      fontWeight: scriptureDefaultFontWeight,
    }),
    [
      scriptureDefaultFontFamily,
      scriptureDefaultFontSize,
      scriptureDefaultFontWeight,
    ],
  );
  const activeDefaultTextStyle = useMemo(
    () =>
      libraryItem?.type === "scripture"
        ? scriptureDefaultTextStyle
        : libraryDefaultTextStyle,
    [libraryItem?.type, libraryDefaultTextStyle, scriptureDefaultTextStyle],
  );
  const [draft, setDraft] = useState<LibraryItemDraft>(() =>
    libraryItem ? createDraftFromLibraryItem(libraryItem, activeDefaultTextStyle) : {
      _id: "preview" as Id<"libraries">,
      title: "New Item",
      body: "",
      slides: [normalizeLibrarySlide({ text: "", label: "" }, DEFAULT_CANVAS_SIZE, activeDefaultTextStyle)],
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  );
  const [editorView, setEditorView] = useState<EditorViewMode>("slides");
  const [inspectorTab, setInspectorTabState] =
    useState<InspectorTab>("presentation");
  const [sidebarTab, setSidebarTab] = useState<"slides" | "layers">("slides");
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(
    draft.slides[0]?.id ?? null,
  );
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [sourceFocusSlideIndex, setSourceFocusSlideIndex] = useState<number | null>(null);
  const [draggedSlideIndex, setDraggedSlideIndex] = useState<number | null>(null);
  const [dropSlideIndex, setDropSlideIndex] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [breakDialogOpen, setBreakDialogOpen] = useState(false);
  const [breakLines, setBreakLines] = useState(2);

  const latestSavedRef = useRef<string | null>(null);
  const lastItemKeyRef = useRef<string | null>(null);
  const lastGeneralInspectorTabRef = useRef<GeneralInspectorTab>("presentation");
  const autosaveRetryTimerRef = useRef<number | null>(null);

  const setInspectorTab = useCallback((tab: InspectorTab) => {
    if (isGeneralInspectorTab(tab)) {
      lastGeneralInspectorTabRef.current = tab;
    }
    setInspectorTabState(tab);
  }, []);

  useEffect(() => {
    if (!libraryItem) return;
    const itemKey = `${libraryItem._id}:${libraryItem.updatedAt}:${libraryItem.version}`;
    const didSwitchItems =
      lastItemKeyRef.current == null ||
      !lastItemKeyRef.current.startsWith(`${libraryItem._id}:`);
    if (itemKey === lastItemKeyRef.current) {
      return;
    }

    if (!didSwitchItems) {
      // Avoid replacing local editor state on save echoes for the active item.
      // This keeps slide sidebar scroll/selection stable while autosave runs.
      lastItemKeyRef.current = itemKey;
      return;
    }

    const nextDraft = createDraftFromLibraryItem(
      libraryItem,
      activeDefaultTextStyle,
    );
    const nextSelection = nextDraft.slides[0]?.id ?? null;
    const nextEditorView =
      nextDraft.content?.editorView === "source" ? "source" : "slides";
    const nextSavedPayload = buildDraftWithNormalizedContent(
      {
        ...nextDraft,
        content: {
          ...nextDraft.content,
          editorView: nextEditorView,
        },
      },
      nextDraft.slides,
      {
        ...nextDraft.content,
        editorView: nextEditorView,
      },
      activeDefaultTextStyle,
      {
        preserveBody: nextEditorView === "source",
      },
    );
    latestSavedRef.current = JSON.stringify(nextSavedPayload);
    setDraft(nextDraft);

    setSelectedSlideId((current) => {
      if (current && nextDraft.slides.some((slide) => slide.id === current)) {
        return current;
      }
      return nextSelection;
    });

    setSelectedElementId((current) => {
      if (!current) {
        return null;
      }

      const activeSlideId =
        selectedSlideId && nextDraft.slides.some((slide) => slide.id === selectedSlideId)
          ? selectedSlideId
          : nextSelection;
      const activeSlide =
        nextDraft.slides.find((slide) => slide.id === activeSlideId) ?? null;

      if (activeSlide?.elements?.some((element) => element.id === current)) {
        return current;
      }

      return null;
    });

    lastGeneralInspectorTabRef.current = "presentation";
    setInspectorTabState("presentation");
    setEditorView(nextEditorView);

    lastItemKeyRef.current = itemKey;
  }, [activeDefaultTextStyle, libraryItem, selectedSlideId]);

  const selectedSlideIndex = useMemo(
    () => draft.slides.findIndex((slide) => slide.id === selectedSlideId),
    [draft.slides, selectedSlideId],
  );
  const selectedSlide =
    selectedSlideIndex >= 0 ? draft.slides[selectedSlideIndex] : null;
  const presentationSettings = useMemo(
    () => normalizePresentationSettings(draft.content?.presentation),
    [draft.content?.presentation],
  );
  const currentCanvasSize =
    presentationSettings.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const canvasDimensions = useMemo(
    () => getCanvasSizeDimensions(currentCanvasSize),
    [currentCanvasSize],
  );
  const selectedElement = useMemo(
    () =>
      selectedSlide?.elements?.find((element) => element.id === selectedElementId) ??
      null,
    [selectedElementId, selectedSlide?.elements],
  );

  useEffect(() => {
    if (!selectedElementId) {
      return;
    }

    if (!selectedElement) {
      setSelectedElementId(null);
      setInspectorTab(lastGeneralInspectorTabRef.current);
      return;
    }

    const objectTab = getInspectorTabForElementType(selectedElement.type);
    if (objectTab) {
      setInspectorTabState(objectTab);
    }
  }, [selectedElement, selectedElementId, setInspectorTab]);

  const applyDraft = useCallback(
    (
      updater: (previous: LibraryItemDraft) => LibraryItemDraft,
      options?: {
        preserveBody?: boolean;
      },
    ) => {
      setDraft((previous) => {
        const next = updater(previous);
        return buildDraftWithNormalizedContent(
          next,
          next.slides,
          next.content,
          activeDefaultTextStyle,
          {
            preserveBody: options?.preserveBody ?? editorView === "source",
          },
        );
      });
    },
    [activeDefaultTextStyle, editorView],
  );

  const persistDraft = useCallback(
    async (nextDraft: LibraryItemDraft, showSuccessToast = false) => {
      const trimmedTitle = nextDraft.title.trim();
      if (!trimmedTitle) {
        return;
      }

      const payload = buildDraftWithNormalizedContent(
        {
          ...nextDraft,
          title: trimmedTitle,
          content: {
            ...nextDraft.content,
            editorView,
          },
        },
        nextDraft.slides,
        {
          ...nextDraft.content,
          editorView,
        },
        activeDefaultTextStyle,
        {
          preserveBody: editorView === "source",
        },
      );

      const serializedPayload = JSON.stringify(payload);
      if (serializedPayload === latestSavedRef.current) {
        return;
      }
      await onSave(payload);
      latestSavedRef.current = serializedPayload;

      if (showSuccessToast) {
        toast.success("Library updated");
      }
    },
    [activeDefaultTextStyle, editorView, onSave],
  );

  const debouncedAutoSave = useDebouncedCallback(async (nextDraft: LibraryItemDraft) => {
    try {
      await persistDraft(nextDraft);
      if (autosaveRetryTimerRef.current !== null) {
        window.clearTimeout(autosaveRetryTimerRef.current);
        autosaveRetryTimerRef.current = null;
      }
    } catch (error) {
      console.warn("[LyricsEditor] auto-save failed; retrying once.", error);
      if (autosaveRetryTimerRef.current !== null) {
        window.clearTimeout(autosaveRetryTimerRef.current);
      }
      autosaveRetryTimerRef.current = window.setTimeout(() => {
        autosaveRetryTimerRef.current = null;
        void persistDraft(nextDraft).catch((retryError) => {
          console.warn("[LyricsEditor] auto-save retry failed.", retryError);
        });
      }, 2_500);
    }
  }, 900);

  useEffect(() => {
    return () => {
      debouncedAutoSave.cancel();
      if (autosaveRetryTimerRef.current !== null) {
        window.clearTimeout(autosaveRetryTimerRef.current);
        autosaveRetryTimerRef.current = null;
      }
    };
  }, [debouncedAutoSave, libraryItem?._id]);

  useEffect(() => {
    if (!draft.title.trim()) {
      return;
    }

    debouncedAutoSave(draft);
  }, [draft, debouncedAutoSave]);

  useEffect(() => {
    if (scrollToSlideIndex == null) {
      return;
    }

    const slide = draft.slides[scrollToSlideIndex];
    if (slide?.id) {
      setSelectedSlideId(slide.id);
      setSelectedElementId(null);
      setInspectorTab("slide");
      setEditorView("source");
      setSourceFocusSlideIndex(scrollToSlideIndex);
    }
    onScrollComplete?.();
  }, [draft.slides, onScrollComplete, scrollToSlideIndex, setInspectorTab]);

  const setSlides = useCallback(
    (updater: (slides: LibrarySlide[]) => LibrarySlide[]) => {
      applyDraft((previous) => {
        const nextSlides = updater(previous.slides);
        const finalSlides = nextSlides.length === 0 
          ? [
              normalizeLibrarySlide(
                { text: "", label: "" },
                currentCanvasSize,
                activeDefaultTextStyle,
              ),
            ]
          : nextSlides;

        return {
          ...previous,
          slides: finalSlides,
          body: slidesToBody(finalSlides),
          content: {
            ...previous.content,
            slideLabelOptions: getLibraryLabelOptions(previous.content, finalSlides),
          },
        };
      });
    },
    [activeDefaultTextStyle, applyDraft, currentCanvasSize],
  );

  const updateSlide = useCallback(
    (
      slideId: string | null,
      updater: (slide: LibrarySlide) => LibrarySlide,
    ) => {
      if (!slideId) {
        return;
      }

      setSlides((slides) =>
        slides.map((slide) =>
          slide.id === slideId
            ? normalizeLibrarySlide(
                updater(slide),
                currentCanvasSize,
                activeDefaultTextStyle,
              )
            : slide,
        ),
      );
    },
    [activeDefaultTextStyle, currentCanvasSize, setSlides],
  );

  const updateElement = useCallback(
    (
      slideId: string | null,
      elementId: string | null,
      updater: (element: SlideElement) => SlideElement,
    ) => {
      if (!slideId || !elementId) return;

      updateSlide(slideId, (slide: LibrarySlide) => {
        const nextElements = (slide.elements ?? []).map((el: SlideElement) =>
          el.id === elementId ? updater(el) : el
        );

        const primaryText = getPrimarySlideTextFromElements(nextElements, slide.text);

        return {
          ...slide,
          elements: nextElements,
          text: primaryText,
        };
      });
    },
    [updateSlide]
  );

  const setAllTextElementsFontSize = useCallback(
    (nextFontSize: number) => {
      if (!Number.isFinite(nextFontSize)) {
        return;
      }

      const normalizedFontSize = Math.max(8, Math.round(nextFontSize));
      applyDraft((previous) => ({
        ...previous,
        slides: previous.slides.map((slide) => {
          const currentElements = slide.elements ?? [];
          if (currentElements.length === 0) {
            return slide;
          }

          let didChange = false;
          const nextElements = currentElements.map((element) => {
            if (element.type !== "text") {
              return element;
            }

            const currentFontSize = element.style?.fontSize;
            if (currentFontSize === normalizedFontSize) {
              return element;
            }

            didChange = true;
            return {
              ...element,
              style: {
                ...(element.style ?? {}),
                fontSize: normalizedFontSize,
              },
            };
          });

          if (!didChange) {
            return slide;
          }

          return {
            ...slide,
            elements: nextElements,
            text: getPrimarySlideTextFromElements(nextElements, slide.text),
          };
        }),
      }));
    },
    [applyDraft],
  );

  const setAllTextElementsStyle = useCallback(
    (stylePatch: Partial<SlideElementStyle>) => {
      const entries = Object.entries(stylePatch).filter(
        ([, value]) => value !== undefined,
      ) as Array<[keyof SlideElementStyle, SlideElementStyle[keyof SlideElementStyle]]>;

      if (entries.length === 0) {
        return;
      }

      applyDraft((previous) => ({
        ...previous,
        slides: previous.slides.map((slide) => {
          const currentElements = slide.elements ?? [];
          if (currentElements.length === 0) {
            return slide;
          }

          let didChange = false;
          const nextElements = currentElements.map((element) => {
            if (element.type !== "text") {
              return element;
            }

            let elementChanged = false;
            for (const [key, value] of entries) {
              if ((element.style?.[key] ?? undefined) !== value) {
                elementChanged = true;
                break;
              }
            }

            if (!elementChanged) {
              return element;
            }

            didChange = true;
            return {
              ...element,
              style: { ...(element.style ?? {}), ...stylePatch },
            };
          });

          if (!didChange) {
            return slide;
          }

          return {
            ...slide,
            elements: nextElements,
            text: getPrimarySlideTextFromElements(nextElements, slide.text),
          };
        }),
      }));
    },
    [applyDraft],
  );

  // Listen for Theme-modal apply requests. When the Themes modal dispatches
  // a payload, the editor patches the currently-selected slide's text
  // elements with the theme's style and applies the background color. We
  // consume the pending payload after applying so it only fires once.
  const pendingTheme = useThemesModalStore((state) => state.pending);
  const consumePendingTheme = useThemesModalStore(
    (state) => state.consumePending,
  );
  const lastAppliedNonceRef = useRef<number>(0);
  useEffect(() => {
    if (!pendingTheme) return;
    if (pendingTheme.nonce === lastAppliedNonceRef.current) return;
    lastAppliedNonceRef.current = pendingTheme.nonce;

    if (Object.keys(pendingTheme.style).length > 0) {
      setAllTextElementsStyle(pendingTheme.style);
    }

    if (pendingTheme.backgroundColor !== null && selectedSlideId) {
      const bg = pendingTheme.backgroundColor;
      applyDraft((previous) => ({
        ...previous,
        slides: previous.slides.map((slide) =>
          slide.id === selectedSlideId
            ? {
                ...slide,
                backgroundColor: bg,
                useBackgroundColor: true,
              }
            : slide,
        ),
      }));
    }

    toast.success("Theme applied");
    consumePendingTheme();
  }, [
    applyDraft,
    consumePendingTheme,
    pendingTheme,
    selectedSlideId,
    setAllTextElementsStyle,
  ]);

  const handleSelectSlide = useCallback(
    (slideId: string | null) => {
      setSelectedSlideId(slideId);
      setSelectedElementId(null);
      setInspectorTab("slide");
    },
    [setInspectorTab],
  );

  const handleSelectElement = useCallback(
    (elementId: string | null) => {
      setSelectedElementId(elementId);

      if (!elementId) {
        setInspectorTab(lastGeneralInspectorTabRef.current);
        return;
      }

      const nextSelectedElement = selectedSlide?.elements?.find(
        (element) => element.id === elementId,
      );
      const nextInspectorTab = getInspectorTabForElementType(
        nextSelectedElement?.type,
      );

      if (nextInspectorTab) {
        setInspectorTab(nextInspectorTab);
      }
    },
    [selectedSlide?.elements, setInspectorTab],
  );

  const addElement = useCallback(
    (type: SlideElementType) => {
      if (!selectedSlideId) return;

      const newId = `${selectedSlideId}_${type}_${Date.now()}`;
      
      const width =
        type === "text"
          ? Math.round(canvasDimensions.width * 0.9)
          : Math.round(canvasDimensions.width * (800 / 1920));
      const height =
        type === "text"
          ? Math.round(canvasDimensions.height * 0.78)
          : Math.round(canvasDimensions.height * (800 / 1080));
      const x = (canvasDimensions.width - width) / 2;
      const y = (canvasDimensions.height - height) / 2;

      const newElement: SlideElement = {
        id: newId,
        type,
        x,
        y,
        width,
        height,
        content: "",
        isPlaceholder: type === "text",
        style:
          type === "text"
            ? {
                fontSize: 120,
                textAlign: "center",
                verticalAlign: "middle",
                color: "#ffffff",
              }
            : type === "image"
              ? {
                  opacity: 1,
                  borderRadius: 0,
                }
              : {
                  backgroundColor: "#3b82f6",
                  opacity: 1,
                },
      };

      updateSlide(selectedSlideId, (slide) => ({
        ...slide,
        elements: [...(slide.elements ?? []), newElement],
      }));
      setSelectedElementId(newId);
      setInspectorTab(getInspectorTabForElementType(type) ?? "slide");
    },
    [canvasDimensions.height, canvasDimensions.width, selectedSlideId, setInspectorTab, updateSlide]
  );

  const removeElement = useCallback(
    (slideId: string, elementId: string) => {
      updateSlide(slideId, (slide) => ({
        ...slide,
        elements: (slide.elements ?? []).filter((el) => el.id !== elementId),
      }));
      if (selectedElementId === elementId) {
        handleSelectElement(null);
      }
    },
    [handleSelectElement, selectedElementId, updateSlide]
  );

  const reorderSelectedSlideElements = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!selectedSlideId) {
        return;
      }

      updateSlide(selectedSlideId, (slide) => ({
        ...slide,
        elements: reorderSlideElements(slide.elements ?? [], fromIndex, toIndex),
      }));
    },
    [selectedSlideId, updateSlide],
  );

  const moveSelectedElementLayer = useCallback(
    (elementId: string, toIndex: number) => {
      if (!selectedSlideId) {
        return;
      }

      updateSlide(selectedSlideId, (slide) => {
        const elements = slide.elements ?? [];
        const fromIndex = elements.findIndex((element) => element.id === elementId);
        if (fromIndex < 0 || toIndex < 0 || toIndex >= elements.length) {
          return slide;
        }

        return {
          ...slide,
          elements: reorderSlideElements(elements, fromIndex, toIndex),
        };
      });
    },
    [selectedSlideId, updateSlide],
  );

  const selectedSlideBackground = getSlideBackgroundColor(
    selectedSlide ?? undefined,
    draft.content,
  );

  const applyInlineTextFormat = useCallback(
    (command: "bold" | "italic" | "underline" | "strikeThrough") => {
      if (!selectedSlideId || !selectedElementId) {
        return false;
      }

      const activeElement = document.activeElement;
      if (
        !(activeElement instanceof HTMLElement) ||
        activeElement.id !== `text-editor-${selectedElementId}` ||
        !activeElement.isContentEditable
      ) {
        return false;
      }

      activeElement.focus();
      document.execCommand("styleWithCSS", false, "false");
      document.execCommand(command, false);

      updateElement(selectedSlideId, selectedElementId, (element) => ({
        ...element,
        content: activeElement.innerText.replace(/\r\n/g, "\n"),
        richTextHtml: normalizeEditableRichTextHtml(activeElement.innerHTML),
        isPlaceholder: false,
      }));

      return true;
    },
    [selectedElementId, selectedSlideId, updateElement],
  );

  const handleUpdateOutput = useCallback(() => {
    if (!selectedSlide?.elements?.length || !onUpdateOutput) {
      return;
    }

    const baseId =
      libraryItem?.type === "scripture" && selectedSlide.id?.startsWith("scripture:")
        ? selectedSlide.id
        : libraryItem?._id != null
        ? `${libraryItem._id}:${selectedSlide.id ?? Math.max(selectedSlideIndex, 0)}`
        : `draft:${selectedSlide.id ?? Date.now()}`;

    onUpdateOutput({
      slideId: baseId,
      text: selectedSlide.text,
      elements: selectedSlide.elements,
      canvasSize: currentCanvasSize,
      backgroundColor: selectedSlideBackground ?? null,
    });
    toast.success("Output updated");
  }, [
    currentCanvasSize,
    libraryItem?._id,
    libraryItem?.type,
    onUpdateOutput,
    selectedSlide,
    selectedSlideBackground,
    selectedSlideIndex,
  ]);

  const handleManualSave = useCallback(async () => {
    if (!draft.title.trim()) {
      toast.error("Title is required");
      return;
    }

    setIsSaving(true);
    try {
      await persistDraft(draft, true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [draft, persistDraft]);

  // The "Fix / Break Lyrics" button opens a modal asking how many lines per
  // slide. Confirming runs the clean/AI fix AND the slide break in one pass,
  // so the operator gets cleaned, properly-split slides from a single action.
  const handleFix = useCallback(() => {
    if (!draft.body.trim()) {
      toast.error("Add some lyrics first");
      return;
    }
    setBreakDialogOpen(true);
  }, [draft.body]);

  const applyFixAndBreak = useCallback(
    async (linesPerSlide: number) => {
      if (!draft.body.trim()) return;
      setIsFixing(true);
      try {
        // 1. Clean + AI-fix the raw body.
        const fixedBody = await onFixLyrics(draft.body);
        // 2. Re-flow the cleaned body into N-line slides (ignores any
        //    existing slide separators, so re-breaking to a new N works).
        const nextBody = breakLyricsIntoChunks(fixedBody, linesPerSlide);
        const nextSlides = buildSlidesFromBody(
          nextBody,
          currentCanvasSize,
          activeDefaultTextStyle,
        );
        applyDraft(
          (previous) => ({
            ...previous,
            slides: nextSlides,
            body: nextBody,
          }),
          { preserveBody: editorView === "source" },
        );
        setSelectedSlideId(nextSlides[0]?.id ?? null);
        setSelectedElementId(null);
        setInspectorTab("slide");
        toast.success(
          `Cleaned & split into ${nextSlides.length} slide${nextSlides.length === 1 ? "" : "s"} (${linesPerSlide} line${linesPerSlide === 1 ? "" : "s"} each)`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to fix lyrics",
        );
      } finally {
        setIsFixing(false);
      }
    },
    [
      activeDefaultTextStyle,
      applyDraft,
      currentCanvasSize,
      draft.body,
      editorView,
      onFixLyrics,
      setInspectorTab,
    ],
  );

  const handleSourceBodyChange = useCallback(
    (nextBody: string) => {
      const nextSlides = buildSlidesFromBody(
        nextBody,
        currentCanvasSize,
        activeDefaultTextStyle,
      );
      setDraft((previous) =>
        buildDraftWithNormalizedContent(
          {
            ...previous,
            slides: nextSlides,
            body: nextBody,
          },
          nextSlides,
          previous.content,
          activeDefaultTextStyle,
          {
            preserveBody: true,
          },
        ),
      );

      setSelectedSlideId((current) => {
        if (current && nextSlides.some((slide) => slide.id === current)) {
          return current;
        }
        return nextSlides[0]?.id ?? null;
      });
      setSelectedElementId(null);
      setInspectorTab("slide");
    },
    [activeDefaultTextStyle, currentCanvasSize, setInspectorTab],
  );

  const handleAddSlide = useCallback(() => {
    const nextSlide = normalizeLibrarySlide(
      {
        text: "",
        label: "",
      },
      currentCanvasSize,
      activeDefaultTextStyle,
    );

    setSlides((slides) => {
      const nextSlides = [...slides];
      const insertAt =
        selectedSlideIndex >= 0 ? selectedSlideIndex + 1 : nextSlides.length;
      nextSlides.splice(insertAt, 0, nextSlide);
      return nextSlides;
    });
    setSelectedSlideId(nextSlide.id ?? null);
    setSelectedElementId(null);
    setInspectorTab("slide");
  }, [
    activeDefaultTextStyle,
    currentCanvasSize,
    selectedSlideIndex,
    setInspectorTab,
    setSlides,
  ]);

  const handleRemoveSlide = useCallback(
    (slideId: string) => {
      setSlides((slides) => slides.filter((slide) => slide.id !== slideId));
      setSelectedElementId(null);
      setInspectorTab("slide");

      setSelectedSlideId((current) => {
        if (current !== slideId) {
          return current;
        }

        const nextSlides = draft.slides.filter((slide) => slide.id !== slideId);
        return nextSlides[0]?.id ?? null;
      });
    },
    [draft.slides, setInspectorTab, setSlides],
  );

  const handleSlideDragStart = (index: number, event: React.DragEvent<HTMLElement>) => {
    setDraggedSlideIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  };

  const handleSlideDrop = (toIndex: number, fromIndex?: number) => {
    const sourceIndex = fromIndex ?? draggedSlideIndex;

    if (sourceIndex == null || sourceIndex === toIndex) {
      setDraggedSlideIndex(null);
      setDropSlideIndex(null);
      return;
    }

    setSlides((slides) => reorderLibrarySlides(slides, sourceIndex, toIndex));
    setDraggedSlideIndex(null);
    setDropSlideIndex(null);
  };

  const handlePresentationCanvasSizeChange = useCallback(
    (nextCanvasSize: CanvasSizePreset) => {
      applyDraft((previous) => {
        const previousCanvasSize = normalizePresentationSettings(
          previous.content?.presentation,
        ).canvasSize;

        if (previousCanvasSize === nextCanvasSize) {
          return previous;
        }

        return {
          ...previous,
          slides: scaleSlidesToCanvas(
            previous.slides,
            previousCanvasSize,
            nextCanvasSize,
          ),
          content: {
            ...previous.content,
            presentation: {
              ...previous.content?.presentation,
              canvasSize: nextCanvasSize,
            },
          },
        };
      });
    },
    [applyDraft],
  );

  return (
    <div className="h-full w-full bg-background flex flex-col overflow-hidden">
      <EditorHeader
        editorView={editorView}
        setEditorView={setEditorView}
        handleFix={handleFix}
        isFixing={isFixing}
        handleManualSave={handleManualSave}
        isSaving={isSaving}
      />
      {breakDialogOpen && (
        <Dialog
          title="Fix & split lyrics"
          onClose={() => setBreakDialogOpen(false)}
        >
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              We&apos;ll clean up the lyrics, then split them into slides.
              How many lyric lines should each slide hold? Section labels like{" "}
              <span className="font-mono">[Verse 1]</span> are preserved and
              don&apos;t count toward the line total.
            </p>
            <div className="space-y-2">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Lines per slide:{" "}
                <span className="text-foreground">{breakLines}</span>
              </label>
              <input
                type="range"
                aria-label="Lines per slide"
                min={1}
                max={8}
                step={1}
                value={breakLines}
                onChange={(event) => setBreakLines(Number(event.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setBreakDialogOpen(false)}
                className="flex-1 rounded-md border border-input py-2 text-xs font-medium text-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isFixing}
                onClick={() => {
                  setBreakDialogOpen(false);
                  void applyFixAndBreak(breakLines);
                }}
                className="flex-1 rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isFixing ? "Working…" : "Fix & split"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full"
          autoSaveId="present-library-editor-layout-v2"
        >
          <ResizablePanel
            defaultSize={20}
            minSize={16}
            maxSize={30}
            className="bg-background border-r border-border"
          >
            <SlideList
              sidebarTab={sidebarTab}
              setSidebarTab={setSidebarTab}
              slides={draft.slides}
              scrollKey={String(libraryItem?._id ?? "preview")}
              selectedSlideId={selectedSlideId}
              selectedSlide={selectedSlide}
              draggedSlideIndex={draggedSlideIndex}
              dropSlideIndex={dropSlideIndex}
              content={draft.content}
              fontFamily={fontFamily}
              onAddSlide={handleAddSlide}
              onRemoveSlide={handleRemoveSlide}
              onSelectSlide={handleSelectSlide}
              onDragStart={handleSlideDragStart}
              onDrop={handleSlideDrop}
              setDropSlideIndex={setDropSlideIndex}
              setDraggedSlideIndex={setDraggedSlideIndex}
              onSelectElement={handleSelectElement}
              selectedElementId={selectedElementId}
              onUpdateElement={updateElement}
              onReorderElements={reorderSelectedSlideElements}
            />
          </ResizablePanel>
  
          <ResizableHandle withHandle />
  
          <ResizablePanel defaultSize={55} minSize={40}>
            <EditorCanvas
              editorView={editorView}
              draftBody={draft.body}
              sourceFocusSlideIndex={sourceFocusSlideIndex}
              onSourceFocusComplete={() => setSourceFocusSlideIndex(null)}
              onSourceBodyChange={handleSourceBodyChange}
              canvasSize={currentCanvasSize}
              selectedSlide={selectedSlide}
              selectedSlideId={selectedSlideId}
              selectedSlideBackground={selectedSlideBackground}
              updateSlide={updateSlide}
              selectedElementId={selectedElementId}
              onSelectElement={handleSelectElement}
              onAddElement={addElement}
              onUpdateElement={updateElement}
              onRemoveElement={removeElement}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontBold={fontBold}
              fontItalic={fontItalic}
              fontUnderline={fontUnderline}
              onFontStyleChange={onFontStyleChange}
            />
          </ResizablePanel>
  
          <ResizableHandle withHandle />
  
          <ResizablePanel
            defaultSize={25}
            minSize={20}
            maxSize={35}
            className="bg-background border-l border-border"
          >
            <EditorInspector
              inspectorTab={inspectorTab}
              setInspectorTab={(tab) => setInspectorTab(tab as InspectorTab)}
              onPresentationCanvasSizeChange={handlePresentationCanvasSizeChange}
              draft={draft}
              applyDraft={applyDraft}
              selectedSlideId={selectedSlideId}
              selectedSlide={selectedSlide}
              selectedElementId={selectedElementId}
              onUpdateElement={updateElement}
              onMoveElementLayer={moveSelectedElementLayer}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontBold={fontBold}
              fontItalic={fontItalic}
              fontUnderline={fontUnderline}
              onSetAllTextFontSize={setAllTextElementsFontSize}
              onSetAllTextStyle={setAllTextElementsStyle}
              onUpdateOutput={handleUpdateOutput}
              onApplyInlineTextFormat={applyInlineTextFormat}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
});
