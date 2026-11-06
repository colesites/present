"use client";

import { memo, useEffect, useState, type ReactNode } from "react";
import { getTransitions, type TransitionPreset } from "../../../renderer/tauri/transitions";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  CopyPlus,
  Group,
  Trash2,
  Ungroup,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  FlipHorizontal2,
  FlipVertical2,
  Italic,
  Palette,
  Radio,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
} from "lucide-react";
import { FontFamilySelect } from "../../../renderer/shared/components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";
import {
  ColorInput,
  FillEditor,
  IconToggle,
  NumberInput,
  Segmented,
  SelectInput,
  SliderInput,
  StyleRow,
  StyleSection,
} from "../../../renderer/shared/components/style-controls";
import {
  getFontWeightOptionsForFamily,
  resolveFontWeightForFamily,
  useFontCatalog,
} from "../../../renderer/shared/hooks/useFontCatalog";
import { normalizeCapitalizationMode } from "../../../renderer/shared/lib/capitalization";
import { editableFill, readFill } from "../../../renderer/shared/lib/slide-fill";
import {
  choosePicture,
  cropOf,
  loadPictureSize,
  startCrop,
  withCrop,
  withPicture,
  withoutCrop,
  type Crop,
} from "../lib/pictures";
import {
  SHAPE_PRESETS,
  cornerRadius,
  hasCorners,
  shapeOutline,
  withCornerRadius,
  withShapeOutline,
  withShapePreset,
  type OutlineStyle,
} from "../lib/shapes";
import { BackgroundEditor, type Background } from "../../../renderer/shared/components/BackgroundEditor";
import { useMediaLibraryStore } from "../../../renderer/shared/store/mediaLibrary";
import type { MediaItem } from "../../media/hooks/useMediaFolders";
import { cn } from "../../../renderer/shared/lib/utils";
import { useThemesModalStore } from "../../../renderer/shared/store/themesModal";
import type { ArrangeAction } from "../hooks/useSlideArrange";
import type { SlideCommand } from "../hooks/useSlideCommands";
import { isPictureBackground, pictureBackgroundOf, withPictureBackground } from "../lib/slides";
import type { Alignment } from "../lib/arrange";
import { BUILD_EFFECTS, BUILD_STARTS, buildTimeline, withBuildOrder } from "../lib/builds";
import type {
  CanvasSizePreset,
  LibraryItemDraft,
  LibrarySlide,
  SlideElement,
  SlideElementStyle,
  SlideShapePreset,
  SlideBuild,
} from "../../../shared/types";
import {
  getCanvasSizeDimensions,
  normalizePresentationSettings,
} from "../../library/lib/library-items";
import {
  SHADOW_PRESETS,
  backgroundIdFor,
  findBackgroundMedia,
  parseShadowCss,
  shadowCss,
} from "../../themes/theme-look.mjs";

type GeneralInspectorTab = "presentation" | "slide";
type ObjectInspectorTab = "text" | "shape" | "image" | "video" | "arrange" | "build";
type InspectorTab = GeneralInspectorTab | ObjectInspectorTab;

const PRESENTATION_SIZE_OPTIONS = [
  { value: "1920x1080", label: "1920 × 1080 (16:9)" },
  { value: "1280x720", label: "1280 × 720 (16:9)" },
  { value: "1024x768", label: "1024 × 768 (4:3)" },
  { value: "800x600", label: "800 × 600 (4:3)" },
] as const;

const UNTITLED_SLIDE_LABEL_VALUE = "__present_untitled_slide_label__";
/** The shape picker's value for a shape a deck drew itself. */
const IMPORTED_SHAPE = "__imported__";

const SLIDE_LABEL_OPTIONS = [
  { value: UNTITLED_SLIDE_LABEL_VALUE, label: "Untitled" },
  { value: "Verse 1", label: "Verse 1" },
  { value: "Verse 2", label: "Verse 2" },
  { value: "Verse 3", label: "Verse 3" },
  { value: "Pre-Chorus", label: "Pre-Chorus" },
  { value: "Chorus", label: "Chorus" },
  { value: "Bridge", label: "Bridge" },
  { value: "Tag", label: "Tag" },
  { value: "Ending", label: "Ending" },
  { value: "Instrumental", label: "Instrumental" },
  { value: "Spoken Word", label: "Spoken Word" },
];

const CAPITALIZATION_OPTIONS: Array<{ value: NonNullable<SlideElementStyle["capitalization"]>; label: string }> = [
  { value: "none", label: "As typed" },
  { value: "allCaps", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "titleCase", label: "Title Case" },
  { value: "lineStart", label: "First letter of each line" },
];

const TEXT_COLOR_PRESETS = ["#FFFFFF", "#F7F2E8", "#E7D8C3", "#C9A56A", "#8DD6FF", "#6EE7B7", "#111827"];

const TEXT_GRADIENT_PRESETS = [
  { name: "Ocean", from: "#1D4ED8", to: "#22D3EE", angle: 45 },
  { name: "Blue sky", from: "#2563EB", to: "#38BDF8", angle: 315 },
  { name: "Sunrise", from: "#F59E0B", to: "#EF4444", angle: 45 },
  { name: "Mint", from: "#34D399", to: "#22D3EE", angle: 315 },
  { name: "Aurora", from: "#A78BFA", to: "#22D3EE", angle: 135 },
];

const GENERIC_WEIGHTS = [
  { value: "100", label: "Thin" },
  { value: "200", label: "Extra Light" },
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra Bold" },
  { value: "900", label: "Black" },
];

const TAB_LABELS: Record<InspectorTab, string> = {
  presentation: "Song",
  slide: "Slide",
  text: "Text",
  shape: "Shape",
  image: "Image",
  video: "Movie",
  arrange: "Arrange",
  build: "Build",
};

function getDecorationTokens(value: SlideElementStyle["textDecoration"]) {
  return new Set(
    (value ?? "")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => Boolean(token) && token !== "none"),
  );
}

function withDecoration(
  value: SlideElementStyle["textDecoration"],
  token: "underline" | "line-through",
  on: boolean,
) {
  const tokens = getDecorationTokens(value);
  if (on) tokens.add(token);
  else tokens.delete(token);
  return tokens.size > 0 ? Array.from(tokens).join(" ") : "none";
}

function getObjectInspectorTab(type: SlideElement["type"] | undefined): ObjectInspectorTab | null {
  if (type === "text" || type === "shape" || type === "image" || type === "video") {
    return type;
  }
  return null;
}

/**
 * A slide's background: none, its colour, a gradient or mix a shape paints,
 * or an image or video from the media library (`backgroundId`).
 */
function slideBackground(slide: LibrarySlide, mediaItems: MediaItem[]): Background | null {
  const shape = slide.elements?.find((element) => element.id.endsWith("__theme-bg"));
  const fill = shape ? editableFill(readFill(shape.style?.fill)) : null;
  if (fill) return fill;
  if (slide.backgroundId) {
    const item = findBackgroundMedia(slide.backgroundId, mediaItems);
    return {
      kind: "media",
      mediaId: slide.backgroundId,
      name: item?.name ?? slide.backgroundId,
      mediaType: item?.type === "video" ? "video" : "image",
    };
  }
  return slide.useBackgroundColor && slide.backgroundColor ? { kind: "color", color: slide.backgroundColor } : null;
}

interface EditorInspectorProps {
  /** An imported deck: no song details, slide titles, picture backgrounds. */
  isDeck?: boolean;
  onSlideCommand: (command: SlideCommand, slideId: string | null) => boolean;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  onPresentationCanvasSizeChange: (canvasSize: CanvasSizePreset) => void;
  draft: LibraryItemDraft;
  applyDraft: (updater: (previous: LibraryItemDraft) => LibraryItemDraft) => void;
  selectedSlideId: string | null;
  selectedSlide: LibrarySlide | null;
  selectedElementId: string | null;
  /** Everything picked; more than one shows the Arrange tab. */
  selectedElementIds: string[];
  onArrange: (action: ArrangeAction) => boolean;
  onUpdateElement: (
    slideId: string | null,
    elementId: string | null,
    updater: (el: SlideElement) => SlideElement,
  ) => void;
  onMoveElementLayer: (elementId: string, toIndex: number) => void;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  onSetAllTextFontSize: (fontSize: number) => void;
  onSetAllTextStyle: (style: Partial<SlideElementStyle>) => void;
  onUpdateOutput: () => void;
  onApplyInlineTextFormat: (
    command: "bold" | "italic" | "underline" | "strikeThrough",
  ) => boolean;
}

/**
 * The editor's sidebar: the song, the selected slide, or the selected text
 * box, shape or image, in short sections of the same controls the theme
 * designer uses.
 */
export const EditorInspector = memo(function EditorInspector({
  isDeck = false,
  onSlideCommand,
  inspectorTab,
  setInspectorTab,
  onPresentationCanvasSizeChange,
  draft,
  applyDraft,
  selectedSlideId,
  selectedSlide,
  selectedElementId,
  selectedElementIds,
  onArrange,
  onUpdateElement,
  onMoveElementLayer,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  onSetAllTextFontSize,
  onSetAllTextStyle,
  onUpdateOutput,
  onApplyInlineTextFormat,
}: EditorInspectorProps) {
  const presentation = normalizePresentationSettings(draft.content?.presentation);
  const canvas = getCanvasSizeDimensions(presentation.canvasSize);
  const selectedElement =
    selectedSlide?.elements?.find((element) => element.id === selectedElementId) ?? null;
  const isMultiSelection = selectedElementIds.length > 1;
  const selectedObjectTab: ObjectInspectorTab | null = isMultiSelection
    ? "arrange"
    : getObjectInspectorTab(selectedElement?.type);
  // Build: how one object arrives and leaves, beside its own tab.
  const canBuild = Boolean(selectedElement) && !isMultiSelection;
  const activeTab: InspectorTab =
    inspectorTab === "presentation" || inspectorTab === "slide"
      ? inspectorTab
      : inspectorTab === "build" && canBuild
        ? "build"
        : selectedObjectTab ?? "slide";
  const tabs: InspectorTab[] = [
    "presentation",
    "slide",
    ...(selectedObjectTab ? [selectedObjectTab] : []),
    ...(canBuild ? (["build"] as InspectorTab[]) : []),
  ];

  const updateSelectedSlide = (updater: (slide: LibrarySlide) => LibrarySlide) => {
    if (!selectedSlideId) return;
    applyDraft((previous) => ({
      ...previous,
      slides: previous.slides.map((slide) => (slide.id === selectedSlideId ? updater(slide) : slide)),
    }));
  };

  const updateSelectedElement = (updater: (element: SlideElement) => SlideElement) => {
    if (!selectedSlideId || !selectedElementId) return;
    onUpdateElement(selectedSlideId, selectedElementId, updater);
  };

  const updateSelectedElementStyle = (updater: (style: SlideElementStyle) => SlideElementStyle) =>
    updateSelectedElement((element) => ({ ...element, style: updater(element.style ?? {}) }));

  const updatePresentation = (
    updater: (
      presentationSettings: NonNullable<LibraryItemDraft["content"]>["presentation"],
    ) => NonNullable<LibraryItemDraft["content"]>["presentation"],
  ) => {
    applyDraft((previous) => ({
      ...previous,
      content: { ...previous.content, presentation: updater(previous.content?.presentation) },
    }));
  };

  const setSlideBackground = (fill: Background | null) =>
    updateSelectedSlide((current) => {
      // One background at a time: a colour or media takes the picture's place.
      const elements = (current.elements ?? []).filter(
        (element) => !element.id.endsWith("__theme-bg") && !isPictureBackground(element),
      );
      const slide: LibrarySlide = { ...current, elements };
      delete slide.backgroundId;
      if (!fill) return { ...slide, useBackgroundColor: false };
      // The media layer's, behind a clear slide: a colour would cover it.
      if (fill.kind === "media") return { ...slide, backgroundId: fill.mediaId, useBackgroundColor: false };
      if (fill.kind === "color") return { ...slide, backgroundColor: fill.color, useBackgroundColor: true };
      const base = fill.kind === "gradient" ? fill.from : fill.base;
      const shape: SlideElement = {
        id: backgroundIdFor(slide.id),
        type: "shape",
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
        content: "",
        isLocked: true,
        style: { fill, backgroundColor: base, borderRadius: 0 },
      };
      return { ...slide, elements: [shape, ...elements], backgroundColor: base, useBackgroundColor: true };
    });
  const mediaItems = useMediaLibraryStore((state) => state.items);

  const theme = draft.content?.theme;
  const openThemes = () => useThemesModalStore.getState().open();

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <div className="flex-none border-b border-border p-2">
        <Segmented
          value={activeTab}
          label="Edit"
          onChange={(tab) => setInspectorTab(tab as InspectorTab)}
          options={tabs.map((tab) => ({ value: tab, label: tab === "presentation" && isDeck ? "Deck" : TAB_LABELS[tab] }))}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-hide">
        {activeTab === "presentation" ? (
          <>
            <StyleSection title={isDeck ? "Deck" : "Song"}>
              <StyleRow label="Title">
                <TextField value={draft.title} placeholder={isDeck ? "Deck title" : "Song title"} onChange={(title) => applyDraft((previous) => ({ ...previous, title }))} />
              </StyleRow>
              {isDeck ? null : (<>
              <StyleRow label="Artist">
                <TextField
                  value={draft.content?.presentation?.artist ?? ""}
                  onChange={(artist) => updatePresentation((current) => ({ ...current, artist }))}
                />
              </StyleRow>
              <StyleRow label="Author">
                <TextField
                  value={draft.content?.presentation?.author ?? ""}
                  onChange={(author) => updatePresentation((current) => ({ ...current, author }))}
                />
              </StyleRow>
              </>)}
            </StyleSection>
            <StyleSection title="Slides">
              <StyleRow label="Size">
                <SelectInput
                  label="Slide size"
                  value={presentation.canvasSize ?? "1920x1080"}
                  options={[...PRESENTATION_SIZE_OPTIONS]}
                  onChange={(value) => onPresentationCanvasSizeChange(value as CanvasSizePreset)}
                />
              </StyleRow>
              <StyleRow label="Background">
                <Segmented
                  value={presentation.useBackgroundColor ? "colour" : "none"}
                  label="Song background"
                  onChange={(value) =>
                    updatePresentation((current) => ({
                      ...current,
                      useBackgroundColor: value === "colour",
                      backgroundColor: current?.backgroundColor ?? presentation.backgroundColor ?? "#2c211b",
                    }))
                  }
                  options={[
                    { value: "none", label: "None" },
                    { value: "colour", label: "Colour" },
                  ]}
                />
              </StyleRow>
              {presentation.useBackgroundColor ? (
                <StyleRow label="">
                  <ColorInput
                    label="Song background colour"
                    value={presentation.backgroundColor ?? "#2c211b"}
                    onChange={(backgroundColor) => updatePresentation((current) => ({ ...current, backgroundColor, useBackgroundColor: true }))}
                  />
                </StyleRow>
              ) : null}
              <p className="text-[10px] leading-4 text-muted-foreground">
                Shown behind every slide that has no background of its own.
              </p>
            </StyleSection>
            <ThemeSection name={theme?.name ?? null} onOpen={openThemes} />
          </>
        ) : null}

        {activeTab === "slide" ? (
          !selectedSlide ? (
            <EmptyNote>Select a slide to change it.</EmptyNote>
          ) : (
            <>
              <StyleSection title="Slide">
                <StyleRow label={isDeck ? "Title" : "Label"}>
                  {isDeck ? (
                    <TextField
                      value={selectedSlide.label ?? ""}
                      placeholder="Untitled"
                      onChange={(label) => updateSelectedSlide((slide) => ({ ...slide, label: label || undefined }))}
                    />
                  ) : (
                  <SelectInput
                    label="Slide label"
                    value={selectedSlide.label ?? UNTITLED_SLIDE_LABEL_VALUE}
                    options={
                      selectedSlide.label && !SLIDE_LABEL_OPTIONS.some((option) => option.value === selectedSlide.label)
                        ? [...SLIDE_LABEL_OPTIONS, { value: selectedSlide.label, label: selectedSlide.label }]
                        : SLIDE_LABEL_OPTIONS
                    }
                    onChange={(value) =>
                      updateSelectedSlide((slide) => ({
                        ...slide,
                        label: value === UNTITLED_SLIDE_LABEL_VALUE ? undefined : value,
                      }))
                    }
                  />
                  )}
                  <label
                    className="relative h-8 w-8 flex-none cursor-pointer overflow-hidden rounded-md border border-border"
                    title="Label colour"
                  >
                    <span className="absolute inset-1 rounded-[4px]" style={{ background: selectedSlide.labelColor ?? "#4f4642" }} />
                    <input
                      type="color"
                      aria-label="Label colour"
                      value={selectedSlide.labelColor ?? "#4f4642"}
                      onChange={(event) => updateSelectedSlide((slide) => ({ ...slide, labelColor: event.target.value }))}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                </StyleRow>
                {isDeck ? null : (
                <StyleRow label="Modifier">
                  <TextField
                    value={selectedSlide.modifier ?? ""}
                    placeholder="Repeat, ×2, …"
                    onChange={(modifier) => updateSelectedSlide((slide) => ({ ...slide, modifier }))}
                  />
                </StyleRow>
                )}
              </StyleSection>
              <StyleSection title="Background">
                <BackgroundEditor
                  key={selectedSlide.id}
                  label="Slide background"
                  value={slideBackground(selectedSlide, mediaItems)}
                  noneLabel="None"
                  onChange={setSlideBackground}
                />
                <p className="text-[10px] leading-4 text-muted-foreground">
                  {selectedSlide.backgroundId
                    ? "Plays behind this slide while it is live, in place of the media chosen in Show."
                    : slideBackground(selectedSlide, mediaItems)
                      ? "Covers the media behind this slide."
                      : "None: the song's background, or the media behind it, shows."}
                </p>
                <PictureBackgroundRow
                  url={pictureBackgroundOf(selectedSlide)?.content ?? null}
                  onChange={(url) => updateSelectedSlide((slide) => withPictureBackground(slide, url, canvas))}
                />
                <button
                  type="button"
                  onClick={() => onSlideCommand("backgroundToAll", selectedSlideId)}
                  className="h-8 w-full rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5"
                >
                  Give every slide this background
                </button>
              </StyleSection>
              {isDeck ? (
                <StyleSection title="Speaker notes">
                  <textarea
                    value={selectedSlide.notes ?? ""}
                    placeholder="What to say on this slide. Shown on a stage display's Speaker Notes, never to the room."
                    onChange={(event) => {
                      const notes = event.target.value;
                      updateSelectedSlide((slide) => {
                        const next = { ...slide, notes };
                        if (!notes.trim()) delete next.notes;
                        return next;
                      });
                    }}
                    rows={5}
                    className="min-h-24 w-full resize-y rounded-md border border-border bg-background/40 px-2 py-1.5 text-[12px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
                  />
                </StyleSection>
              ) : null}
              {isDeck ? (
                <SlideTimingSection
                  slide={selectedSlide}
                  onChange={(updater) => updateSelectedSlide(updater)}
                />
              ) : null}
              <ThemeSection name={theme?.name ?? null} onOpen={openThemes} />
            </>
          )
        ) : null}

        {activeTab === "text" && selectedElement?.type === "text" ? (
          <TextInspector
            element={selectedElement}
            canvasWidth={canvas.width}
            fontFamily={fontFamily}
            fontSize={fontSize}
            fontBold={fontBold}
            fontItalic={fontItalic}
            fontUnderline={fontUnderline}
            updateStyle={updateSelectedElementStyle}
            onApplyInlineTextFormat={onApplyInlineTextFormat}
            onSetAllTextFontSize={onSetAllTextFontSize}
            onSetAllTextStyle={onSetAllTextStyle}
          />
        ) : null}

        {activeTab === "build" && selectedElement && selectedSlide ? (
          <BuildSections
            element={selectedElement}
            slide={selectedSlide}
            onChange={updateSelectedElement}
            onChangeSlide={updateSelectedSlide}
          />
        ) : null}

        {activeTab === "video" && selectedElement?.type === "video" ? (
          <>
            <MovieSection element={selectedElement} mediaItems={mediaItems} onChange={updateSelectedElement} />
            <GeometrySections
              element={selectedElement}
              elements={selectedSlide?.elements ?? []}
              onChange={updateSelectedElement}
              onMoveLayer={onMoveElementLayer}
              onAlign={(alignment) => onArrange({ kind: "align", alignment })}
            />
          </>
        ) : null}

        {activeTab === "arrange" && isMultiSelection ? (
          <ArrangeSection
            count={selectedElementIds.length}
            grouped={(selectedSlide?.elements ?? []).some(
              (element) => selectedElementIds.includes(element.id) && element.groupId,
            )}
            onArrange={onArrange}
          />
        ) : null}

        {activeTab === "shape" && selectedElement?.type === "shape" ? (
          <>
            <StyleSection title="Shape">
              <SelectInput
                label="Shape"
                value={selectedElement.geometry ? (selectedElement.geometry.preset ?? IMPORTED_SHAPE) : "rect"}
                options={
                  selectedElement.geometry && !selectedElement.geometry.preset
                    ? [{ value: IMPORTED_SHAPE, label: "As imported" }, ...SHAPE_PRESETS]
                    : SHAPE_PRESETS
                }
                onChange={(value) => {
                  if (value === IMPORTED_SHAPE) return;
                  updateSelectedElement((element) => withShapePreset(element, value as SlideShapePreset));
                }}
              />
            </StyleSection>
            <StyleSection title="Fill">
              <FillEditor
                label="Shape fill"
                value={
                  editableFill(readFill(selectedElement.style?.fill)) ??
                  (selectedElement.style?.backgroundColor && selectedElement.style.backgroundColor !== "transparent"
                    ? { kind: "color", color: selectedElement.style.backgroundColor }
                    : null)
                }
                allowNone
                noneLabel="None"
                onChange={(fill) =>
                  updateSelectedElementStyle((style) => {
                    const next = { ...style };
                    delete next.fill;
                    if (!fill) return { ...next, backgroundColor: "transparent" };
                    if (fill.kind === "color") return { ...next, backgroundColor: fill.color };
                    return { ...next, fill, backgroundColor: fill.kind === "gradient" ? fill.from : fill.base };
                  })
                }
              />
              <StyleRow label="Opacity">
                <SliderInput
                  value={Math.round((selectedElement.style?.opacity ?? 1) * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  label="Opacity"
                  onChange={(percent) => updateSelectedElementStyle((style) => ({ ...style, opacity: percent / 100 }))}
                />
              </StyleRow>
            </StyleSection>
            <ShapeOutlineSection element={selectedElement} onChange={updateSelectedElement} />
            <GeometrySections
              element={selectedElement}
              elements={selectedSlide?.elements ?? []}
              onChange={updateSelectedElement}
              onMoveLayer={onMoveElementLayer}
              onAlign={(alignment) => onArrange({ kind: "align", alignment })}
            />
          </>
        ) : null}

        {activeTab === "image" && selectedElement?.type === "image" ? (
          <>
            <PictureSections element={selectedElement} onChange={updateSelectedElement} />
            <GeometrySections
              element={selectedElement}
              elements={selectedSlide?.elements ?? []}
              onChange={updateSelectedElement}
              onMoveLayer={onMoveElementLayer}
              onAlign={(alignment) => onArrange({ kind: "align", alignment })}
            />
          </>
        ) : null}

        {activeTab === "text" && selectedElement?.type === "text" ? (
          <GeometrySections
            element={selectedElement}
            elements={selectedSlide?.elements ?? []}
            onChange={updateSelectedElement}
            onMoveLayer={onMoveElementLayer}
            onAlign={(alignment) => onArrange({ kind: "align", alignment })}
          />
        ) : null}
      </div>

      <div className="flex-none border-t border-border/60 p-3">
        <button
          type="button"
          onClick={onUpdateOutput}
          disabled={!selectedSlide}
          title="Put this slide, as it is now, on the output"
          className={cn(
            "flex h-9 w-full items-center justify-center gap-2 rounded-md text-[12px] font-semibold transition",
            selectedSlide
              ? "bg-primary/12 text-primary hover:bg-primary/18"
              : "cursor-not-allowed bg-muted/30 text-muted-foreground/50",
          )}
        >
          <Radio className="h-3.5 w-3.5" />
          Update the live slide
        </button>
      </div>
    </div>
  );
});

/** The words: font and weight, emphasis, case, alignment, colour, spacing, shadow, outline. */
function TextInspector({
  element,
  canvasWidth,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  updateStyle,
  onApplyInlineTextFormat,
  onSetAllTextFontSize,
  onSetAllTextStyle,
}: {
  element: SlideElement;
  canvasWidth: number;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  updateStyle: (updater: (style: SlideElementStyle) => SlideElementStyle) => void;
  onApplyInlineTextFormat: (command: "bold" | "italic" | "underline" | "strikeThrough") => boolean;
  onSetAllTextFontSize: (fontSize: number) => void;
  onSetAllTextStyle: (style: Partial<SlideElementStyle>) => void;
}) {
  const style = element.style ?? {};
  const { faces } = useFontCatalog();
  const family = style.fontFamily ?? fontFamily;
  const size = style.fontSize ?? fontSize;
  const weight = resolveFontWeightForFamily(
    faces,
    family,
    style.fontWeight ?? (style.fontBold ?? fontBold ? "700" : "400"),
  );
  const ownWeights = getFontWeightOptionsForFamily(faces, family).map((option) => ({
    value: option.value,
    label: option.label.replace(/\s*\d+$/, "") || option.value,
  }));
  const knownWeights = ownWeights.length > 1 ? ownWeights : GENERIC_WEIGHTS;
  const weightOptions = knownWeights.some((option) => option.value === weight)
    ? knownWeights
    : [...knownWeights, { value: weight, label: weight }].sort((a, b) => Number(a.value) - Number(b.value));
  const isBold = Number.parseInt(weight, 10) >= 600;
  const isItalic = (style.fontStyle ?? (fontItalic ? "italic" : "normal")) === "italic";
  const decorations = getDecorationTokens(style.textDecoration);
  const hasOwnUnderline = style.fontUnderline !== undefined || style.textDecoration !== undefined;
  const isUnderline = decorations.has("underline") || (style.fontUnderline ?? (hasOwnUnderline ? false : fontUnderline));
  const isStrike = decorations.has("line-through");
  const isGradient = style.textFillMode === "gradient";
  const color = style.color ?? "#FFFFFF";
  const from = style.gradientFromColor ?? "#2563EB";
  const to = style.gradientToColor ?? "#38BDF8";
  const angle = Math.round(style.gradientAngle ?? 315);
  const shadow = parseShadowCss(style.shadow);
  const outline = style.strokeWidth && style.strokeWidth > 0 ? { color: style.strokeColor ?? "#000000", width: style.strokeWidth } : null;
  // Sizes and spacing in canvas pixels, as the slide keeps them.
  const pxScale = canvasWidth / 1920;

  const setWeight = (value: string) =>
    updateStyle((current) => ({ ...current, fontWeight: value, fontBold: Number.parseInt(value, 10) >= 600 }));

  const currentStyle = (): Partial<SlideElementStyle> => ({
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    fontBold: isBold,
    fontUnderline: isUnderline,
    fontStyle: isItalic ? "italic" : "normal",
    textDecoration: [isUnderline ? "underline" : "", isStrike ? "line-through" : ""].filter(Boolean).join(" ") || "none",
    color,
    textAlign: style.textAlign,
    verticalAlign: style.verticalAlign,
    textFillMode: isGradient ? "gradient" : "solid",
    gradientFromColor: isGradient ? from : undefined,
    gradientToColor: isGradient ? to : undefined,
    gradientAngle: isGradient ? angle : undefined,
    capitalization: style.capitalization,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    shadow: style.shadow,
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
  });

  return (
    <>
      <StyleSection
        title="Text"
        aside={
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground">
              All slides <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[200] w-60">
              <DropdownMenuItem onSelect={() => onSetAllTextStyle(currentStyle())}>
                Give every slide this text style
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSetAllTextFontSize(size)}>
                Give every slide this size ({size}px)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <FontFamilySelect
          value={family}
          onChange={(value) =>
            updateStyle((current) => {
              const nextWeight = resolveFontWeightForFamily(faces, value, current.fontWeight ?? weight);
              return { ...current, fontFamily: value, fontWeight: nextWeight, fontBold: Number.parseInt(nextWeight, 10) >= 600 };
            })
          }
          className="[&>button]:h-8 [&>button]:text-[12px]"
        />
        <div className="flex gap-1.5">
          <SelectInput label="Weight" value={weight} options={weightOptions} onChange={setWeight} />
          <NumberInput
            value={size}
            min={8}
            max={400}
            suffix="px"
            label="Size"
            onChange={(fontSize) => updateStyle((current) => ({ ...current, fontSize }))}
            className="w-[76px] flex-none"
          />
        </div>
        <div className="flex gap-1.5">
          <FormatToggle
            pressed={isBold}
            label="Bold"
            onPress={() => {
              if (onApplyInlineTextFormat("bold")) return;
              setWeight(resolveFontWeightForFamily(faces, family, isBold ? "400" : "700"));
            }}
          >
            <Bold className="h-3.5 w-3.5" />
          </FormatToggle>
          <FormatToggle
            pressed={isItalic}
            label="Italic"
            onPress={() => {
              if (onApplyInlineTextFormat("italic")) return;
              updateStyle((current) => ({ ...current, fontStyle: isItalic ? "normal" : "italic" }));
            }}
          >
            <Italic className="h-3.5 w-3.5" />
          </FormatToggle>
          <FormatToggle
            pressed={isUnderline}
            label="Underline"
            onPress={() => {
              if (onApplyInlineTextFormat("underline")) return;
              updateStyle((current) => ({
                ...current,
                fontUnderline: !isUnderline,
                textDecoration: withDecoration(current.textDecoration, "underline", !isUnderline),
              }));
            }}
          >
            <Underline className="h-3.5 w-3.5" />
          </FormatToggle>
          <FormatToggle
            pressed={isStrike}
            label="Strikethrough"
            onPress={() => {
              if (onApplyInlineTextFormat("strikeThrough")) return;
              updateStyle((current) => ({
                ...current,
                textDecoration: withDecoration(current.textDecoration, "line-through", !isStrike),
              }));
            }}
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </FormatToggle>
          <SelectInput
            label="Letter case"
            value={normalizeCapitalizationMode(style.capitalization)}
            options={CAPITALIZATION_OPTIONS}
            onChange={(value) =>
              updateStyle((current) => ({ ...current, capitalization: value as NonNullable<SlideElementStyle["capitalization"]> }))
            }
          />
        </div>
        <div className="flex gap-1.5">
          <Segmented
            value={style.textAlign ?? "center"}
            label="Alignment"
            onChange={(textAlign) => updateStyle((current) => ({ ...current, textAlign: textAlign as SlideElementStyle["textAlign"] }))}
            options={[
              { value: "left", label: <TextAlignStart className="h-3.5 w-3.5" />, title: "Left" },
              { value: "center", label: <TextAlignCenter className="h-3.5 w-3.5" />, title: "Centre" },
              { value: "right", label: <TextAlignEnd className="h-3.5 w-3.5" />, title: "Right" },
              { value: "justify", label: <TextAlignJustify className="h-3.5 w-3.5" />, title: "Justify" },
            ]}
          />
          <Segmented
            value={style.verticalAlign ?? "middle"}
            label="Vertical position"
            className="w-[96px] flex-none"
            onChange={(verticalAlign) =>
              updateStyle((current) => ({ ...current, verticalAlign: verticalAlign as SlideElementStyle["verticalAlign"] }))
            }
            options={[
              { value: "top", label: <AlignVerticalJustifyStart className="h-3.5 w-3.5" />, title: "Top" },
              { value: "middle", label: <AlignVerticalJustifyCenter className="h-3.5 w-3.5" />, title: "Middle" },
              { value: "bottom", label: <AlignVerticalJustifyEnd className="h-3.5 w-3.5" />, title: "Bottom" },
            ]}
          />
        </div>
      </StyleSection>

      <StyleSection title="Colour">
        <Segmented
          value={isGradient ? "gradient" : "solid"}
          label="Colour"
          onChange={(value) =>
            updateStyle((current) =>
              value === "gradient"
                ? { ...current, textFillMode: "gradient", gradientFromColor: from, gradientToColor: to, gradientAngle: angle }
                : { ...current, textFillMode: "solid" },
            )
          }
          options={[
            { value: "solid", label: "Solid" },
            { value: "gradient", label: "Gradient" },
          ]}
        />
        {isGradient ? (
          <>
            <div className="flex gap-1.5">
              {TEXT_GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  title={preset.name}
                  aria-label={`${preset.name} gradient`}
                  onClick={() =>
                    updateStyle((current) => ({
                      ...current,
                      textFillMode: "gradient",
                      gradientFromColor: preset.from,
                      gradientToColor: preset.to,
                      gradientAngle: preset.angle,
                    }))
                  }
                  className="h-6 flex-1 rounded-md border border-white/10 hover:ring-1 hover:ring-primary/60"
                  style={{ background: `linear-gradient(90deg, ${preset.from}, ${preset.to})` }}
                />
              ))}
            </div>
            <div className="flex gap-1.5">
              <ColorInput label="Gradient start" value={from} onChange={(value) => updateStyle((current) => ({ ...current, gradientFromColor: value }))} />
              <ColorInput label="Gradient end" value={to} onChange={(value) => updateStyle((current) => ({ ...current, gradientToColor: value }))} />
            </div>
            <StyleRow label="Angle">
              <SliderInput value={angle} min={0} max={360} suffix="°" label="Gradient angle" onChange={(value) => updateStyle((current) => ({ ...current, gradientAngle: value }))} />
            </StyleRow>
          </>
        ) : (
          <>
            <div className="flex gap-1.5">
              {TEXT_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-label={`Colour ${preset}`}
                  title={preset}
                  onClick={() => updateStyle((current) => ({ ...current, textFillMode: "solid", color: preset }))}
                  className={cn(
                    "h-6 flex-1 rounded-md border border-white/10 hover:ring-1 hover:ring-primary/60",
                    color.toUpperCase() === preset && "ring-1 ring-primary",
                  )}
                  style={{ background: preset }}
                />
              ))}
            </div>
            <ColorInput label="Text colour" value={color} onChange={(value) => updateStyle((current) => ({ ...current, textFillMode: "solid", color: value }))} />
          </>
        )}
        <StyleRow label="Opacity">
          <SliderInput
            value={Math.round((style.opacity ?? 1) * 100)}
            min={5}
            max={100}
            suffix="%"
            label="Opacity"
            onChange={(percent) => updateStyle((current) => ({ ...current, opacity: percent / 100 }))}
          />
        </StyleRow>
      </StyleSection>

      <StyleSection title="Spacing">
        <StyleRow label="Letters">
          <SliderInput
            value={Math.round(((style.letterSpacing ?? 0) / pxScale) * 2) / 2}
            min={-10}
            max={40}
            step={0.5}
            suffix="px"
            label="Letter spacing"
            onChange={(value) => updateStyle((current) => ({ ...current, letterSpacing: Math.round(value * pxScale * 100) / 100 }))}
          />
        </StyleRow>
        <StyleRow label="Lines">
          <SliderInput
            value={style.lineHeight ?? 1.2}
            min={0.7}
            max={2.5}
            step={0.05}
            suffix="×"
            label="Line height"
            onChange={(lineHeight) => updateStyle((current) => ({ ...current, lineHeight }))}
          />
        </StyleRow>
      </StyleSection>

      <StyleSection
        title="Shadow"
        enabled={Boolean(shadow)}
        onEnabledChange={(on) => updateStyle((current) => ({ ...current, shadow: on ? shadowCss(SHADOW_PRESETS.soft, pxScale) : "none" }))}
      >
        {shadow ? (
          <>
            <div className="flex gap-1.5">
              {(Object.keys(SHADOW_PRESETS) as Array<keyof typeof SHADOW_PRESETS>).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => updateStyle((current) => ({ ...current, shadow: shadowCss(SHADOW_PRESETS[name], pxScale) }))}
                  className="h-7 flex-1 rounded-md border border-border bg-background/40 text-[11px] capitalize text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  {name}
                </button>
              ))}
            </div>
            <StyleRow label="Colour">
              <ColorInput label="Shadow colour" alpha value={shadow.color} onChange={(value) => updateStyle((current) => ({ ...current, shadow: shadowCss({ ...shadow, color: value }) }))} />
            </StyleRow>
            <StyleRow label="Blur">
              <SliderInput value={shadow.blur} min={0} max={80} suffix="px" label="Shadow blur" onChange={(blur) => updateStyle((current) => ({ ...current, shadow: shadowCss({ ...shadow, blur }) }))} />
            </StyleRow>
            <StyleRow label="Offset">
              <NumberInput value={shadow.x} min={-60} max={60} suffix="x" label="Shadow across" onChange={(x) => updateStyle((current) => ({ ...current, shadow: shadowCss({ ...shadow, x }) }))} className="flex-1" />
              <NumberInput value={shadow.y} min={-60} max={60} suffix="y" label="Shadow down" onChange={(y) => updateStyle((current) => ({ ...current, shadow: shadowCss({ ...shadow, y }) }))} className="flex-1" />
            </StyleRow>
          </>
        ) : null}
      </StyleSection>

      <StyleSection
        title="Outline"
        enabled={Boolean(outline)}
        onEnabledChange={(on) =>
          updateStyle((current) => ({ ...current, strokeWidth: on ? Math.round(4 * pxScale * 100) / 100 : 0, strokeColor: current.strokeColor ?? "#000000" }))
        }
      >
        {outline ? (
          <>
            <StyleRow label="Colour">
              <ColorInput label="Outline colour" alpha value={outline.color} onChange={(strokeColor) => updateStyle((current) => ({ ...current, strokeColor }))} />
            </StyleRow>
            <StyleRow label="Width">
              <SliderInput value={outline.width} min={0.5} max={30} step={0.5} suffix="px" label="Outline width" onChange={(strokeWidth) => updateStyle((current) => ({ ...current, strokeWidth }))} />
            </StyleRow>
          </>
        ) : null}
      </StyleSection>
    </>
  );
}

/** Where an object is and how big, and its place among the others. */
function GeometrySections({
  element,
  elements,
  onChange,
  onMoveLayer,
  onAlign,
}: {
  element: SlideElement;
  elements: SlideElement[];
  onChange: (updater: (element: SlideElement) => SlideElement) => void;
  onMoveLayer: (elementId: string, toIndex: number) => void;
  onAlign: (alignment: Alignment) => void;
}) {
  const index = elements.findIndex((each) => each.id === element.id);
  const last = elements.length - 1;
  const fields: Array<{ key: "x" | "y" | "width" | "height"; name: string; min: number }> = [
    { key: "x", name: "X", min: -4000 },
    { key: "y", name: "Y", min: -4000 },
    { key: "width", name: "W", min: 10 },
    { key: "height", name: "H", min: 10 },
  ];
  return (
    <StyleSection
      title="Position and size"
      aside={
        <span className="flex items-center gap-0.5">
          <LayerButton label="Send to back" disabled={index <= 0} onClick={() => onMoveLayer(element.id, 0)}>
            <ChevronsDown className="h-3.5 w-3.5" />
          </LayerButton>
          <LayerButton label="Send backward" disabled={index <= 0} onClick={() => onMoveLayer(element.id, index - 1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </LayerButton>
          <LayerButton label="Bring forward" disabled={index < 0 || index >= last} onClick={() => onMoveLayer(element.id, index + 1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </LayerButton>
          <LayerButton label="Bring to front" disabled={index < 0 || index >= last} onClick={() => onMoveLayer(element.id, last)}>
            <ChevronsUp className="h-3.5 w-3.5" />
          </LayerButton>
        </span>
      }
    >
      <div className="grid grid-cols-4 gap-1.5">
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase text-muted-foreground">{field.name}</span>
            <NumberInput
              value={Math.round(element[field.key])}
              min={field.min}
              max={8000}
              label={field.name === "W" ? "Width" : field.name === "H" ? "Height" : `${field.name} position`}
              onChange={(value) => onChange((current) => ({ ...current, [field.key]: value }))}
            />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">Rotate</span>
          <NumberInput
            value={Math.round((element.style?.rotation ?? 0) * 10) / 10}
            min={-180}
            max={180}
            suffix="°"
            label="Rotation"
            onChange={(rotation) => onChange((current) => ({ ...current, style: { ...(current.style ?? {}), rotation } }))}
          />
        </label>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">Flip</span>
          <div className="flex gap-1">
            <IconToggle
              pressed={Boolean(element.style?.flipX)}
              label="Flip horizontally"
              onChange={(flipX) => onChange((current) => ({ ...current, style: { ...(current.style ?? {}), flipX } }))}
            >
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </IconToggle>
            <IconToggle
              pressed={Boolean(element.style?.flipY)}
              label="Flip vertically"
              onChange={(flipY) => onChange((current) => ({ ...current, style: { ...(current.style ?? {}), flipY } }))}
            >
              <FlipVertical2 className="h-3.5 w-3.5" />
            </IconToggle>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] font-semibold uppercase text-muted-foreground">Align on the slide</span>
        <AlignButtons onAlign={onAlign} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        {index === last ? "In front of everything" : index === 0 ? "Behind everything" : `Layer ${index + 1} of ${elements.length}`}
      </p>
    </StyleSection>
  );
}

const ALIGN_BUTTONS: Array<{ alignment: Alignment; label: string; icon: ReactNode }> = [
  { alignment: "left", label: "Align left edges", icon: <AlignStartVertical className="h-3.5 w-3.5" /> },
  { alignment: "center", label: "Align centres across", icon: <AlignCenterVertical className="h-3.5 w-3.5" /> },
  { alignment: "right", label: "Align right edges", icon: <AlignEndVertical className="h-3.5 w-3.5" /> },
  { alignment: "top", label: "Align top edges", icon: <AlignStartHorizontal className="h-3.5 w-3.5" /> },
  { alignment: "middle", label: "Align middles", icon: <AlignCenterHorizontal className="h-3.5 w-3.5" /> },
  { alignment: "bottom", label: "Align bottom edges", icon: <AlignEndHorizontal className="h-3.5 w-3.5" /> },
];

function AlignButtons({ onAlign }: { onAlign: (alignment: Alignment) => void }) {
  return (
    <div className="flex gap-0.5">
      {ALIGN_BUTTONS.map((button) => (
        <ArrangeButton key={button.alignment} label={button.label} onClick={() => onAlign(button.alignment)}>
          {button.icon}
        </ArrangeButton>
      ))}
    </div>
  );
}

function ArrangeButton({
  label,
  onClick,
  disabled = false,
  children,
  wide = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={wide ? undefined : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5 disabled:opacity-30",
        wide ? "flex-1 px-2" : "w-8",
      )}
    >
      {children}
    </button>
  );
}

const NO_BUILD = "__none__";

/** A short name for an object in the build order: its words, or its kind. */
function objectName(element: SlideElement): string {
  const words = element.type === "text" ? element.content.replace(/\s+/g, " ").trim() : "";
  if (words) return words.length > 28 ? `${words.slice(0, 27)}…` : words;
  return { text: "Text", shape: "Shape", image: "Picture", video: "Movie", web: "Web" }[element.type] ?? "Object";
}

/** One build's controls: its effect, where from, how long, after what. */
function BuildControls({
  title,
  build,
  onChange,
}: {
  title: string;
  build: SlideBuild | undefined;
  onChange: (build: SlideBuild | undefined) => void;
}) {
  const effect = BUILD_EFFECTS.find((each) => each.value === build?.effect);
  return (
    <StyleSection title={title}>
      <StyleRow label="Effect">
        <SelectInput
          label={`${title} effect`}
          value={build?.effect ?? NO_BUILD}
          options={[{ value: NO_BUILD, label: "None" }, ...BUILD_EFFECTS.map(({ value, label }) => ({ value, label }))]}
          onChange={(value) =>
            onChange(
              value === NO_BUILD
                ? undefined
                : { durationMs: 500, start: "on-click", ...build, effect: value as SlideBuild["effect"] },
            )
          }
        />
      </StyleRow>
      {build ? (
        <>
          {effect?.directed ? (
            <StyleRow label={build.effect === "fly" ? "From" : "Wipe from"}>
              <Segmented
                value={build.direction ?? (build.effect === "fly" ? "bottom" : "left")}
                label="Direction"
                onChange={(direction) => onChange({ ...build, direction: direction as SlideBuild["direction"] })}
                options={[
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" },
                ]}
              />
            </StyleRow>
          ) : null}
          <StyleRow label="Start">
            <SelectInput
              label="Start"
              value={build.start ?? "on-click"}
              options={BUILD_STARTS.map(({ value, label }) => ({ value: value ?? "on-click", label }))}
              onChange={(start) => onChange({ ...build, start: start as SlideBuild["start"] })}
            />
          </StyleRow>
          {build.effect === "appear" ? null : (
            <StyleRow label="Length">
              <NumberInput
                value={build.durationMs ?? 500}
                min={0}
                max={10000}
                suffix="ms"
                label="Build length"
                onChange={(durationMs) => onChange({ ...build, durationMs })}
              />
            </StyleRow>
          )}
          <StyleRow label="Delay">
            <NumberInput
              value={build.delayMs ?? 0}
              min={0}
              max={60000}
              suffix="ms"
              label="Build delay"
              onChange={(delayMs) => onChange({ ...build, delayMs })}
            />
          </StyleRow>
        </>
      ) : null}
    </StyleSection>
  );
}

/**
 * Builds: how the object arrives and leaves, and the order of every build on
 * the slide. On a click, a build waits for Next; with or after the previous
 * one, it follows by itself. What runs before the first click comes with
 * the slide.
 */
function BuildSections({
  element,
  slide,
  onChange,
  onChangeSlide,
}: {
  element: SlideElement;
  slide: LibrarySlide;
  onChange: (updater: (element: SlideElement) => SlideElement) => void;
  onChangeSlide: (updater: (slide: LibrarySlide) => LibrarySlide) => void;
}) {
  const setBuild = (phase: "in" | "out", build: SlideBuild | undefined) =>
    onChange((current) => {
      const builds = { ...(current.builds ?? {}) };
      if (build) {
        // A new build goes after every one already on the slide (those without
        // an order of their own are numbered by layer, well below this).
        const order = builds[phase]?.order ?? 100_000 + buildTimeline(slide.elements ?? []).placed.length;
        builds[phase] = { ...build, order };
      } else {
        delete builds[phase];
      }
      const next = { ...current, builds };
      if (!builds.in && !builds.out) delete next.builds;
      return next;
    });
  const { placed, clickSteps } = buildTimeline(slide.elements ?? []);
  const names = new Map((slide.elements ?? []).map((each) => [each.id, objectName(each)]));
  const move = (index: number, by: -1 | 1) => {
    const order = placed.map((entry) => ({ elementId: entry.elementId, phase: entry.phase }));
    const to = index + by;
    if (to < 0 || to >= order.length) return;
    [order[index], order[to]] = [order[to], order[index]];
    onChangeSlide((current) => ({ ...current, elements: withBuildOrder(current.elements ?? [], order) }));
  };
  return (
    <>
      <BuildControls title="Build in" build={element.builds?.in} onChange={(build) => setBuild("in", build)} />
      <BuildControls title="Build out" build={element.builds?.out} onChange={(build) => setBuild("out", build)} />
      <StyleSection title="Build order">
        {placed.length === 0 ? (
          <p className="text-[10px] leading-4 text-muted-foreground">No builds on this slide yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {placed.map((entry, index) => (
              <div
                key={`${entry.elementId}:${entry.phase}`}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]",
                  entry.elementId === element.id ? "border-primary/60 bg-primary/10" : "border-border",
                )}
              >
                <span className="w-4 shrink-0 text-muted-foreground">{index + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{names.get(entry.elementId) ?? "Object"}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {entry.phase === "in" ? "In" : "Out"}: {BUILD_EFFECTS.find((e) => e.value === entry.build.effect)?.label}
                    {" · "}
                    {entry.step === 0 ? "with the slide" : `click ${entry.step}`}
                  </span>
                </span>
                <LayerButton label="Earlier" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-3 w-3" />
                </LayerButton>
                <LayerButton label="Later" disabled={index === placed.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="h-3 w-3" />
                </LayerButton>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] leading-4 text-muted-foreground">
          {clickSteps === 0
            ? "Everything here comes with the slide."
            : `${clickSteps} ${clickSteps === 1 ? "click" : "clicks"}: Next shows each before going to the next slide.`}
        </p>
      </StyleSection>
    </>
  );
}

const SHOW_TRANSITION = "__show__";

/**
 * A deck's slide timing, as PowerPoint keeps it: its own transition (or the
 * one chosen in Show's footer), moving on by itself after a time, and
 * hidden from the slide show.
 */
function SlideTimingSection({
  slide,
  onChange,
}: {
  slide: LibrarySlide;
  onChange: (updater: (slide: LibrarySlide) => LibrarySlide) => void;
}) {
  const [presets, setPresets] = useState<TransitionPreset[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getTransitions()
      .then((library) => {
        if (!cancelled) setPresets(library.presets);
      })
      .catch((): undefined => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const current = slide.transition ?? null;
  const options = [
    { value: SHOW_TRANSITION, label: "As chosen in Show" },
    ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
  ];
  if (current && !presets.some((preset) => preset.id === current.type)) {
    options.push({ value: current.type, label: current.type });
  }
  const without = <K extends keyof LibrarySlide>(value: LibrarySlide, key: K) => {
    const next = { ...value };
    delete next[key];
    return next;
  };
  return (
    <StyleSection title="Timing">
      <StyleRow label="Transition">
        <SelectInput
          label="Transition"
          value={current?.type ?? SHOW_TRANSITION}
          options={options}
          onChange={(type) =>
            onChange((value) => {
              if (type === SHOW_TRANSITION) return without(value, "transition");
              const preset = presets.find((each) => each.id === type);
              return {
                ...value,
                transition: {
                  type,
                  durationMs: value.transition?.durationMs ?? preset?.defaultDurationMs ?? 700,
                  easing: "ease-in-out",
                  direction: preset?.direction ?? "left",
                  mode: "full-slide",
                },
              };
            })
          }
        />
      </StyleRow>
      {current ? (
        <StyleRow label="Length">
          <NumberInput
            value={current.durationMs}
            min={0}
            max={5000}
            suffix="ms"
            label="Transition length"
            onChange={(durationMs) =>
              onChange((value) =>
                value.transition ? { ...value, transition: { ...value.transition, durationMs } } : value,
              )
            }
          />
        </StyleRow>
      ) : null}
      <StyleRow label="Move on">
        <NumberInput
          value={Math.round((slide.advanceAfterMs ?? 0) / 100) / 10}
          min={0}
          max={3600}
          suffix="s"
          label="Move on by itself after"
          onChange={(seconds) =>
            onChange((value) =>
              seconds > 0 ? { ...value, advanceAfterMs: Math.round(seconds * 1000) } : without(value, "advanceAfterMs"),
            )
          }
        />
      </StyleRow>
      <StyleRow label="In show">
        <Segmented
          value={slide.hidden ? "hidden" : "shown"}
          label="In the slide show"
          onChange={(shown) => onChange((value) => (shown === "hidden" ? { ...value, hidden: true } : without(value, "hidden")))}
          options={[
            { value: "shown", label: "Shown" },
            { value: "hidden", label: "Skipped" },
          ]}
        />
      </StyleRow>
      <p className="text-[10px] leading-4 text-muted-foreground">
        Move on: 0 waits for you. A skipped slide is passed over by Next, a pedal or a remote, and still shows when clicked.
      </p>
    </StyleSection>
  );
}

/**
 * A movie (or a sound) on the slide: it plays in its box when the slide is
 * live, through the same player as the media layer. Another video from the
 * media library can take its place; its poster is the still shown before.
 */
function MovieSection({
  element,
  mediaItems,
  onChange,
}: {
  element: SlideElement;
  mediaItems: MediaItem[];
  onChange: (updater: (element: SlideElement) => SlideElement) => void;
}) {
  const sound = element.style?.mediaKind === "audio";
  const videos = mediaItems.filter((item) => item.type === "video");
  const name = decodeURIComponent(element.content.split("/").pop() ?? "").replace(/\?.*$/, "") || "Movie";
  const choosePoster = async () => {
    const chosen = await choosePicture();
    if (chosen) onChange((current) => ({ ...current, style: { ...(current.style ?? {}), poster: chosen.url } }));
  };
  return (
    <StyleSection title={sound ? "Sound" : "Movie"}>
      <p className="truncate text-[11px] text-foreground/80" title={name}>{name}</p>
      {videos.length > 0 ? (
        <StyleRow label="Replace">
          <SelectInput
            label="Replace the movie"
            value=""
            options={[
              { value: "", label: "A video from Media…" },
              ...videos.map((item) => ({ value: item.url, label: item.name })),
            ]}
            onChange={(url) => {
              if (url) onChange((current) => ({ ...current, content: url, style: { ...(current.style ?? {}), mediaKind: "video" } }));
            }}
          />
        </StyleRow>
      ) : null}
      {sound ? null : (
        <StyleRow label="Poster">
          <button
            type="button"
            onClick={() => void choosePoster()}
            className="h-8 flex-1 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5"
          >
            {element.style?.poster ? "Replace…" : "Choose a picture…"}
          </button>
        </StyleRow>
      )}
      <p className="text-[10px] leading-4 text-muted-foreground">
        {sound
          ? "Plays when the slide is live."
          : "Plays in its box when the slide is live; the poster shows until then. Media chosen while the slide is live takes its place."}
      </p>
    </StyleSection>
  );
}

/** A picture behind the slide, from this computer: choose, replace or remove. */
function PictureBackgroundRow({ url, onChange }: { url: string | null; onChange: (url: string | null) => void }) {
  const choose = async () => {
    const chosen = await choosePicture();
    if (chosen) onChange(chosen.url);
  };
  return (
    <StyleRow label="Picture">
      {url ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <img src={url} alt="" className="h-8 w-14 flex-none rounded border border-border object-cover" />
          <button
            type="button"
            onClick={() => void choose()}
            className="h-8 flex-1 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5"
          >
            Replace…
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="h-8 rounded-md border border-border bg-background/40 px-2 text-[12px] font-medium text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void choose()}
          className="h-8 flex-1 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5"
        >
          Choose a picture…
        </button>
      )}
    </StyleRow>
  );
}

/**
 * Several objects picked: line them up with each other, spread them out,
 * group or ungroup them, duplicate or delete them. Each is one step to undo.
 */
function ArrangeSection({
  count,
  grouped,
  onArrange,
}: {
  count: number;
  grouped: boolean;
  onArrange: (action: ArrangeAction) => boolean;
}) {
  return (
    <>
      <StyleSection title={`${count} objects`}>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">Align with each other</span>
          <AlignButtons onAlign={(alignment) => onArrange({ kind: "align", alignment })} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">Space evenly (three or more)</span>
          <div className="flex gap-1.5">
            <ArrangeButton wide label="Space evenly across" disabled={count < 3} onClick={() => onArrange({ kind: "distribute", axis: "horizontal" })}>
              <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" /> Across
            </ArrangeButton>
            <ArrangeButton wide label="Space evenly down" disabled={count < 3} onClick={() => onArrange({ kind: "distribute", axis: "vertical" })}>
              <AlignVerticalDistributeCenter className="h-3.5 w-3.5" /> Down
            </ArrangeButton>
          </div>
        </div>
      </StyleSection>
      <StyleSection title="Group">
        <div className="flex gap-1.5">
          <ArrangeButton wide label="Group (⌘G)" onClick={() => onArrange({ kind: "group" })}>
            <Group className="h-3.5 w-3.5" /> Group
          </ArrangeButton>
          <ArrangeButton wide label="Ungroup (⇧⌘G)" disabled={!grouped} onClick={() => onArrange({ kind: "ungroup" })}>
            <Ungroup className="h-3.5 w-3.5" /> Ungroup
          </ArrangeButton>
        </div>
        <div className="flex gap-1.5">
          <ArrangeButton wide label="Duplicate (⌘D)" onClick={() => onArrange({ kind: "duplicate" })}>
            <CopyPlus className="h-3.5 w-3.5" /> Duplicate
          </ArrangeButton>
          <ArrangeButton wide label="Delete" onClick={() => onArrange({ kind: "delete" })}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </ArrangeButton>
        </div>
        <p className="text-[10px] leading-4 text-muted-foreground">
          Shift-click to pick more, or drag across the slide. ⌘C, ⌘V and ⌘D copy, paste and duplicate; the arrows nudge.
        </p>
      </StyleSection>
    </>
  );
}

/**
 * A picture: which one, how it fits its box, its crop, opacity and corners.
 * A crop replaces the fit: the part left is the box.
 */
function PictureSections({
  element,
  onChange,
}: {
  element: SlideElement;
  onChange: (updater: (element: SlideElement) => SlideElement) => void;
}) {
  const hasPicture = Boolean(element.content?.trim());
  const crop = element.style?.crop ?? null;
  const choose = async () => {
    const chosen = await choosePicture();
    if (chosen) onChange((current) => withPicture(current, chosen.url, chosen.size));
  };
  const beginCrop = async () => {
    const size = await loadPictureSize(element.content);
    if (size) onChange((current) => startCrop(current, size));
  };
  const setSide = (side: keyof Crop, percent: number) =>
    onChange((current) => withCrop(current, { ...cropOf(current), [side]: percent / 100 }));

  return (
    <>
      <StyleSection title="Picture">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => void choose()}
            className="h-8 flex-1 rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5"
          >
            {hasPicture ? "Replace…" : "Choose a picture…"}
          </button>
        </div>
        {crop ? (
          <p className="text-[10px] leading-4 text-muted-foreground">Cropped: the box shows the part kept.</p>
        ) : (
          <StyleRow label="Fit">
            <Segmented
              value={element.style?.objectFit ?? "cover"}
              label="Fit"
              onChange={(objectFit) =>
                onChange((current) => ({
                  ...current,
                  style: { ...(current.style ?? {}), objectFit: objectFit as SlideElementStyle["objectFit"] },
                }))
              }
              options={[
                { value: "cover", label: "Fill" },
                { value: "contain", label: "Fit" },
                { value: "fill", label: "Stretch" },
              ]}
            />
          </StyleRow>
        )}
        <StyleRow label="Opacity">
          <SliderInput
            value={Math.round((element.style?.opacity ?? 1) * 100)}
            min={0}
            max={100}
            suffix="%"
            label="Opacity"
            onChange={(percent) => onChange((current) => ({ ...current, style: { ...(current.style ?? {}), opacity: percent / 100 } }))}
          />
        </StyleRow>
        <StyleRow label="Corners">
          <SliderInput
            value={element.style?.borderRadius ?? 0}
            min={0}
            max={Math.max(1, Math.round(Math.min(element.width, element.height) / 2))}
            suffix="px"
            label="Corner radius"
            onChange={(borderRadius) => onChange((current) => ({ ...current, style: { ...(current.style ?? {}), borderRadius } }))}
          />
        </StyleRow>
        <StyleRow label="Link">
          <TextField
            value={element.content}
            placeholder="Or paste a picture's address"
            onChange={(content) => onChange((current) => ({ ...current, content }))}
          />
        </StyleRow>
      </StyleSection>
      {hasPicture ? (
        <StyleSection
          title="Crop"
          aside={
            crop ? (
              <button
                type="button"
                onClick={() => onChange((current) => withoutCrop(current))}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              >
                Reset
              </button>
            ) : null
          }
        >
          {crop ? (
            (["left", "right", "top", "bottom"] as const).map((side) => (
              <StyleRow key={side} label={side[0].toUpperCase() + side.slice(1)}>
                <SliderInput
                  value={Math.round(crop[side] * 100)}
                  min={0}
                  max={90}
                  suffix="%"
                  label={`Crop ${side}`}
                  onChange={(percent) => setSide(side, percent)}
                />
              </StyleRow>
            ))
          ) : (
            <button
              type="button"
              onClick={() => void beginCrop()}
              className="h-8 w-full rounded-md border border-border bg-background/40 text-[12px] font-medium text-foreground transition hover:bg-foreground/5"
            >
              Crop the picture
            </button>
          )}
        </StyleSection>
      ) : null}
    </>
  );
}

/**
 * A shape's outline and corners. An imported shape keeps its outline on its
 * paths (`style.line`), a plain box in its border: `shapes.ts` reads and
 * writes either, so the controls work the same on both.
 */
function ShapeOutlineSection({
  element,
  onChange,
}: {
  element: SlideElement;
  onChange: (updater: (element: SlideElement) => SlideElement) => void;
}) {
  const outline = shapeOutline(element);
  const corners = hasCorners(element);
  return (
    <StyleSection title="Outline">
      <StyleRow label="Line">
        <ColorInput
          label="Outline colour"
          alpha
          value={outline.color}
          onChange={(color) => onChange((current) => withShapeOutline(current, { color, width: Math.max(shapeOutline(current).width, 1) }))}
        />
        <NumberInput
          value={Math.round(outline.width * 10) / 10}
          min={0}
          max={100}
          suffix="px"
          label="Outline width"
          onChange={(width) => onChange((current) => withShapeOutline(current, { width }))}
          className="w-[64px] flex-none"
        />
      </StyleRow>
      {outline.width > 0 ? (
        <StyleRow label="Style">
          <Segmented
            value={outline.style}
            label="Outline style"
            onChange={(style) => onChange((current) => withShapeOutline(current, { style: style as OutlineStyle }))}
            options={[
              { value: "solid", label: "Solid" },
              { value: "dashed", label: "Dashed" },
              { value: "dotted", label: "Dotted" },
            ]}
          />
        </StyleRow>
      ) : null}
      {corners ? (
        <StyleRow label="Corners">
          <SliderInput
            value={Math.round(cornerRadius(element))}
            min={0}
            max={Math.max(1, Math.round(Math.min(element.width, element.height) / 2))}
            suffix="px"
            label="Corner radius"
            onChange={(radius) => onChange((current) => withCornerRadius(current, radius))}
          />
        </StyleRow>
      ) : null}
    </StyleSection>
  );
}

/** A bold/italic toggle that keeps the text selection in the canvas. */
function FormatToggle({
  pressed,
  label,
  onPress,
  children,
}: {
  pressed: boolean;
  label: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <span onMouseDown={(event) => event.preventDefault()} className="contents">
      <IconToggle pressed={pressed} onChange={onPress} label={label}>
        {children}
      </IconToggle>
    </span>
  );
}

function LayerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background/40 px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/60"
    />
  );
}

/** The song's theme, and the way to the Themes panel. */
function ThemeSection({ name, onOpen }: { name: string | null; onOpen: () => void }) {
  return (
    <StyleSection title="Theme">
      <div className="flex items-center gap-2">
        <Palette className="h-3.5 w-3.5 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{name ?? "No theme"}</span>
        <button
          type="button"
          onClick={onOpen}
          className="h-7 flex-none rounded-md border border-border bg-background/40 px-2.5 text-[11px] font-medium text-foreground hover:border-primary/50"
        >
          {name ? "Change" : "Choose a theme"}
        </button>
      </div>
    </StyleSection>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-[12px] text-muted-foreground">{children}</p>;
}
