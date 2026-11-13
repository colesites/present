"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { 
  Image as ImageIcon, 
  Redo2,
  Square, 
  Type, 
  Undo2,
} from "lucide-react";
import { AutoFitText } from "../../../renderer/shared/components/AutoFitText";
import { applyCapitalization } from "../../../renderer/shared/lib/capitalization";
import {
  normalizeEditableRichTextHtml,
  plainTextToHtml,
} from "../../../renderer/shared/lib/rich-text";
import { cn } from "../../../renderer/shared/lib/utils";
import type {
  CanvasSizePreset,
  LibrarySlide,
  SlideElement,
  SlideElementStyle,
  SlideElementType,
  SlideShapePreset,
} from "../../../shared/types";
import { getCanvasSizeDimensions } from "../../library/lib/library-items";
import { SlideMediaBackdrop } from "../../../renderer/shared/components/SlideMediaBackdrop";
import { CanvasSlideLayer } from "../../../renderer/shared/components/CanvasSlideLayer";
import { fontStack } from "../../../shared/lib/font-fallback.mjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../renderer/shared/components/ui/dropdown-menu";
import { SHAPE_PRESETS, presetGeometry } from "../lib/shapes";
import { resizeBox, rotationToward } from "../lib/box-transform";
import { choosePicture, withPicture } from "../lib/pictures";
import { isPictureBackground } from "../lib/slides";
import {
  boundsOf,
  elementBounds,
  intersects,
  snapMove,
  withGroups,
  type Bounds,
  type Guide,
} from "../lib/arrange";
import { buildTimeline } from "../lib/builds";
import { useBuildPreviewStore } from "../lib/build-preview";
import { BuildPreviewLayer } from "./BuildPreviewLayer";
import {
  SLIDE_PX_VAR,
  textBodyToEditableHtml,
  withEditedTextBody,
  type EditableNode,
} from "../lib/text-body";

/**
 * What the slide renderer draws in the editor: everything the screens show,
 * as they show it, but a song's plain words and web slides, which the editor
 * still lays out itself, and the box being typed in.
 */
function drawnByRenderer(element: SlideElement, editingElementId: string | null) {
  if (element.id === editingElementId) return false;
  if (element.type === "web") return false;
  if (element.type === "text" && !element.textBody) return false;
  return true;
}

/** A theme's or a picture background, behind the slide's objects. */
const isSlideBackground = (element: SlideElement) =>
  isPictureBackground(element) || element.id.endsWith("__theme-bg");

/**
 * The object drawn on top at a point on screen: the first of the slide's
 * boxes under it that takes the pointer. Backgrounds and hidden objects do
 * not, so they are passed over.
 */
function elementOnTopAt(
  canvas: HTMLElement | null,
  elements: SlideElement[],
  clientX: number,
  clientY: number,
): SlideElement | null {
  if (!canvas) return null;
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const host = node instanceof HTMLElement ? node.closest<HTMLElement>("[data-element-id]") : null;
    if (host && canvas.contains(host)) {
      return elements.find((each) => each.id === host.dataset.elementId) ?? null;
    }
  }
  return null;
}

/** Bullets for an imported box while it is typed in, hung as the slide draws them. */
const EDITABLE_TEXT_CSS = `
.slide-text-editor [data-bullet]::before {
  content: attr(data-bullet);
  display: inline-block;
  min-width: var(--bullet-width, 0.6em);
  text-indent: 0;
}
`;

interface EditorCanvasProps {
  editorView: "slides" | "source";
  draftBody: string;
  sourceFocusSlideIndex?: number | null;
  onSourceFocusComplete?: () => void;
  onSourceBodyChange: (body: string) => void;
  canvasSize: CanvasSizePreset;
  selectedSlide: LibrarySlide | null;
  selectedSlideId: string | null;
  selectedSlideBackground: string | null;
  updateSlide: (id: string | null, updater: (slide: LibrarySlide) => LibrarySlide) => void;
  selectedElementId: string | null;
  /** Everything picked; `selectedElementId` is the one the inspector edits. */
  selectedElementIds: string[];
  onSelectElement: (id: string | null) => void;
  onSelectElements: (ids: string[], primary?: string | null) => void;
  onAddElement: (type: SlideElementType, preset?: SlideShapePreset) => void;
  onUpdateElement: (slideId: string | null, elementId: string | null, updater: (el: SlideElement) => SlideElement) => void;
  onUpdateElements: (slideId: string | null, updater: (elements: SlideElement[]) => SlideElement[]) => void;
  onRemoveElement: (slideId: string, elementId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  onFontStyleChange: (styles: {
    fontFamily?: string;
    fontSize?: number;
    fontBold?: boolean;
    fontItalic?: boolean;
    fontUnderline?: boolean;
  }) => void;
  /** The Build tab is open: each object with builds shows its place in the order. */
  showBuildOrder?: boolean;
}

type InteractionMode = "none" | "dragging" | "resizing" | "rotating" | "groupResizing" | "marquee";
/** How near, in screen pixels, a moved object snaps to an edge or centre. */
const SNAP_SCREEN_PX = 6;
/** How far the pointer goes before a press becomes a drag. */
const DRAG_START_SCREEN_PX = 3;
const EDITOR_PREVIEW_TEXT_SIZE_MULTIPLIER = 0.25;

function getLyricBlockRange(body: string, slideIndex: number) {
  if (slideIndex < 0) {
    return null;
  }

  const blockPattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  let match: RegExpExecArray | null;
  let currentIndex = 0;

  while ((match = blockPattern.exec(body)) != null) {
    if (currentIndex === slideIndex) {
      return {
        start: match.index,
        end: match.index + match[0].length,
      };
    }
    currentIndex += 1;
  }

  return null;
}

export const EditorCanvas = memo(function EditorCanvas({
  editorView,
  draftBody,
  sourceFocusSlideIndex,
  onSourceFocusComplete,
  onSourceBodyChange,
  canvasSize,
  selectedSlide,
  selectedSlideId,
  selectedSlideBackground,
  selectedElementId,
  selectedElementIds,
  onSelectElement,
  onSelectElements,
  onAddElement,
  onUpdateElement,
  onUpdateElements,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  showBuildOrder = false,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const canvasDimensions = getCanvasSizeDimensions(canvasSize);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const editingContentRef = useRef<string>("");
  // Screen pixels for each canvas pixel, for the words being typed.
  const [slidePx, setSlidePx] = useState(0);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setSlidePx(canvas.getBoundingClientRect().width / canvasDimensions.width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasDimensions.width, editorView]);

  const rendererElements = useMemo(
    () => (selectedSlide?.elements ?? []).filter((element) => drawnByRenderer(element, editingElementId)),
    [editingElementId, selectedSlide?.elements],
  );
  const libraryStyle = useMemo(
    () => ({ fontFamily, fontSize, fontBold, fontItalic, fontUnderline }),
    [fontBold, fontFamily, fontItalic, fontSize, fontUnderline],
  );
  const [interaction, setInteraction] = useState<{
    mode: InteractionMode;
    elementId: string | null;
    handle: string | null;
    pointerId: number;
    startX: number;
    startY: number;
    startElX: number;
    startElY: number;
    startElW: number;
    startElH: number;
    rotation: number;
    flipX: boolean;
    flipY: boolean;
    isImage: boolean;
    /** The box's centre on screen, for turning it. */
    centreX: number;
    centreY: number;
    /** Everything moving or resizing, where each started. */
    ids: string[];
    starts: Record<string, { x: number; y: number; width: number; height: number }>;
    startBounds: Bounds | null;
    /** The frames of what is not moving, to snap to. */
    others: Bounds[];
    /** A drag has begun: the pointer went far enough. */
    moved: boolean;
    /** A box drawn from the empty slide: adding to what was picked. */
    baseIds: string[];
  } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Bounds | null>(null);
  /**
   * Where a press on the selected object's frame began. Released without
   * moving, it was a click, and picks whatever is on top there — so a drag
   * anywhere in the frame moves the selected object, even under another,
   * while a click still reaches the one in front.
   */
  const clickThroughRef = useRef<{ x: number; y: number } | null>(null);

  // Auto-focus text element when entering edit mode
  // useLayoutEffect prevents visual flash (runs before paint)
  useLayoutEffect(() => {
    if (editingElementId) {
      const el = document.getElementById(`text-editor-${editingElementId}`);
      if (el) {
        // Set content imperatively to avoid React/contentEditable conflicts
        el.innerHTML = editingContentRef.current;
        el.focus({ preventScroll: true });
        el.scrollTop = 0;

        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(el);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }, [editingElementId]);

  useEffect(() => {
    if (editorView !== "source" || sourceFocusSlideIndex == null) {
      return;
    }

    const textarea = sourceTextareaRef.current;
    const range = getLyricBlockRange(draftBody, sourceFocusSlideIndex);
    if (!textarea || !range) {
      onSourceFocusComplete?.();
      return;
    }

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(range.end, range.end);
      const lineCount = draftBody.slice(0, range.start).split("\n").length;
      textarea.scrollTop = Math.max(0, (lineCount - 3) * 26);
      onSourceFocusComplete?.();
    });
  }, [draftBody, editorView, onSourceFocusComplete, sourceFocusSlideIndex]);

  // Escape leaves the words being typed. Delete and the other keys are the
  // editor's (`useSlideArrange`), for everything picked.
  useEffect(() => {
    if (!editingElementId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingElementId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingElementId]);

  // Interaction handlers (Drag & Resize)
  const elements = useMemo(() => selectedSlide?.elements ?? [], [selectedSlide?.elements]);
  // More than one object picked, or a group: one frame for them all.
  const isMultiSelection = selectedElementIds.length > 1;
  const selectionBounds = isMultiSelection ? boundsOf(elements, selectedElementIds) : null;
  const selectedElement = isMultiSelection
    ? null
    : (elements.find((each) => each.id === selectedElementId) ?? null);

  // A build preview for this slide, played over it.
  const buildPreview = useBuildPreviewStore((state) => state.preview);
  const stopBuildPreview = useBuildPreviewStore((state) => state.stop);
  const previewing = buildPreview && buildPreview.slideId === selectedSlideId ? buildPreview : null;
  // Another slide chosen, or the editor left: the preview ends.
  useEffect(() => {
    if (buildPreview && buildPreview.slideId !== selectedSlideId) stopBuildPreview();
  }, [buildPreview, selectedSlideId, stopBuildPreview]);
  useEffect(() => () => useBuildPreviewStore.getState().stop(), []);

  // Each object's builds, numbered as the build order lists them.
  const buildBadges = useMemo(() => {
    if (!showBuildOrder) return new Map<string, string>();
    const badges = new Map<string, string[]>();
    buildTimeline(elements).placed.forEach((placed, index) => {
      const list = badges.get(placed.elementId) ?? [];
      list.push(`${index + 1}${placed.phase === "out" ? "↑" : ""}`);
      badges.set(placed.elementId, list);
    });
    return new Map([...badges].map(([id, list]) => [id, list.join(" ")]));
  }, [elements, showBuildOrder]);
  const percentBox = (bounds: Bounds) => ({
    left: `${(bounds.left / canvasDimensions.width) * 100}%`,
    top: `${(bounds.top / canvasDimensions.height) * 100}%`,
    width: `${((bounds.right - bounds.left) / canvasDimensions.width) * 100}%`,
    height: `${((bounds.bottom - bounds.top) / canvasDimensions.height) * 100}%`,
  });

  const beginInteraction = (
    e: React.PointerEvent,
    mode: InteractionMode,
    element: SlideElement | null,
    ids: string[],
    handle: string | null = null,
    baseIds: string[] = [],
  ) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    const toScreen = bounds ? bounds.width / canvasDimensions.width : 1;
    const moving = new Set(ids);
    const starts: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const each of elements) {
      if (moving.has(each.id) && !each.isLocked) {
        starts[each.id] = { x: each.x, y: each.y, width: each.width, height: each.height };
      }
    }
    setInteraction({
      mode,
      elementId: element?.id ?? null,
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startElX: element?.x ?? 0,
      startElY: element?.y ?? 0,
      startElW: element?.width ?? 0,
      startElH: element?.height ?? 0,
      rotation: element?.style?.rotation ?? 0,
      flipX: Boolean(element?.style?.flipX),
      flipY: Boolean(element?.style?.flipY),
      isImage: element?.type === "image",
      centreX: (bounds?.left ?? 0) + ((element?.x ?? 0) + (element?.width ?? 0) / 2) * toScreen,
      centreY: (bounds?.top ?? 0) + ((element?.y ?? 0) + (element?.height ?? 0) / 2) * toScreen,
      ids: Object.keys(starts),
      starts,
      startBounds: boundsOf(elements, Object.keys(starts)),
      others: elements
        .filter((each) => !moving.has(each.id) && each.isVisible !== false)
        .map(elementBounds),
      moved: false,
      baseIds,
    });
  };

  /**
   * A press on an object: picks it (with its group), or with Shift or ⌘
   * adds it to what is picked or takes it out. A press on something
   * already picked keeps the rest, so they are dragged together.
   */
  const handleElementPointerDown = (e: React.PointerEvent, element: SlideElement) => {
    e.stopPropagation();
    const unit = withGroups(elements, [element.id]);
    let ids: string[];
    if (e.shiftKey || e.metaKey) {
      const removing = selectedElementIds.includes(element.id);
      ids = removing
        ? selectedElementIds.filter((id) => !unit.includes(id))
        : [...selectedElementIds, ...unit.filter((id) => !selectedElementIds.includes(id))];
      onSelectElements(ids, removing ? (ids[0] ?? null) : element.id);
      if (removing) return;
    } else if (selectedElementIds.includes(element.id)) {
      ids = selectedElementIds;
    } else {
      ids = unit;
      onSelectElements(ids, element.id);
    }
    beginInteraction(e, "dragging", element, ids);
  };

  const topElementAt = (clientX: number, clientY: number) =>
    elementOnTopAt(canvasRef.current, elements, clientX, clientY);

  /** A double-click on an object: type in a text box, choose a picture. */
  const openElement = (e: React.MouseEvent, element: SlideElement) => {
    if (element.type === "image" && !element.isLocked) {
      e.stopPropagation();
      void choosePicture().then((chosen) => {
        if (chosen) {
          onUpdateElement(selectedSlideId, element.id, (prev) =>
            withPicture(prev, chosen.url, chosen.size),
          );
        }
      });
      return;
    }
    if (element.type === "text" && !element.isLocked) {
      e.stopPropagation();
      editingContentRef.current = element.textBody
        ? textBodyToEditableHtml(element.textBody, fontStack)
        : element.isPlaceholder
          ? ""
          : element.richTextHtml?.trim() || plainTextToHtml(element.content || "");
      setEditingElementId(element.id);
    }
  };

  /**
   * A press inside the selected object's frame: moves it, whatever is drawn
   * over it there. With Shift or ⌘ it is a press on the object on top.
   */
  const handleSelectedFramePointerDown = (e: React.PointerEvent, element: SlideElement) => {
    if (e.button !== 0) return;
    if (e.shiftKey || e.metaKey) {
      const onTop = topElementAt(e.clientX, e.clientY);
      if (onTop) handleElementPointerDown(e, onTop);
      return;
    }
    e.stopPropagation();
    clickThroughRef.current = { x: e.clientX, y: e.clientY };
    beginInteraction(
      e,
      "dragging",
      element,
      selectedElementIds.includes(element.id) ? selectedElementIds : withGroups(elements, [element.id]),
    );
  };

  /** A press on the empty slide: draws a box to pick what it touches. */
  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    const additive = e.shiftKey || e.metaKey;
    beginInteraction(e, "marquee", null, [], null, additive ? selectedElementIds : []);
  };

  const handleInteractionStart = (
    e: React.PointerEvent,
    element: SlideElement,
    mode: InteractionMode,
    handle: string | null = null,
  ) => {
    e.stopPropagation();
    if (element.isLocked && mode !== "none") {
      return;
    }

    const bounds = canvasRef.current?.getBoundingClientRect();
    const toScreen = bounds ? bounds.width / canvasDimensions.width : 1;
    setInteraction({
      mode,
      elementId: element.id,
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startElX: element.x,
      startElY: element.y,
      startElW: element.width,
      startElH: element.height,
      rotation: element.style?.rotation ?? 0,
      flipX: Boolean(element.style?.flipX),
      flipY: Boolean(element.style?.flipY),
      isImage: element.type === "image",
      centreX: (bounds?.left ?? 0) + (element.x + element.width / 2) * toScreen,
      centreY: (bounds?.top ?? 0) + (element.y + element.height / 2) * toScreen,
      ids: [element.id],
      starts: { [element.id]: { x: element.x, y: element.y, width: element.width, height: element.height } },
      startBounds: elementBounds(element),
      others: [],
      moved: true,
      baseIds: [],
    });
  };

  useEffect(() => {
    if (!interaction || !selectedSlideId || !canvasRef.current) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== interaction.pointerId) {
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasBounds = canvas.getBoundingClientRect();
      const scaleX = canvasDimensions.width / canvasBounds.width;
      const scaleY = canvasDimensions.height / canvasBounds.height;
      
      const dx = (e.clientX - interaction.startX) * scaleX;
      const dy = (e.clientY - interaction.startY) * scaleY;

      const screenDistance = Math.hypot(e.clientX - interaction.startX, e.clientY - interaction.startY);
      if (!interaction.moved) {
        if (screenDistance < DRAG_START_SCREEN_PX) return;
        interaction.moved = true;
      }

      if (interaction.mode === "marquee") {
        const x0 = (interaction.startX - canvasBounds.left) * scaleX;
        const y0 = (interaction.startY - canvasBounds.top) * scaleY;
        const x1 = (e.clientX - canvasBounds.left) * scaleX;
        const y1 = (e.clientY - canvasBounds.top) * scaleY;
        setMarquee({ left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) });
      } else if (interaction.mode === "dragging") {
        // Snapped to the slide and the other objects; ⌘ moves freely.
        let moveX = dx;
        let moveY = dy;
        let shown: Guide[] = [];
        if (interaction.startBounds && !e.metaKey) {
          const snapped = snapMove(
            interaction.startBounds,
            dx,
            dy,
            interaction.others,
            canvasDimensions,
            SNAP_SCREEN_PX * scaleX,
          );
          moveX = snapped.dx;
          moveY = snapped.dy;
          shown = snapped.guides;
        }
        setGuides(shown);
        const starts = interaction.starts;
        onUpdateElements(selectedSlideId, (current) =>
          current.map((each) => {
            const start = starts[each.id];
            if (!start) return each;
            const x = start.x + moveX;
            const y = start.y + moveY;
            return x === each.x && y === each.y ? each : { ...each, x, y };
          }),
        );
      } else if (interaction.mode === "groupResizing" && interaction.handle && interaction.startBounds) {
        // Several objects, or a group, scaled together from its frame.
        const from = interaction.startBounds;
        const next = resizeBox(
          { x: from.left, y: from.top, width: from.right - from.left, height: from.bottom - from.top },
          interaction.handle,
          dx,
          dy,
          { keepAspect: e.shiftKey },
        );
        const sx = next.width / Math.max(1, from.right - from.left);
        const sy = next.height / Math.max(1, from.bottom - from.top);
        const starts = interaction.starts;
        onUpdateElements(selectedSlideId, (current) =>
          current.map((each) => {
            const start = starts[each.id];
            if (!start) return each;
            return {
              ...each,
              x: next.x + (start.x - from.left) * sx,
              y: next.y + (start.y - from.top) * sy,
              width: Math.max(1, start.width * sx),
              height: Math.max(1, start.height * sy),
            };
          }),
        );
      } else if (interaction.mode === "resizing" && interaction.handle) {
        // In the box's own frame, so a turned or flipped box resizes as it
        // looks. A picture keeps its proportions from a corner, as in
        // Keynote; Shift does the opposite.
        const next = resizeBox(
          {
            x: interaction.startElX,
            y: interaction.startElY,
            width: interaction.startElW,
            height: interaction.startElH,
          },
          interaction.handle,
          dx,
          dy,
          {
            rotation: interaction.rotation,
            flipX: interaction.flipX,
            flipY: interaction.flipY,
            keepAspect: e.shiftKey !== interaction.isImage,
          },
        );
        onUpdateElement(selectedSlideId, interaction.elementId, (prev) => ({ ...prev, ...next }));
      } else if (interaction.mode === "rotating") {
        const rotation = rotationToward(
          { x: interaction.centreX, y: interaction.centreY },
          { x: e.clientX, y: e.clientY },
          { flipY: interaction.flipY, snap: e.shiftKey },
        );
        onUpdateElement(selectedSlideId, interaction.elementId, (prev) => ({
          ...prev,
          style: { ...(prev.style ?? {}), rotation },
        }));
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== interaction.pointerId) {
        return;
      }
      if (interaction.mode === "marquee") {
        const canvas = canvasRef.current;
        if (!interaction.moved || !canvas) {
          // A click on the empty slide picks nothing.
          if (interaction.baseIds.length === 0) onSelectElement(null);
        } else {
          const canvasBounds = canvas.getBoundingClientRect();
          const scale = canvasDimensions.width / canvasBounds.width;
          const x0 = (interaction.startX - canvasBounds.left) * scale;
          const y0 = (interaction.startY - canvasBounds.top) * scale;
          const x1 = (e.clientX - canvasBounds.left) * scale;
          const y1 = (e.clientY - canvasBounds.top) * scale;
          const drawn = { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
          const touched = elements
            .filter((each) => !each.isLocked && each.isVisible !== false && intersects(drawn, elementBounds(each)))
            .map((each) => each.id);
          const ids = withGroups(elements, [...interaction.baseIds, ...touched]);
          onSelectElements(ids, ids[0] ?? null);
        }
        setMarquee(null);
      }
      // A click, not a drag, inside the selected object's frame: the object
      // on top there is picked, as a click anywhere else picks it.
      const clickedAt = clickThroughRef.current;
      clickThroughRef.current = null;
      if (clickedAt && interaction.mode === "dragging" && !interaction.moved) {
        const onTop = elementOnTopAt(canvasRef.current, elements, clickedAt.x, clickedAt.y);
        if (onTop && onTop.id !== interaction.elementId && !isSlideBackground(onTop)) {
          onSelectElements(withGroups(elements, [onTop.id]), onTop.id);
        }
      }
      setGuides([]);
      setInteraction(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [canvasDimensions, elements, interaction, selectedSlideId, onSelectElement, onSelectElements, onUpdateElement, onUpdateElements]);

  if (editorView === "source") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background/50 h-full">
        <div className="border-b border-border px-4 py-3 bg-card/20">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60">
            Lyrics editor
          </p>
        </div>
        <textarea
          ref={sourceTextareaRef}
          value={draftBody}
          onChange={(event) => onSourceBodyChange(event.target.value)}
          className="min-h-0 flex-1 resize-none border-0 bg-transparent px-6 py-6 font-mono text-sm leading-[1.8] text-foreground/90 outline-none placeholder:text-muted-foreground/30 selection:bg-primary/20"
          placeholder={"[Verse 1]\nLine 1\nLine 2\n\n[Chorus]\nLine 1"}
        />
      </div>
    );
  }

  const resolveTextDecoration = (element: SlideElement) => {
    const tokens = new Set(
      (element.style?.textDecoration ?? "")
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => Boolean(token) && token !== "none"),
    );
    if (element.style?.fontUnderline ?? fontUnderline) {
      tokens.add("underline");
    }
    return tokens.size > 0 ? Array.from(tokens).join(" ") : "none";
  };

  const resolveTextPaintStyle = (
    style: SlideElementStyle | undefined,
  ): React.CSSProperties => {
    if (
      style?.textFillMode === "gradient" &&
      style.gradientFromColor &&
      style.gradientToColor
    ) {
      const angle = Number.isFinite(style.gradientAngle)
        ? style.gradientAngle
        : 315;
      return {
        backgroundImage: `linear-gradient(${angle}deg, ${style.gradientFromColor}, ${style.gradientToColor})`,
        backgroundClip: "text",
        WebkitBackgroundClip: "text",
        color: "transparent",
        WebkitTextFillColor: "transparent",
      };
    }

    return {
      color: style?.color ?? "#ffffff",
    };
  };

  return (
    <div className="flex h-full w-full flex-col bg-background selection:bg-primary/30 relative overflow-hidden">
      {/* Top Floating Toolbar */}
      <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2">
        <div className="flex items-center divide-x divide-border/60 overflow-hidden rounded-full border border-border bg-card/80 backdrop-blur-xl">
          <div className="flex px-1.5 py-1">
            <ToolbarButton
              active={false}
              disabled={!canUndo}
              onClick={onUndo}
              icon={<Undo2 className="h-[18px] w-[18px]" />}
              label="Undo (⌘Z)"
            />
            <ToolbarButton
              active={false}
              disabled={!canRedo}
              onClick={onRedo}
              icon={<Redo2 className="h-[18px] w-[18px]" />}
              label="Redo (⇧⌘Z)"
            />
          </div>
          <div className="px-1.5 py-1">
            <ToolbarButton
              active={false}
              onClick={() => onAddElement("text")}
              icon={<Type className="h-[18px] w-[18px]" />}
              label="Text tool (T)"
            />
          </div>
          <div className="px-1.5 py-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Shape"
                  title="Shape"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Square className="h-[18px] w-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="z-[200] grid w-[208px] grid-cols-4 gap-1 p-1.5">
                {SHAPE_PRESETS.map((shape) => (
                  <DropdownMenuItem
                    key={shape.value}
                    title={shape.label}
                    aria-label={shape.label}
                    onSelect={() => onAddElement("shape", shape.value)}
                    className="flex h-11 items-center justify-center"
                  >
                    <ShapeIcon preset={shape.value} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="px-1.5 py-1">
            <ToolbarButton
              active={false}
              onClick={() => onAddElement("image")}
              icon={<ImageIcon className="h-[18px] w-[18px]" />}
              label="Image tool"
            />
          </div>
        </div>
      </div>

      {/* Main Container with Selection Clear Handler */}
      <div 
        className="flex-1 w-full h-full flex flex-col items-center justify-center p-8 bg-background/20 min-h-0"
        onPointerDown={handleBackgroundPointerDown}
      >
        {/* Slide Canvas */}
        <div
          ref={canvasRef}
          className="relative w-full max-h-full max-w-full shadow-none ring-0 outline-none"
          style={{
            aspectRatio: `${canvasDimensions.width} / ${canvasDimensions.height}`,
            [SLIDE_PX_VAR as string]: `${slidePx}px`,
          }}
        >
          {/* The slide, cut to its edges. The selection's frame and handles
              are drawn outside it, below, so they are never covered by
              another object or cut off at the slide's edge. */}
          <div
            className="isolate absolute inset-0 overflow-hidden bg-black"
            style={{ backgroundColor: selectedSlideBackground ?? "#000000" }}
          >
          <style>{EDITABLE_TEXT_CSS}</style>
          <SlideMediaBackdrop backgroundId={selectedSlide?.backgroundId} />
          {/* The slide as the screens draw it; the boxes below are for
              picking, moving and typing. */}
          <CanvasSlideLayer
            text={null}
            elements={rendererElements}
            canvasSize={canvasSize}
            libraryStyle={libraryStyle}
            className="pointer-events-none absolute inset-0"
          />
          {selectedSlide?.elements?.map((element, elementIndex) => (
            <div
              key={element.id}
              data-element-id={element.id}
              onPointerDown={(e) => {
                if (element.type === "text" && editingElementId === element.id) {
                  e.stopPropagation();
                  return;
                }
                handleElementPointerDown(e, element);
              }}
              onDoubleClick={(e) => openElement(e, element)}
              onClick={(e) => e.stopPropagation()} // Prevent deselection when clicking inside an element
              className={cn(
                "absolute transition-none group",
                element.isLocked ? "cursor-not-allowed" : "cursor-default",
                element.isVisible === false && "opacity-0 pointer-events-none",
                // The slide's background, not an object: clicks go through
                // to the empty slide, to clear the selection or draw a box.
                isSlideBackground(element) && "pointer-events-none",
              )}
                style={{
                  left: `${(element.x / canvasDimensions.width) * 100}%`,
                  top: `${(element.y / canvasDimensions.height) * 100}%`,
                  width: `${(element.width / canvasDimensions.width) * 100}%`,
                  height: `${(element.height / canvasDimensions.height) * 100}%`,
                  zIndex: elementIndex + 1,
                  // The renderer draws the rest with their own opacity.
                  opacity: drawnByRenderer(element, editingElementId) ? 1 : (element.style?.opacity ?? 1),
                  fontSize:
                    element.type === "text"
                      ? `calc(${((element.style?.fontSize ?? 120) * EDITOR_PREVIEW_TEXT_SIZE_MULTIPLIER) / 10.8} * 1cqw)`
                      : undefined,
                  lineHeight: String(
                    element.style?.lineHeight && element.style.lineHeight >= 0.5 && element.style.lineHeight <= 4
                      ? element.style.lineHeight
                      : 1.2,
                  ),
                  // Canvas pixels, scaled as the size is.
                  letterSpacing:
                    element.type === "text" && element.style?.letterSpacing
                      ? `calc(${(element.style.letterSpacing * EDITOR_PREVIEW_TEXT_SIZE_MULTIPLIER) / 10.8} * 1cqw)`
                      : undefined,
                  transform: `rotate(${element.style?.rotation ?? 0}deg) scaleX(${element.style?.flipX ? -1 : 1}) scaleY(${element.style?.flipY ? -1 : 1})`,
                  containerType: 'size',
                touchAction:
                  element.type === "text" && editingElementId === element.id
                    ? "auto"
                    : "none",
              }}
            >
              {/* Selector Overlay (Active Selection) */}
              {/* Several picked: each outlined, the frame round them resizes. */}
              {isMultiSelection && selectedElementIds.includes(element.id) ? (
                <div className="pointer-events-none absolute -inset-px z-50 border border-primary/70" />
              ) : null}

              {element.type === "text" && element.textBody ? (
                editingElementId === element.id ? (
                  <ImportedTextEditor
                    element={element}
                    onCommit={(root) => {
                      onUpdateElement(selectedSlideId, element.id, (prev) =>
                        withEditedTextBody(prev, root),
                      );
                      setEditingElementId(null);
                    }}
                  />
                ) : !element.content?.trim() && selectedElementId === element.id ? (
                  <EmptyBoxHint label="Text" />
                ) : null
              ) : element.type === "text" ? (
                (() => {
                  const isEditing = editingElementId === element.id;
                  const isScriptureText =
                    element.contentRole === "scriptureVerse" ||
                    element.contentRole === "scriptureFooter";
                  const displayText = applyCapitalization(
                    element.content || (element.isPlaceholder ? "Text" : ""),
                    element.style?.capitalization,
                  );
                  const textDecoration = resolveTextDecoration(element);
                  const wrapperAlignContent =
                    element.style?.verticalAlign === "top"
                      ? "start"
                      : element.style?.verticalAlign === "bottom"
                        ? "end"
                        : "center";
                  const hasExplicitTextPadding =
                    element.style?.paddingTop !== undefined ||
                    element.style?.paddingRight !== undefined ||
                    element.style?.paddingBottom !== undefined ||
                    element.style?.paddingLeft !== undefined;
                  const textFramePaddingStyle = hasExplicitTextPadding
                    ? {
                        paddingTop: `${element.style?.paddingTop ?? 0}px`,
                        paddingRight: `${element.style?.paddingRight ?? 0}px`,
                        paddingBottom: `${element.style?.paddingBottom ?? 0}px`,
                        paddingLeft: `${element.style?.paddingLeft ?? 0}px`,
                      }
                    : {
                        padding: "8px 16px",
                      };
                  const shouldClipTextContent = !hasExplicitTextPadding;

                  return (
                    <div
                      className={cn(
                        "grid h-full w-full",
                        shouldClipTextContent && "overflow-hidden",
                      )}
                      style={{
                        alignContent: wrapperAlignContent,
                        ...textFramePaddingStyle,
                      }}
                    >
                      {isEditing ? (
                        <div
                          id={`text-editor-${element.id}`}
                          contentEditable
                          suppressContentEditableWarning
                          onPointerDown={(e) => {
                            e.stopPropagation();
                          }}
                          onBlur={(e) => {
                            const text = e.currentTarget?.innerText;
                            const html = e.currentTarget?.innerHTML;
                            if (text !== undefined) {
                              onUpdateElement(selectedSlideId, element.id, (prev) => ({
                                ...prev,
                                content: text.replace(/\r\n/g, "\n"),
                                richTextHtml: normalizeEditableRichTextHtml(html ?? ""),
                                isPlaceholder: false,
                              }));
                            }
                            setEditingElementId(null);
                          }}
                          className="w-full min-w-0 cursor-text overflow-y-auto outline-none select-text"
                          style={{
                            fontFamily: element.style?.fontFamily ?? fontFamily,
                            ...resolveTextPaintStyle(element.style),
                            textAlign: element.style?.textAlign ?? "center",
                            fontWeight:
                              element.style?.fontWeight ??
                              (element.style?.fontBold ?? fontBold ? "bold" : "normal"),
                            fontStyle:
                              element.style?.fontStyle ??
                              (fontItalic ? "italic" : "normal"),
                            textDecoration,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            overflowWrap: "anywhere",
                            fontSize: "inherit",
                            minHeight: "1em",
                            maxHeight: "100%",
                          }}
                        />
                      ) : isScriptureText ? (
                        <AutoFitText
                          text={displayText}
                          className="pointer-events-none select-none whitespace-pre-line leading-[1.2]"
                          style={{
                            fontFamily: element.style?.fontFamily ?? fontFamily,
                            ...resolveTextPaintStyle(element.style),
                            fontWeight:
                              element.style?.fontWeight ??
                              (element.style?.fontBold ?? fontBold ? "bold" : "normal"),
                            fontStyle:
                              element.style?.fontStyle ??
                              (fontItalic ? "italic" : "normal"),
                            textDecoration,
                            textAlign: element.style?.textAlign ?? "center",
                          }}
                          align={
                            element.style?.textAlign === "left" ||
                            element.style?.textAlign === "justify"
                              ? "left"
                              : element.style?.textAlign === "right"
                                ? "right"
                                : "center"
                          }
                          verticalAlign={
                            element.style?.verticalAlign === "top"
                              ? "top"
                              : element.style?.verticalAlign === "bottom"
                                ? "bottom"
                                : "center"
                          }
                          maxFontSize={
                            (element.style?.fontSize ?? 120) *
                            EDITOR_PREVIEW_TEXT_SIZE_MULTIPLIER
                          }
                          minScale={0.25}
                        />
                      ) : (
                        <div
                          className={cn(
                            "w-full min-w-0 cursor-default select-none",
                            shouldClipTextContent && "overflow-hidden",
                          )}
                          style={{
                            fontFamily: element.style?.fontFamily ?? fontFamily,
                            ...resolveTextPaintStyle(element.style),
                            textAlign: element.style?.textAlign ?? "center",
                            fontWeight:
                              element.style?.fontWeight ??
                              (element.style?.fontBold ?? fontBold ? "bold" : "normal"),
                            fontStyle:
                              element.style?.fontStyle ??
                              (fontItalic ? "italic" : "normal"),
                            textDecoration,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            overflowWrap: "anywhere",
                            fontSize: "inherit",
                            minHeight: "1em",
                            maxHeight: "100%",
                          }}
                          dangerouslySetInnerHTML={{
                            __html:
                              element.richTextHtml?.trim() ||
                              plainTextToHtml(displayText),
                          }}
                        />
                      )}
                    </div>
                  );
                })()
              ) : element.type === "shape" ? null : element.type === "image" ? (
                element.content?.trim() ? null : (
                  <div
                    className="flex h-full w-full flex-col items-center justify-center gap-2 border border-dashed border-white/30 bg-white/5 text-white/70 pointer-events-none"
                    style={{
                      borderRadius: `${element.style?.borderRadius ?? 0}px`,
                      opacity: element.style?.opacity ?? 1,
                    }}
                  >
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
                      Double-click to choose
                    </span>
                  </div>
                )
              ) : element.type === "web" ? (
                element.content?.trim() ? (
                  <div
                    className="h-full w-full overflow-hidden pointer-events-none"
                    style={{
                      borderRadius: `${element.style?.borderRadius ?? 0}px`,
                      opacity: element.style?.opacity ?? 1,
                      backgroundColor: element.style?.backgroundColor ?? "#000000",
                    }}
                  >
                    <iframe
                      title={element.id}
                      srcDoc={element.content}
                      sandbox="allow-same-origin"
                      className="h-full w-full border-0 bg-white pointer-events-none"
                    />
                  </div>
                ) : (
                  <div
                    className="flex h-full w-full flex-col items-center justify-center gap-2 border border-dashed border-white/30 bg-white/5 text-white/70 pointer-events-none"
                    style={{
                      borderRadius: `${element.style?.borderRadius ?? 0}px`,
                      opacity: element.style?.opacity ?? 1,
                    }}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
                      Web Slide
                    </span>
                  </div>
                )
              ) : null}
            </div>
          ))}
          {guides.map((guide) => (
            <div
              key={`${guide.axis}${guide.at}`}
              className="pointer-events-none absolute bg-fuchsia-500"
              style={
                guide.axis === "x"
                  ? { left: `${(guide.at / canvasDimensions.width) * 100}%`, top: 0, bottom: 0, width: 1, zIndex: elements.length + 70 }
                  : { top: `${(guide.at / canvasDimensions.height) * 100}%`, left: 0, right: 0, height: 1, zIndex: elements.length + 70 }
              }
            />
          ))}
          {marquee ? (
            <div
              className="pointer-events-none absolute border border-primary bg-primary/10"
              style={{ ...percentBox(marquee), zIndex: elements.length + 80 }}
            />
          ) : null}
          {previewing && selectedSlide ? (
            <BuildPreviewLayer
              preview={previewing}
              elements={selectedSlide.elements ?? []}
              canvasSize={canvasSize}
              libraryStyle={libraryStyle}
              backgroundColor={selectedSlideBackground ?? "#000000"}
              onDone={stopBuildPreview}
            />
          ) : null}
          </div>

          {/* Where each object comes in the build order, while building. */}
          {!previewing
            ? elements.map((element) => {
                const badge = buildBadges.get(element.id);
                if (!badge || element.isVisible === false) return null;
                return (
                  <div
                    key={`build-${element.id}`}
                    className="pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold leading-4 text-black shadow"
                    style={{
                      left: `${(element.x / canvasDimensions.width) * 100}%`,
                      top: `${(element.y / canvasDimensions.height) * 100}%`,
                    }}
                  >
                    {badge}
                  </div>
                );
              })
            : null}

          {/* The selected object's frame, above everything on the slide. */}
          {!previewing && !isMultiSelection && selectedElement && selectedElement.isVisible !== false ? (
            <div
              className="pointer-events-none absolute z-40 border border-primary/90"
              style={{
                left: `${(selectedElement.x / canvasDimensions.width) * 100}%`,
                top: `${(selectedElement.y / canvasDimensions.height) * 100}%`,
                width: `${(selectedElement.width / canvasDimensions.width) * 100}%`,
                height: `${(selectedElement.height / canvasDimensions.height) * 100}%`,
                transform: `rotate(${selectedElement.style?.rotation ?? 0}deg) scaleX(${selectedElement.style?.flipX ? -1 : 1}) scaleY(${selectedElement.style?.flipY ? -1 : 1})`,
              }}
            >
              {/* Inside the frame, a press moves the selected object even
                  where another is drawn over it; a click still picks the
                  one on top. Not while typing in it, nor for a background. */}
              {!selectedElement.isLocked &&
              !isSlideBackground(selectedElement) &&
              editingElementId !== selectedElement.id ? (
                <div
                  className="pointer-events-auto absolute inset-0 cursor-move"
                  onPointerDown={(e) => handleSelectedFramePointerDown(e, selectedElement)}
                  onDoubleClick={(e) => openElement(e, selectedElement)}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : null}
              {!selectedElement.isLocked ? (
                <>
                  {/* Rotate: drag the dot above the box; Shift turns in 15° steps. */}
                  <div className="pointer-events-none absolute left-1/2 -top-5 h-5 w-px -translate-x-1/2 bg-primary/70" />
                  <div
                    title="Rotate (Shift: 15° steps)"
                    onPointerDown={(e) => handleInteractionStart(e, selectedElement, "rotating")}
                    onClick={(e) => e.stopPropagation()}
                    className="pointer-events-auto absolute left-1/2 -top-[29px] flex h-4 w-4 -translate-x-1/2 cursor-grab items-center justify-center"
                  >
                    <span className="h-2.5 w-2.5 rounded-full border border-primary bg-white shadow-sm" />
                  </div>
                  {RESIZE_HANDLES.map((handle) => (
                    <ResizeHandle
                      key={handle}
                      handle={handle}
                      onPointerDown={(e) => handleInteractionStart(e, selectedElement, "resizing", handle)}
                    />
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
          {!previewing && isMultiSelection && selectionBounds ? (
            <div
              className="pointer-events-none absolute z-40 border border-dashed border-primary"
              style={percentBox(selectionBounds)}
            >
              {RESIZE_HANDLES.map((handle) => (
                <ResizeHandle
                  key={handle}
                  handle={handle}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const primary = elements.find((each) => each.id === selectedElementId) ?? null;
                    beginInteraction(e, "groupResizing", primary, selectedElementIds, handle);
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/**
 * A resize handle: a small square, in a larger target that is easy to hit.
 */
function ResizeHandle({
  handle,
  onPointerDown,
}: {
  handle: (typeof RESIZE_HANDLES)[number];
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "pointer-events-auto absolute flex h-4 w-4 items-center justify-center",
        HANDLE_PLACES[handle],
      )}
    >
      <span className="h-2 w-2 border border-primary bg-white shadow-sm" />
    </div>
  );
}

const RESIZE_HANDLES = [
  "top-left", "top-middle", "top-right", "mid-left", "mid-right", "bottom-left", "bottom-middle", "bottom-right",
] as const;

/** Where each handle's 16px target sits: centred on the frame's corner or edge. */
const HANDLE_PLACES: Record<(typeof RESIZE_HANDLES)[number], string> = {
  "top-left": "-left-2 -top-2 cursor-nw-resize",
  "top-middle": "left-1/2 -top-2 -translate-x-1/2 cursor-n-resize",
  "top-right": "-right-2 -top-2 cursor-ne-resize",
  "mid-left": "-left-2 top-1/2 -translate-y-1/2 cursor-w-resize",
  "mid-right": "-right-2 top-1/2 -translate-y-1/2 cursor-e-resize",
  "bottom-left": "-left-2 -bottom-2 cursor-sw-resize",
  "bottom-middle": "left-1/2 -bottom-2 -translate-x-1/2 cursor-s-resize",
  "bottom-right": "-right-2 -bottom-2 cursor-se-resize",
};

/** A preset shape, small, for the shape menu and the inspector. */
export function ShapeIcon({ preset, size = 22 }: { preset: SlideShapePreset; size?: number }) {
  const inset = 2;
  const inner = size - inset * 2;
  const geometry = presetGeometry(preset, inner, preset === "line" ? inner : inner * (preset === "arrow" || preset === "chevron" ? 0.7 : 1), 4);
  const offsetY = preset === "arrow" || preset === "chevron" ? (inner * 0.3) / 2 : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`translate(${inset} ${inset + offsetY})`}>
        {geometry.paths.map((path, index) => (
          <path
            key={index}
            d={path.d}
            fill={path.fill === false ? "none" : "currentColor"}
            fillOpacity={0.25}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

/** A box with nothing in it yet, shown only while it is selected. */
function EmptyBoxHint({ label }: { label: string }) {
  return (
    <div className="pointer-events-none flex h-full w-full items-center justify-center border border-dashed border-white/40 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
      {label}
    </div>
  );
}

/**
 * An imported text box being typed in: its paragraphs and runs as the slide
 * has them, at the slide's scale, so the words stay where they were drawn.
 * The canvas fills it when typing starts (the browser owns the words while
 * they are typed); leaving the box saves it.
 */
function ImportedTextEditor({
  element,
  onCommit,
}: {
  element: SlideElement;
  onCommit: (root: EditableNode) => void;
}) {
  const body = element.textBody;
  const style = element.style ?? {};
  const scaled = (value: number | undefined) => `calc(var(${SLIDE_PX_VAR}) * ${value ?? 0})`;
  const verticalAlign = body?.verticalAlign ?? style.verticalAlign ?? "top";

  return (
    <div
      className="grid h-full w-full"
      style={{
        alignContent: verticalAlign === "bottom" ? "end" : verticalAlign === "middle" ? "center" : "start",
        paddingTop: scaled(style.paddingTop ?? body?.insetTop),
        paddingRight: scaled(style.paddingRight ?? body?.insetRight),
        paddingBottom: scaled(style.paddingBottom ?? body?.insetBottom),
        paddingLeft: scaled(style.paddingLeft ?? body?.insetLeft),
      }}
    >
      <div
        id={`text-editor-${element.id}`}
        contentEditable
        suppressContentEditableWarning
        onPointerDown={(event) => event.stopPropagation()}
        onBlur={(event) => onCommit(event.currentTarget as unknown as EditableNode)}
        className="slide-text-editor w-full min-w-0 cursor-text outline-none select-text"
        style={{
          // The box's own look, for words that do not set theirs.
          fontFamily: style.fontFamily ? fontStack(style.fontFamily) : undefined,
          fontSize: scaled(style.fontSize ?? 36),
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          letterSpacing: scaled(style.letterSpacing),
          color: style.color ?? "#000000",
          whiteSpace: body?.wrap === false ? "pre" : "pre-wrap",
          overflowWrap: "break-word",
          // A faint glass behind the words, so they read over any slide.
          backgroundColor: "rgba(255,255,255,0.06)",
          caretColor: "currentColor",
        }}
      />
    </div>
  );
}

function ToolbarButton({ 
  active, 
  onClick, 
  label,
  icon,
  disabled = false,
}: { 
  icon: React.ReactNode; 
  active: boolean; 
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center rounded-full transition-colors active:scale-90 disabled:pointer-events-none disabled:opacity-30",
        active 
          ? "bg-primary/12 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {icon}
      <span className="absolute -bottom-10 left-1/2 -translate-x-1/2 scale-0 rounded-md bg-popover px-2 py-1 text-[10px] font-bold text-popover-foreground shadow-xl transition-all group-hover:scale-100 whitespace-nowrap z-100 border border-border">
        {label}
      </span>
    </button>
  );
}
