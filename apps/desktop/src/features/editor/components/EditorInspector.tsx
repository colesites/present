"use client";

import { memo } from "react";
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsDown,
  ChevronsUp,
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Palette,
  Bold,
  Italic,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Type,
  Underline,
  WandSparkles,
} from "lucide-react";
import { FontFamilySelect } from "../../../renderer/shared/components";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../renderer/shared/components/ui/select";
import {
  getFontWeightOptionsForFamily,
  resolveFontWeightForFamily,
  useFontCatalog,
} from "../../../renderer/shared/hooks/useFontCatalog";
import { normalizeCapitalizationMode } from "../../../renderer/shared/lib/capitalization";
import { cn } from "../../../renderer/shared/lib/utils";
import type {
  CanvasSizePreset,
  LibraryItemDraft,
  LibrarySlide,
  SlideElement,
  SlideElementStyle,
} from "../../../shared/types";
import { normalizePresentationSettings } from "../../library/lib/library-items";

type GeneralInspectorTab = "presentation" | "slide";
type ObjectInspectorTab = "text" | "shape" | "image";
type InspectorTab = GeneralInspectorTab | ObjectInspectorTab;

const GENERAL_TABS: Array<{ id: GeneralInspectorTab; label: string }> = [
  { id: "presentation", label: "Presentation" },
  { id: "slide", label: "Slide" },
];

const OBJECT_TABS: Array<{ id: ObjectInspectorTab; label: string }> = [
  { id: "text", label: "Text" },
  { id: "shape", label: "Shape" },
  { id: "image", label: "Image" },
];

const PRESENTATION_SIZE_OPTIONS = [
  "1920x1080",
  "1280x720",
  "1024x768",
  "800x600",
] as const satisfies readonly CanvasSizePreset[];

const UNTITLED_SLIDE_LABEL_VALUE = "__present_untitled_slide_label__";

const SLIDE_LABEL_OPTIONS = [
  { value: UNTITLED_SLIDE_LABEL_VALUE, label: "Untitled" },
  { value: "Verse 1", label: "Verse 1" },
  { value: "Chorus", label: "Chorus" },
  { value: "Instrumental", label: "Instrumental" },
  { value: "Spoken Word", label: "Spoken Word" },
] as const;

const CAPITALIZATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "allCaps", label: "All Caps" },
  { value: "titleCase", label: "Title Case" },
  { value: "lineStart", label: "First Letter" },
] as const satisfies ReadonlyArray<{
  value: NonNullable<SlideElementStyle["capitalization"]>;
  label: string;
}>;

const TEXT_COLOR_OPTIONS = [
  { value: "#FFFFFF", label: "Pure White" },
  { value: "#F7F2E8", label: "Warm White" },
  { value: "#E7D8C3", label: "Soft Cream" },
  { value: "#C9A56A", label: "Gold" },
  { value: "#8DD6FF", label: "Sky" },
  { value: "#6EE7B7", label: "Mint" },
] as const;

const TEXT_GRADIENT_PRESETS = [
  { value: "none", label: "None", from: "#FFFFFF", to: "#FFFFFF", angle: 90 },
  { value: "ocean", label: "Ocean", from: "#1D4ED8", to: "#22D3EE", angle: 45 },
  { value: "sky", label: "Blue Sky", from: "#2563EB", to: "#38BDF8", angle: 315 },
  { value: "sunrise", label: "Sunrise", from: "#F59E0B", to: "#EF4444", angle: 45 },
  { value: "mint", label: "Mint Glow", from: "#34D399", to: "#22D3EE", angle: 315 },
] as const;

function resolveTextColorOptionLabel(color: string | undefined) {
  const resolvedColor = (color ?? "").toUpperCase();
  return (
    TEXT_COLOR_OPTIONS.find((option) => option.value.toUpperCase() === resolvedColor)
      ?.label ?? "Custom"
  );
}

function resolveTextColorSelectValue(color: string | undefined) {
  const resolvedColor = (color ?? "").toUpperCase();
  const matched = TEXT_COLOR_OPTIONS.find(
    (option) => option.value.toUpperCase() === resolvedColor,
  );

  return matched?.value ?? "custom";
}

function resolveGradientPresetValue(style: SlideElementStyle | null) {
  if (!style || style.textFillMode !== "gradient") {
    return "none";
  }

  const from = style.gradientFromColor?.toUpperCase();
  const to = style.gradientToColor?.toUpperCase();
  const angle = Math.round(style.gradientAngle ?? 90);
  const matchedPreset = TEXT_GRADIENT_PRESETS.find(
    (preset) =>
      preset.value !== "none" &&
      preset.from.toUpperCase() === from &&
      preset.to.toUpperCase() === to &&
      preset.angle === angle,
  );

  return matchedPreset?.value ?? "custom";
}

function getDecorationTokens(value: SlideElementStyle["textDecoration"]) {
  return new Set(
    (value ?? "")
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => Boolean(token) && token !== "none"),
  );
}

function toggleDecoration(
  value: SlideElementStyle["textDecoration"],
  token: "underline" | "line-through",
) {
  const tokens = getDecorationTokens(value);
  if (tokens.has(token)) {
    tokens.delete(token);
  } else {
    tokens.add(token);
  }

  return tokens.size > 0 ? Array.from(tokens).join(" ") : "none";
}

function getObjectInspectorTab(
  type: SlideElement["type"] | undefined,
): ObjectInspectorTab | null {
  if (type === "text" || type === "shape" || type === "image") {
    return type;
  }

  return null;
}

interface EditorInspectorProps {
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  onPresentationCanvasSizeChange: (canvasSize: CanvasSizePreset) => void;
  draft: LibraryItemDraft;
  applyDraft: (updater: (previous: LibraryItemDraft) => LibraryItemDraft) => void;
  selectedSlideId: string | null;
  selectedSlide: LibrarySlide | null;
  selectedElementId: string | null;
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

export const EditorInspector = memo(function EditorInspector({
  inspectorTab,
  setInspectorTab,
  onPresentationCanvasSizeChange,
  draft,
  applyDraft,
  selectedSlideId,
  selectedSlide,
  selectedElementId,
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
  const selectedElement =
    selectedSlide?.elements?.find((element) => element.id === selectedElementId) ??
    null;
  const selectedElementLayerIndex =
    selectedSlide?.elements?.findIndex((element) => element.id === selectedElementId) ??
    -1;
  const elementCount = selectedSlide?.elements?.length ?? 0;
  const selectedObjectTab = getObjectInspectorTab(selectedElement?.type);
  const activeTab: InspectorTab =
    selectedObjectTab ??
    (inspectorTab === "presentation" || inspectorTab === "slide"
      ? inspectorTab
      : "slide");
  const visibleTabs = selectedObjectTab ? OBJECT_TABS : GENERAL_TABS;
  const slideBackgroundColor =
    selectedSlide?.backgroundColor ?? presentation.backgroundColor ?? "#000000";
  const selectedTextStyle = selectedElement?.type === "text"
    ? (selectedElement.style ?? {})
    : null;
  const { faces: fontFaces } = useFontCatalog();
  const selectedTextDecoration = selectedTextStyle?.textDecoration;
  const selectedTextDecorationTokens = getDecorationTokens(selectedTextDecoration);
  const hasExplicitUnderline =
    selectedTextStyle?.fontUnderline !== undefined ||
    selectedTextStyle?.textDecoration !== undefined;
  const selectedTextFontFamily = selectedTextStyle?.fontFamily ?? fontFamily;
  const selectedTextFontSize = selectedTextStyle?.fontSize ?? fontSize;
  const regularTextWeight = resolveFontWeightForFamily(
    fontFaces,
    selectedTextFontFamily,
    "400",
  );
  const boldTextWeight = resolveFontWeightForFamily(
    fontFaces,
    selectedTextFontFamily,
    "700",
  );
  const resolvedTextWeight = resolveFontWeightForFamily(
    fontFaces,
    selectedTextFontFamily,
    selectedTextStyle?.fontWeight ??
      (selectedTextStyle?.fontBold ?? fontBold ? "700" : "400"),
  );
  const numericTextWeight = Number.parseInt(resolvedTextWeight, 10);
  const isTextBold =
    selectedTextStyle?.fontBold ??
    (Number.isFinite(numericTextWeight)
      ? numericTextWeight >= 600
      : fontBold);
  const textWeightOptions = getFontWeightOptionsForFamily(
    fontFaces,
    selectedTextFontFamily,
  );
  const isTextItalic =
    (selectedTextStyle?.fontStyle
      ? selectedTextStyle.fontStyle
      : fontItalic
        ? "italic"
        : "normal") === "italic";
  const isTextUnderline =
    selectedTextDecorationTokens.has("underline") ||
    (selectedTextStyle?.fontUnderline ?? (hasExplicitUnderline ? false : fontUnderline));
  const isTextStrikeThrough =
    selectedTextDecorationTokens.has("line-through");
  const resolvedTextDecoration = (() => {
    const tokens: string[] = [];
    if (isTextUnderline) {
      tokens.push("underline");
    }
    if (isTextStrikeThrough) {
      tokens.push("line-through");
    }
    return tokens.length > 0 ? tokens.join(" ") : "none";
  })();
  const selectedTextColor = selectedTextStyle?.color ?? "#FFFFFF";
  const selectedTextColorSelectValue = resolveTextColorSelectValue(selectedTextColor);
  const selectedTextFillMode = selectedTextStyle?.textFillMode ?? "solid";
  const selectedGradientFrom =
    selectedTextStyle?.gradientFromColor ?? "#2563EB";
  const selectedGradientTo =
    selectedTextStyle?.gradientToColor ?? "#38BDF8";
  const selectedGradientAngle = Math.round(
    selectedTextStyle?.gradientAngle ?? 315,
  );
  const selectedGradientPreset = resolveGradientPresetValue(selectedTextStyle);

  const updateSelectedSlide = (
    updater: (slide: LibrarySlide) => LibrarySlide,
  ) => {
    if (!selectedSlideId) return;

    applyDraft((previous) => ({
      ...previous,
      slides: previous.slides.map((slide) =>
        slide.id === selectedSlideId ? updater(slide) : slide,
      ),
    }));
  };

  const updateSelectedElementStyle = (
    updater: (style: SlideElementStyle) => SlideElementStyle,
  ) => {
    if (!selectedSlideId || !selectedElementId) return;

    onUpdateElement(selectedSlideId, selectedElementId, (element) => ({
      ...element,
      style: updater(element.style ?? {}),
    }));
  };

  const updatePresentation = (
    updater: (
      presentationSettings: NonNullable<LibraryItemDraft["content"]>["presentation"],
    ) => NonNullable<LibraryItemDraft["content"]>["presentation"],
  ) => {
    applyDraft((previous) => ({
      ...previous,
      content: {
        ...previous.content,
        presentation: updater(previous.content?.presentation),
      },
    }));
  };

  const renderTransformSection = (element: SlideElement) => (
    <InspectorSection
      icon={<LayoutTemplate className="h-3.5 w-3.5" />}
      title="Transform"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <InspectorField label="X Position">
          <input
            type="number"
            value={Math.round(element.x)}
            onChange={(event) =>
              onUpdateElement(selectedSlideId, selectedElementId, (current) => ({
                ...current,
                x: parseInt(event.target.value, 10) || 0,
              }))
            }
            className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
          />
        </InspectorField>
        <InspectorField label="Y Position">
          <input
            type="number"
            value={Math.round(element.y)}
            onChange={(event) =>
              onUpdateElement(selectedSlideId, selectedElementId, (current) => ({
                ...current,
                y: parseInt(event.target.value, 10) || 0,
              }))
            }
            className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
          />
        </InspectorField>
        <InspectorField label="Width">
          <input
            type="number"
            value={Math.round(element.width)}
            onChange={(event) =>
              onUpdateElement(selectedSlideId, selectedElementId, (current) => ({
                ...current,
                width: parseInt(event.target.value, 10) || 10,
              }))
            }
            className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
          />
        </InspectorField>
        <InspectorField label="Height">
          <input
            type="number"
            value={Math.round(element.height)}
            onChange={(event) =>
              onUpdateElement(selectedSlideId, selectedElementId, (current) => ({
                ...current,
                height: parseInt(event.target.value, 10) || 10,
              }))
            }
            className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
          />
        </InspectorField>
      </div>
    </InspectorSection>
  );

  const renderLayerSection = (element: SlideElement) => {
    const canMoveBackward = selectedElementLayerIndex > 0;
    const canMoveForward =
      selectedElementLayerIndex >= 0 &&
      selectedElementLayerIndex < elementCount - 1;
    const positionLabel =
      selectedElementLayerIndex === elementCount - 1
        ? "Front"
        : selectedElementLayerIndex === 0
          ? "Back"
          : `Layer ${selectedElementLayerIndex + 1}`;

    return (
      <InspectorSection
        icon={<LayoutTemplate className="h-3.5 w-3.5" />}
        title="Layer"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/55">
              Position
            </span>
            <span className="text-[11px] font-semibold text-foreground/80">
              {positionLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <LayerActionButton
              label="Bring Forward"
              icon={<ArrowUp className="h-3.5 w-3.5" />}
              disabled={!canMoveForward}
              onClick={() =>
                onMoveElementLayer(element.id, selectedElementLayerIndex + 1)
              }
            />
            <LayerActionButton
              label="Send Backward"
              icon={<ArrowDown className="h-3.5 w-3.5" />}
              disabled={!canMoveBackward}
              onClick={() =>
                onMoveElementLayer(element.id, selectedElementLayerIndex - 1)
              }
            />
            <LayerActionButton
              label="Bring To Front"
              icon={<ChevronsUp className="h-3.5 w-3.5" />}
              disabled={!canMoveForward}
              onClick={() => onMoveElementLayer(element.id, elementCount - 1)}
            />
            <LayerActionButton
              label="Send To Back"
              icon={<ChevronsDown className="h-3.5 w-3.5" />}
              disabled={!canMoveBackward}
              onClick={() => onMoveElementLayer(element.id, 0)}
            />
          </div>
        </div>
      </InspectorSection>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-background">
      <div className="flex items-center gap-px border-b border-border bg-muted/20 p-1 pr-2">
        {visibleTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const isLockedObjectTab =
            selectedObjectTab !== null && selectedObjectTab !== tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (!isLockedObjectTab) {
                  setInspectorTab(tab.id);
                }
              }}
              disabled={isLockedObjectTab}
              className={cn(
                "flex-1 rounded-md py-2 text-[10px] font-bold uppercase tracking-widest transition",
                isActive
                  ? "border border-border/50 bg-background text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                isLockedObjectTab &&
                  "cursor-default text-muted-foreground/45 hover:bg-transparent hover:text-muted-foreground/45",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-auto p-4 scrollbar-hide">
        {activeTab === "presentation" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/60 bg-card/40">
              <div className="border-b border-border/60 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={Boolean(presentation.useBackgroundColor)}
                      onChange={(event) =>
                        updatePresentation((current) => ({
                          ...current,
                          useBackgroundColor: event.target.checked,
                          backgroundColor:
                            current?.backgroundColor ??
                            presentation.backgroundColor ??
                            "#2c211b",
                        }))
                      }
                      className="h-4 w-4 rounded-sm border-border accent-primary"
                    />
                    <span>Background</span>
                  </label>

                  <div className="relative h-8 w-16 overflow-hidden rounded-md border border-border bg-background/60">
                    <div
                      className="absolute inset-y-1 left-1 right-6 rounded-sm"
                      style={{
                        backgroundColor:
                          presentation.backgroundColor ?? "#2c211b",
                      }}
                    />
                    <input
                      type="color"
                      value={presentation.backgroundColor ?? "#2c211b"}
                      onChange={(event) =>
                        updatePresentation((current) => ({
                          ...current,
                          backgroundColor: event.target.value,
                          useBackgroundColor: true,
                        }))
                      }
                      className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      disabled={!presentation.useBackgroundColor}
                    />
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex w-6 items-center justify-center border-l border-border/70 bg-card/70">
                      <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
              </div>

              <PresentationInspectorRow label="Size">
                <Select
                  value={presentation.canvasSize ?? "1920x1080"}
                  onValueChange={(value) =>
                    onPresentationCanvasSizeChange(value as CanvasSizePreset)
                  }
                >
                  <SelectTrigger className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESENTATION_SIZE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PresentationInspectorRow>

              <PresentationInspectorRow label="Transition" withBorder>
                <button
                  type="button"
                  className="h-8 w-full rounded-md border border-border bg-muted/35 px-3 text-[11px] font-medium text-muted-foreground"
                >
                  Choose Transition
                </button>
              </PresentationInspectorRow>

              <div className="space-y-2 px-3 py-3">
                <PresentationInspectorField label="Title">
                  <input
                    value={draft.title}
                    onChange={(event) =>
                      applyDraft((previous) => ({
                        ...previous,
                        title: event.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="song"
                  />
                </PresentationInspectorField>

                <PresentationInspectorField label="Artist">
                  <input
                    value={draft.content?.presentation?.artist ?? ""}
                    onChange={(event) =>
                      updatePresentation((current) => ({
                        ...current,
                        artist: event.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </PresentationInspectorField>

                <PresentationInspectorField label="Author">
                  <input
                    value={draft.content?.presentation?.author ?? ""}
                    onChange={(event) =>
                      updatePresentation((current) => ({
                        ...current,
                        author: event.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                  />
                </PresentationInspectorField>
              </div>
            </div>
          </div>
        )}

        {activeTab === "slide" && (
          <div className="space-y-6">
            {!selectedSlide ? (
              <InspectorEmptyState
                icon={<FileText className="h-10 w-10 opacity-10" />}
                title="Select a slide to edit its settings"
              />
            ) : (
              <>
                <div className="rounded-xl border border-border/60 bg-card/40">
                  <div className="space-y-3 px-3 py-3">
                    <PresentationInspectorField label="Label">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          value={
                            selectedSlide.label ?? UNTITLED_SLIDE_LABEL_VALUE
                          }
                          onValueChange={(value) =>
                            updateSelectedSlide((slide) => ({
                              ...slide,
                              label:
                                value === UNTITLED_SLIDE_LABEL_VALUE
                                  ? undefined
                                  : value,
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SLIDE_LABEL_OPTIONS.map((option) => (
                              <SelectItem key={option.label} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="relative h-8 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-background/60">
                          <div
                            className="absolute inset-y-1 left-1 right-6 rounded-sm"
                            style={{
                              backgroundColor:
                                selectedSlide.labelColor ?? "#4f4642",
                            }}
                          />
                          <input
                            type="color"
                            value={selectedSlide.labelColor ?? "#4f4642"}
                            onChange={(event) =>
                              updateSelectedSlide((slide) => ({
                                ...slide,
                                labelColor: event.target.value,
                              }))
                            }
                            className="absolute inset-0 cursor-pointer opacity-0"
                          />
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-6 items-center justify-center border-l border-border/70 bg-card/70">
                            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                      </div>
                    </PresentationInspectorField>
                  </div>

                  <div className="border-y border-border/60 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedSlide.useBackgroundColor)}
                          onChange={(event) =>
                            updateSelectedSlide((slide) => ({
                              ...slide,
                              useBackgroundColor: event.target.checked,
                              backgroundColor:
                                slide.backgroundColor ?? slideBackgroundColor,
                            }))
                          }
                          className="h-4 w-4 rounded-sm border-border accent-primary"
                        />
                        <span>Background</span>
                      </label>

                      <div className="relative h-8 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-background/60">
                        <div
                          className="absolute inset-y-1 left-1 right-6 rounded-sm"
                          style={{
                            backgroundColor: slideBackgroundColor,
                          }}
                        />
                        <input
                          type="color"
                          value={slideBackgroundColor}
                          disabled={!selectedSlide.useBackgroundColor}
                          onChange={(event) =>
                            updateSelectedSlide((slide) => ({
                              ...slide,
                              backgroundColor: event.target.value,
                              useBackgroundColor: true,
                            }))
                          }
                          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                        />
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-6 items-center justify-center border-l border-border/70 bg-card/70">
                          <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-3 py-3">
                    <PresentationInspectorField label="Modifier">
                      <input
                        value={selectedSlide.modifier ?? ""}
                        onChange={(event) =>
                          updateSelectedSlide((slide) => ({
                            ...slide,
                            modifier: event.target.value,
                          }))
                        }
                        className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                        placeholder="Repeat"
                      />
                    </PresentationInspectorField>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "text" && (
          <div className="space-y-6">
            {!selectedElement || selectedElement.type !== "text" ? (
              <InspectorEmptyState
                icon={<Type className="h-10 w-10 opacity-10" />}
                title="Select a text object to edit properties"
              />
            ) : (
              <>
                <div className="rounded-xl border border-border/60 bg-card/40 p-3">
                  <div className="space-y-3">
                    <FontFamilySelect
                      value={selectedTextFontFamily}
                      onChange={(value) =>
                        updateSelectedElementStyle((style) => ({
                          ...style,
                          fontFamily: value,
                          fontWeight: resolveFontWeightForFamily(
                            fontFaces,
                            value,
                            style.fontWeight ?? resolvedTextWeight,
                          ),
                          fontBold:
                            Number.parseInt(
                              resolveFontWeightForFamily(
                                fontFaces,
                                value,
                                style.fontWeight ?? resolvedTextWeight,
                              ),
                              10,
                            ) >= 600,
                        }))
                      }
                      className="h-9 w-full rounded-md border-border bg-muted/45 px-3 text-[12px] font-medium"
                    />

                    <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
                      <Select
                        value={resolvedTextWeight}
                        onValueChange={(value) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            fontBold: Number.parseInt(value, 10) >= 600,
                            fontWeight: value,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(textWeightOptions.length > 0
                            ? textWeightOptions
                            : [
                                { value: "100", label: "Thin 100" },
                                { value: "200", label: "Extra Light 200" },
                                { value: "300", label: "Light 300" },
                                { value: "400", label: "Regular 400" },
                                { value: "500", label: "Medium 500" },
                                { value: "600", label: "Semibold 600" },
                                { value: "700", label: "Bold 700" },
                                { value: "800", label: "Extra Bold 800" },
                                { value: "900", label: "Black 900" },
                              ]
                          ).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <input
                        type="number"
                        value={selectedTextFontSize}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            fontSize: parseInt(event.target.value, 10) || 12,
                          }))
                        }
                        className="h-9 rounded-md border border-border bg-muted/45 px-3 text-right text-[12px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => onSetAllTextFontSize(selectedTextFontSize)}
                        className="h-8 rounded-md border border-border/70 bg-muted/25 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/85 transition hover:bg-muted/45"
                      >
                        Apply size to all slides
                      </button>
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() =>
                          onSetAllTextStyle({
                            fontFamily: selectedTextFontFamily,
                            fontSize: selectedTextFontSize,
                            fontWeight: resolvedTextWeight,
                            fontBold: isTextBold,
                            fontUnderline: isTextUnderline,
                            fontStyle: isTextItalic ? "italic" : "normal",
                            textDecoration: resolvedTextDecoration,
                            color: selectedTextColor,
                            textAlign: selectedTextStyle?.textAlign,
                            verticalAlign: selectedTextStyle?.verticalAlign,
                            textFillMode: selectedTextFillMode,
                            gradientFromColor:
                              selectedTextFillMode === "gradient"
                                ? selectedGradientFrom
                                : undefined,
                            gradientToColor:
                              selectedTextFillMode === "gradient"
                                ? selectedGradientTo
                                : undefined,
                            gradientAngle:
                              selectedTextFillMode === "gradient"
                                ? selectedGradientAngle
                                : undefined,
                            capitalization: selectedTextStyle?.capitalization,
                          })
                        }
                        className="h-8 rounded-md border border-border/70 bg-muted/25 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/85 transition hover:bg-muted/45"
                      >
                        Apply text style to all slides
                      </button>
                    </div>

                    <div className="flex overflow-hidden rounded-md border border-border/70 bg-muted/35">
                      <InspectorIconButton
                        active={isTextBold}
                        onClick={() => {
                          if (onApplyInlineTextFormat("bold")) {
                            return;
                          }
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            fontBold: !isTextBold,
                            fontWeight: !isTextBold ? boldTextWeight : regularTextWeight,
                          }));
                        }}
                        icon={<Bold className="h-3.5 w-3.5" />}
                      />
                      <InspectorIconButton
                        active={isTextItalic}
                        onClick={() => {
                          if (onApplyInlineTextFormat("italic")) {
                            return;
                          }
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            fontStyle: isTextItalic ? "normal" : "italic",
                          }));
                        }}
                        icon={<Italic className="h-3.5 w-3.5" />}
                      />
                      <InspectorIconButton
                        active={isTextUnderline}
                        onClick={() => {
                          if (onApplyInlineTextFormat("underline")) {
                            return;
                          }
                          updateSelectedElementStyle((style) => {
                            const baseDecoration =
                              isTextUnderline &&
                              !getDecorationTokens(style.textDecoration).has(
                                "underline",
                              )
                                ? [style.textDecoration, "underline"]
                                    .filter(
                                      (value) =>
                                        Boolean(value) && value !== "none",
                                    )
                                    .join(" ")
                                : style.textDecoration;
                            const nextDecoration = toggleDecoration(
                              baseDecoration,
                              "underline",
                            );

                            return {
                              ...style,
                              fontUnderline: !isTextUnderline,
                              textDecoration: nextDecoration,
                            };
                          });
                        }}
                        icon={<Underline className="h-3.5 w-3.5" />}
                      />
                      <InspectorIconButton
                        active={isTextStrikeThrough}
                        onClick={() => {
                          if (onApplyInlineTextFormat("strikeThrough")) {
                            return;
                          }
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            textDecoration: toggleDecoration(
                              style.textDecoration,
                              "line-through",
                            ),
                          }));
                        }}
                        icon={<Strikethrough className="h-3.5 w-3.5" />}
                      />
                    </div>

                    <TextInspectorRow label="Capitalization">
                      <Select
                        value={normalizeCapitalizationMode(
                          selectedTextStyle?.capitalization,
                        )}
                        onValueChange={(value) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            capitalization: value as NonNullable<
                              SlideElementStyle["capitalization"]
                            >,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 w-full rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAPITALIZATION_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TextInspectorRow>

                    <TextInspectorRow label="Text Color">
                      <div className="flex items-center gap-2">
                        <Select
                          value={selectedTextColorSelectValue}
                          onValueChange={(value) => {
                            if (value === "custom") {
                              return;
                            }

                            updateSelectedElementStyle((style) => ({
                              ...style,
                              textFillMode: "solid",
                              color: value,
                            }));
                          }}
                        >
                          <SelectTrigger className="h-9 min-w-[9rem] rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TEXT_COLOR_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-block h-3 w-3 rounded-full border border-border/60"
                                    style={{ backgroundColor: option.value }}
                                  />
                                  <span>{option.label}</span>
                                </div>
                              </SelectItem>
                            ))}
                            <SelectItem value="custom">
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-block h-3 w-3 rounded-full border border-border/60"
                                  style={{ backgroundColor: selectedTextColor }}
                                />
                                <span>{resolveTextColorOptionLabel(selectedTextColor)}</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <div className="relative h-9 w-28 overflow-hidden rounded-md border border-border bg-background/60">
                          <div
                            className="absolute inset-y-1 left-1 right-8 rounded-sm"
                            style={{ backgroundColor: selectedTextColor }}
                          />
                          <input
                            type="color"
                            value={selectedTextColor}
                            onChange={(event) =>
                              updateSelectedElementStyle((style) => ({
                                ...style,
                                textFillMode: "solid",
                                color: event.target.value,
                              }))
                            }
                            className="absolute inset-0 cursor-pointer opacity-0"
                          />
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center border-l border-border/70 bg-card/70">
                            <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </div>
                      </div>
                    </TextInspectorRow>

                    <TextInspectorRow label="Text Gradient">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={selectedGradientPreset}
                            onValueChange={(value) => {
                              if (value === "none") {
                                updateSelectedElementStyle((style) => ({
                                  ...style,
                                  textFillMode: "solid",
                                }));
                                return;
                              }

                              if (value === "custom") {
                                updateSelectedElementStyle((style) => ({
                                  ...style,
                                  textFillMode: "gradient",
                                  gradientFromColor:
                                    style.gradientFromColor ?? selectedGradientFrom,
                                  gradientToColor:
                                    style.gradientToColor ?? selectedGradientTo,
                                  gradientAngle: style.gradientAngle ?? selectedGradientAngle,
                                }));
                                return;
                              }

                              const preset = TEXT_GRADIENT_PRESETS.find(
                                (option) => option.value === value,
                              );
                              if (!preset) {
                                return;
                              }

                              updateSelectedElementStyle((style) => ({
                                ...style,
                                textFillMode: "gradient",
                                gradientFromColor: preset.from,
                                gradientToColor: preset.to,
                                gradientAngle: preset.angle,
                              }));
                            }}
                          >
                            <SelectTrigger className="h-9 min-w-[9rem] rounded-md border border-border bg-muted/45 px-3 text-[12px] text-foreground">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TEXT_GRADIENT_PRESETS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                              <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                          </Select>

                          <div className="relative h-9 w-28 overflow-hidden rounded-md border border-border bg-background/60">
                            <div
                              className="absolute inset-y-1 left-1 right-8 rounded-sm"
                              style={{ backgroundColor: selectedGradientFrom }}
                            />
                            <input
                              type="color"
                              value={selectedGradientFrom}
                              onChange={(event) =>
                                updateSelectedElementStyle((style) => ({
                                  ...style,
                                  textFillMode: "gradient",
                                  gradientFromColor: event.target.value,
                                }))
                              }
                              className="absolute inset-0 cursor-pointer opacity-0"
                            />
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center border-l border-border/70 bg-card/70">
                              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          </div>

                          <WandSparkles className="h-3.5 w-3.5 text-muted-foreground/70" />

                          <div className="relative h-9 w-28 overflow-hidden rounded-md border border-border bg-background/60">
                            <div
                              className="absolute inset-y-1 left-1 right-8 rounded-sm"
                              style={{ backgroundColor: selectedGradientTo }}
                            />
                            <input
                              type="color"
                              value={selectedGradientTo}
                              onChange={(event) =>
                                updateSelectedElementStyle((style) => ({
                                  ...style,
                                  textFillMode: "gradient",
                                  gradientToColor: event.target.value,
                                }))
                              }
                              className="absolute inset-0 cursor-pointer opacity-0"
                            />
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center border-l border-border/70 bg-card/70">
                              <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-muted-foreground">
                            Angle
                          </span>
                          <input
                            type="number"
                            min={0}
                            max={360}
                            value={selectedGradientAngle}
                            onChange={(event) =>
                              updateSelectedElementStyle((style) => ({
                                ...style,
                                textFillMode: "gradient",
                                gradientAngle:
                                  Number.parseInt(event.target.value, 10) || 0,
                              }))
                            }
                            className="h-8 w-20 rounded-md border border-border bg-muted/40 px-2 text-right text-[12px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                          />
                        </div>
                      </div>
                    </TextInspectorRow>

                    <div className="space-y-2 rounded-md border border-border/60 bg-background/20 p-2">
                      <div className="grid grid-cols-4 gap-1">
                        <InspectorIconButton
                          active={(selectedTextStyle?.textAlign ?? "center") === "left"}
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              textAlign: "left",
                            }))
                          }
                          icon={<TextAlignStart className="h-4 w-4" />}
                        />
                        <InspectorIconButton
                          active={(selectedTextStyle?.textAlign ?? "center") === "center"}
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              textAlign: "center",
                            }))
                          }
                          icon={<TextAlignCenter className="h-4 w-4" />}
                        />
                        <InspectorIconButton
                          active={(selectedTextStyle?.textAlign ?? "center") === "right"}
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              textAlign: "right",
                            }))
                          }
                          icon={<TextAlignEnd className="h-4 w-4" />}
                        />
                        <InspectorIconButton
                          active={selectedTextStyle?.textAlign === "justify"}
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              textAlign: "justify",
                            }))
                          }
                          icon={<TextAlignJustify className="h-4 w-4" />}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-1">
                        <InspectorIconButton
                          active={(selectedTextStyle?.verticalAlign ?? "middle") === "top"}
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              verticalAlign: "top",
                            }))
                          }
                          icon={<AlignVerticalJustifyStart className="h-4 w-4" />}
                        />
                        <InspectorIconButton
                          active={
                            (selectedTextStyle?.verticalAlign ?? "middle") ===
                            "middle"
                          }
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              verticalAlign: "middle",
                            }))
                          }
                          icon={<AlignVerticalJustifyCenter className="h-4 w-4" />}
                        />
                        <InspectorIconButton
                          active={
                            (selectedTextStyle?.verticalAlign ?? "middle") ===
                            "bottom"
                          }
                          onClick={() =>
                            updateSelectedElementStyle((style) => ({
                              ...style,
                              verticalAlign: "bottom",
                            }))
                          }
                          icon={<AlignVerticalJustifyEnd className="h-4 w-4" />}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {renderTransformSection(selectedElement)}
                {renderLayerSection(selectedElement)}
              </>
            )}
          </div>
        )}

        {activeTab === "shape" && (
          <div className="space-y-6">
            {!selectedElement || selectedElement.type !== "shape" ? (
              <InspectorEmptyState
                icon={<Palette className="h-10 w-10 opacity-10" />}
                title="Select a shape object to edit properties"
              />
            ) : (
              <>
                {renderTransformSection(selectedElement)}
                {renderLayerSection(selectedElement)}

                <InspectorSection
                  icon={<Palette className="h-3.5 w-3.5" />}
                  title="Appearance"
                >
                  <InspectorField label="Fill">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedElement.style?.backgroundColor ?? "#000000"}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            backgroundColor: event.target.value,
                          }))
                        }
                        className="h-8 w-12 cursor-pointer rounded border border-border bg-transparent"
                      />
                      <div className="text-[10px] font-mono uppercase text-muted-foreground">
                        {selectedElement.style?.backgroundColor ?? "#000000"}
                      </div>
                    </div>
                  </InspectorField>
                  <InspectorField label="Opacity">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedElement.style?.opacity ?? 1}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            opacity: parseFloat(event.target.value),
                          }))
                        }
                        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                      />
                      <span className="w-8 text-right text-[10px] font-mono text-muted-foreground">
                        {Math.round((selectedElement.style?.opacity ?? 1) * 100)}%
                      </span>
                    </div>
                  </InspectorField>
                </InspectorSection>

                <InspectorSection
                  icon={<Check className="h-3.5 w-3.5" />}
                  title="Stroke & Radius"
                >
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <InspectorField label="Stroke Color">
                      <input
                        type="color"
                        value={selectedElement.style?.borderColor ?? "#000000"}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            borderColor: event.target.value,
                          }))
                        }
                        className="h-8 w-full cursor-pointer rounded border border-border bg-transparent"
                      />
                    </InspectorField>
                    <InspectorField label="Weight">
                      <input
                        type="number"
                        value={selectedElement.style?.borderWidth ?? 0}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            borderWidth: parseInt(event.target.value, 10) || 0,
                          }))
                        }
                        className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
                      />
                    </InspectorField>
                    <InspectorField label="Radius">
                      <input
                        type="number"
                        value={selectedElement.style?.borderRadius ?? 0}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            borderRadius: parseInt(event.target.value, 10) || 0,
                          }))
                        }
                        className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
                      />
                    </InspectorField>
                  </div>
                </InspectorSection>
              </>
            )}
          </div>
        )}

        {activeTab === "image" && (
          <div className="space-y-6">
            {!selectedElement || selectedElement.type !== "image" ? (
              <InspectorEmptyState
                icon={<ImageIcon className="h-10 w-10 opacity-10" />}
                title="Select an image object to edit properties"
              />
            ) : (
              <>
                <InspectorSection
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  title="Source"
                >
                  <InspectorField label="Image URL">
                    <input
                      value={selectedElement.content}
                      onChange={(event) =>
                        onUpdateElement(selectedSlideId, selectedElementId, (element) => ({
                          ...element,
                          content: event.target.value,
                        }))
                      }
                      className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary/40"
                      placeholder="Paste image URL"
                    />
                  </InspectorField>
                  <p className="text-[10px] text-muted-foreground/55">
                    Paste a remote image URL or a local file URL.
                  </p>
                </InspectorSection>

                {renderTransformSection(selectedElement)}
                {renderLayerSection(selectedElement)}

                <InspectorSection
                  icon={<Palette className="h-3.5 w-3.5" />}
                  title="Appearance"
                >
                  <InspectorField label="Opacity">
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedElement.style?.opacity ?? 1}
                        onChange={(event) =>
                          updateSelectedElementStyle((style) => ({
                            ...style,
                            opacity: parseFloat(event.target.value),
                          }))
                        }
                        className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                      />
                      <span className="w-8 text-right text-[10px] font-mono text-muted-foreground">
                        {Math.round((selectedElement.style?.opacity ?? 1) * 100)}%
                      </span>
                    </div>
                  </InspectorField>
                  <InspectorField label="Radius">
                    <input
                      type="number"
                      value={selectedElement.style?.borderRadius ?? 0}
                      onChange={(event) =>
                        updateSelectedElementStyle((style) => ({
                          ...style,
                          borderRadius: parseInt(event.target.value, 10) || 0,
                        }))
                      }
                      className="h-8 w-full rounded-md border border-border bg-muted/40 px-2 text-[11px] text-foreground"
                    />
                  </InspectorField>
                </InspectorSection>
              </>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-4">
        <button
          type="button"
          onClick={onUpdateOutput}
          disabled={!selectedSlide}
          className={cn(
            "h-10 w-full rounded-md border border-border/70 text-[11px] font-semibold uppercase tracking-[0.18em] transition",
            selectedSlide
              ? "bg-primary/12 text-primary hover:bg-primary/18"
              : "cursor-not-allowed bg-muted/30 text-muted-foreground/50",
          )}
        >
          Update
        </button>
      </div>
    </div>
  );
});

function InspectorSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="text-primary/70">{icon}</div>
        <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
          {title}
        </h3>
      </div>
      <div className="ml-1.5 space-y-4 border-l border-border/50 pl-4 pr-1">
        {children}
      </div>
    </section>
  );
}

function InspectorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="ml-0.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/45">
        {label}
      </span>
      {children}
    </div>
  );
}

function TextInspectorRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function InspectorIconButton({
  active,
  onClick,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onClick}
      className={cn(
        "flex h-9 flex-1 items-center justify-center border-r border-border/70 text-muted-foreground transition last:border-r-0",
        active
          ? "bg-primary/12 text-primary"
          : "bg-transparent hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

function LayerActionButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-9 items-center justify-center gap-2 rounded-md border border-border/70 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] transition",
        disabled
          ? "cursor-not-allowed bg-muted/25 text-muted-foreground/40"
          : "bg-muted/20 text-foreground/80 hover:bg-muted/40",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function PresentationInspectorRow({
  label,
  children,
  withBorder = true,
}: {
  label: string;
  children: React.ReactNode;
  withBorder?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2.5",
        withBorder && "border-b border-border/60",
      )}
    >
      <div className="w-14 shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PresentationInspectorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-14 shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function InspectorEmptyState({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-20 text-center text-muted-foreground/30">
      {icon}
      <p className="mt-4 text-[11px] font-bold uppercase tracking-widest leading-relaxed">
        {title}
      </p>
    </div>
  );
}
