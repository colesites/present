"use client";

import { memo, useMemo, useState, type DragEvent } from "react";
import type { LibraryItem, LibrarySlide } from "../../shared/types";
import { stripBracketsForDisplay } from "../../renderer/shared/lib/lyrics";
import { getLabelColor } from "../../shared/types";
import { cn } from "../../renderer/shared/lib/utils";
import { AutoFitText } from "../../renderer/shared/components/AutoFitText";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../renderer/shared/components/ui/context-menu";
import { GripVertical, Pencil } from "lucide-react";
import { getSlideBackgroundColor } from "../library/lib/library-items";

// Fixed slide box height
const BASE_SLIDE_HEIGHT = 160;
// Minimum width for each slide (controls when columns reduce)
const BASE_MIN_SLIDE_WIDTH = 220;
const SLIDE_DRAG_DATA_KEY = "application/x-present-slide-index";

function getReadableTextColor(backgroundColor: string) {
  const hex = backgroundColor.replace("#", "");
  if (![3, 6].includes(hex.length)) {
    return "#ffffff";
  }

  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;

  return luminance > 150 ? "#111111" : "#ffffff";
}

export interface SlideData {
  libraryItem?: LibraryItem | null;
  slide: LibrarySlide & {
    footer?: string;
  };
  index: number;
  id?: string; // Optional unique ID override
}

interface SlidesGridProps {
  slides: SlideData[];
  activeSlideId: string | null;
  selectedIndex: number | null;
  onSelectSlide: (slideId: string, text: string, footer?: string) => void;
  onEditSlide?: (libraryId: string, index: number) => void;
  onReorderSlides?: (fromIndex: number, toIndex: number) => Promise<void>;
  fontFamily?: string;
  fontSize?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  externalScale?: number;
  isGridView?: boolean;
  forceSingleColumn?: boolean;
}

export const SlidesGrid = memo(function SlidesGrid({
  slides,
  activeSlideId,
  selectedIndex,
  onSelectSlide,
  onEditSlide,
  onReorderSlides,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  externalScale = 60,
  isGridView = true,
  forceSingleColumn = false,
}: SlidesGridProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const scaleFactor = externalScale / 60;
  const slideHeight = useMemo(
    () => Math.round((forceSingleColumn ? BASE_SLIDE_HEIGHT * 2 : BASE_SLIDE_HEIGHT) * scaleFactor),
    [forceSingleColumn, scaleFactor]
  );
  const minSlideWidth = useMemo(
    () => Math.round(BASE_MIN_SLIDE_WIDTH * scaleFactor),
    [scaleFactor]
  );
  const gridGap = useMemo(
    () => Math.max(8, Math.round(16 * scaleFactor)),
    [scaleFactor]
  );

  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a library item to view slides
      </div>
    );
  }

  return (
    <div className="relative pb-24">
      <div
        className={cn(
          "pb-8",
          isGridView ? "grid" : "flex flex-col"
        )}
        style={{
          gap: `${gridGap}px`,
          gridTemplateColumns: isGridView
            ? forceSingleColumn
              ? "minmax(0, 1fr)"
              : `repeat(auto-fill, minmax(${minSlideWidth}px, 1fr))`
            : undefined,
        }}
      >
        {slides.map(({ libraryItem, slide, index, id }) => {
          const slideId =
            id ||
            (libraryItem
              ? `${libraryItem._id}:${slide.id ?? index}`
              : `scripture:${index}`);
          const isActive = activeSlideId === slideId;
          const isSelected = selectedIndex === index;

          return (
            <SlideCard
              key={slideId}
              slide={slide}
              index={index}
              isActive={isActive}
              isSelected={isSelected}
              onClick={() => onSelectSlide(slideId, slide.text, slide.footer)}
              onEdit={
                onEditSlide && libraryItem
                  ? () => onEditSlide(libraryItem._id, index)
                  : undefined
              }
              onDragStart={(event) => {
                if (!onReorderSlides || !libraryItem) return;
                setDraggedIndex(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(SLIDE_DRAG_DATA_KEY, String(index));
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => {
                if (!onReorderSlides || !libraryItem) return;
                event.preventDefault();
                if (draggedIndex !== index) {
                  setDropTargetIndex(index);
                }
              }}
              onDragLeave={() => {
                if (!onReorderSlides) return;
                setDropTargetIndex(null);
              }}
              onDrop={async (event) => {
                if (!onReorderSlides || !libraryItem) return;
                event.preventDefault();
                const droppedIndex = Number.parseInt(
                  event.dataTransfer.getData(SLIDE_DRAG_DATA_KEY) ||
                    event.dataTransfer.getData("text/plain"),
                  10,
                );
                const fromIndex =
                  draggedIndex ?? (Number.isFinite(droppedIndex) ? droppedIndex : null);
                setDraggedIndex(null);
                setDropTargetIndex(null);
                if (fromIndex != null && fromIndex !== index) {
                  await onReorderSlides(fromIndex, index);
                }
              }}
              onDragEnd={() => {
                setDraggedIndex(null);
                setDropTargetIndex(null);
              }}
              isDragging={draggedIndex === index}
              isDropTarget={dropTargetIndex === index}
              canReorder={Boolean(onReorderSlides && libraryItem)}
              backgroundColor={getSlideBackgroundColor(slide, libraryItem?.content)}
              isScripture={!libraryItem}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontBold={fontBold}
              fontItalic={fontItalic}
              fontUnderline={fontUnderline}
              slideHeight={slideHeight}
              isGridView={isGridView}
            />
          );
        })}
      </div>
    </div>
  );
});

interface SlideCardProps {
  libraryId?: string;
  slide: LibrarySlide & {
    footer?: string;
  };
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  onEdit?: () => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  canReorder?: boolean;
  backgroundColor?: string | null;
  isScripture?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  slideHeight: number;
  isGridView?: boolean;
}

const SlideCard = memo(function SlideCard({
  slide,
  index,
  isActive,
  isSelected,
  onClick,
  onEdit,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  isDragging,
  isDropTarget,
  canReorder,
  backgroundColor,
  isScripture,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  slideHeight,
  isGridView = true,
}: SlideCardProps) {
  const customLabelStyle = slide.labelColor
    ? {
        backgroundColor: slide.labelColor,
        color: getReadableTextColor(slide.labelColor),
      }
    : undefined;

  // Strip bracket annotations (e.g. [x3], [2x], [repeat]) from element content for display
  const displayElements = useMemo(() => {
    if (!slide.elements?.length) return slide.elements;
    return slide.elements.map((el) => {
      if (el.type !== "text") return el;
      const cleanContent = stripBracketsForDisplay(el.content);
      if (cleanContent === el.content) return el;
      return { ...el, content: cleanContent };
    });
  }, [slide.elements]);

  // Extract inline bracket content as modifier for footer when not already set
  const displayModifier = useMemo(() => {
    if (slide.modifier) return slide.modifier;
    const matches = slide.text.match(/\[([^\]]+)\]/g);
    if (!matches) return "";
    return matches.map((m) => m.slice(1, -1)).join(" ");
  }, [slide.text, slide.modifier]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          draggable={canReorder}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onDragEnd={onDragEnd}
          onClick={onClick}
          style={{ height: isGridView ? slideHeight : 64 }}
          className={cn(
            "group relative flex w-full overflow-hidden rounded-lg border text-left transition",
            isGridView ? "flex-col" : "flex-row items-center",
            isActive
              ? "border-primary ring-2 ring-primary"
              : isSelected
                ? "border-primary/50"
                : "border-border hover:border-primary/50",
            isDragging && "opacity-45",
            isDropTarget && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            canReorder && "cursor-grab active:cursor-grabbing",
          )}
        >
          {/* Slide preview - black background like main output */}
          <div
            className={cn(
              "flex items-center justify-center overflow-hidden p-2",
              isGridView ? "flex-1" : "h-full w-32 shrink-0 border-r border-border"
            )}
            style={{ backgroundColor: backgroundColor ?? "#000000" }}
          >
            {displayElements && displayElements.length > 0 ? (
              <div className="relative h-full w-full overflow-hidden rounded-sm">
                <CanvasSlideLayer
                  text={stripBracketsForDisplay(slide.text)}
                  elements={displayElements}
                  className="absolute inset-0"
                  libraryStyle={{
                    fontFamily: fontFamily ?? "inherit",
                    fontSize: fontSize ?? 80,
                    fontBold: Boolean(fontBold),
                    fontItalic: Boolean(fontItalic),
                    fontUnderline: Boolean(fontUnderline),
                  }}
                />
              </div>
            ) : (
              <AutoFitText
                text={stripBracketsForDisplay(slide.text)}
                className={cn(
                  "pointer-events-none select-none text-white",
                  fontBold && "font-bold",
                  fontItalic && "italic",
                  fontUnderline && "underline"
                )}
                style={{
                  fontFamily,
                  fontSize: isScripture ? "18vh" : undefined,
                }}
                maxFontSize={
                  isGridView 
                    ? (isScripture ? undefined : fontSize ? fontSize * 0.2 : 24)
                    : 14
                }
                minScale={isGridView ? (isScripture ? 0.1 : 0.5) : 0.8}
              />
            )}
          </div>

          {canReorder ? (
            <div className="absolute left-2 top-2 rounded-full bg-black/45 p-1 text-white/60">
              <GripVertical className="h-3.5 w-3.5" />
            </div>
          ) : null}

          {/* Label bar: number left, label center, modifier right */}
          <div
            className={cn(
              "flex items-center justify-between px-3 py-1.5 text-xs font-medium",
              isGridView ? "shrink-0" : "flex-1 h-full",
              !slide.labelColor && getLabelColor(slide.label)
            )}
            style={customLabelStyle}
          >
            <div className="flex items-center gap-4">
              <span className="opacity-60">{index + 1}</span>
              <span>{slide.label || ""}</span>
            </div>
            <span>{displayModifier || ""}</span>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {onEdit && (
          <ContextMenuItem onClick={onEdit} className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit in Editor
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
