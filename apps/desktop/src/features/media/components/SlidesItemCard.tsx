"use client";

import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, Pencil, Plus, Presentation, Trash2 } from "lucide-react";

import type { SlidesItem } from "../hooks/useMediaFolders";
import { useSlidesDeck } from "../hooks/useSlidesDeck";
import { MediaSlidePreview } from "./MediaSlidePreview";
import { Spinner } from "../../../renderer/shared/components/ui/spinner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../../renderer/shared/components/ui/context-menu";
import { cn } from "../../../renderer/shared/lib/utils";

/** PPTX or PDF, on the card's corner and in the slide browser's title. */
export function SlidesTypeBadge({
  sourceType,
  className,
}: {
  sourceType: SlidesItem["sourceType"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
        sourceType === "pdf" ? "bg-rose-500/90 text-white" : "bg-orange-500/90 text-white",
        className,
      )}
    >
      {sourceType}
    </span>
  );
}

/**
 * A PowerPoint or PDF in the Media panel: its first slide, its name, and
 * whether it is PPTX or PDF. Clicking opens its slides.
 */
export const SlidesItemCard = memo(function SlidesItemCard({
  item,
  isGridView,
  isInsideService,
  onOpen,
  onAddToService,
  onRename,
  onDelete,
}: {
  item: SlidesItem;
  isGridView: boolean;
  isInsideService: boolean;
  onOpen: (item: SlidesItem) => void;
  onAddToService: (item: SlidesItem) => void;
  onRename: (item: SlidesItem) => void;
  onDelete: (item: SlidesItem) => void;
}) {
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [isInView, setIsInView] = useState(false);

  // Converted only once the card is near the screen, as videos' pictures are.
  useEffect(() => {
    const element = cardRef.current;
    if (!element || isInView) return;
    const root = element.closest("[data-media-scroll]") as Element | null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { root, rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isInView]);

  const { deck, preparing, error } = useSlidesDeck(item, isInView);
  const cover = deck?.slides.find((slide) => !slide.hidden) ?? deck?.slides[0] ?? null;
  const slideCount = deck?.slides.length ?? null;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          ref={cardRef}
          onClick={() => onOpen(item)}
          title={error ?? item.name}
          className={cn(
            "group relative overflow-hidden rounded-xl border bg-black text-left transition-all duration-150",
            isGridView ? "aspect-video w-full" : "flex h-16 w-full flex-row items-center",
            error
              ? "border-amber-500/70 hover:border-amber-500"
              : "border-border/60 hover:border-primary/40 hover:shadow-md hover:shadow-black/30",
          )}
        >
          <div
            className={cn(
              "relative shrink-0 overflow-hidden",
              isGridView ? "h-full w-full" : "aspect-video h-full border-r border-border/60",
            )}
          >
            {cover ? (
              <MediaSlidePreview slide={cover} content={deck?.content} />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-secondary/30 text-muted-foreground">
                {preparing ? (
                  <>
                    <Spinner className="size-4" />
                    {isGridView ? <span className="text-[10px]">Preparing slides…</span> : null}
                  </>
                ) : error ? (
                  <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                ) : (
                  <Presentation className="h-5 w-5" aria-hidden />
                )}
              </div>
            )}
          </div>
          {isGridView ? (
            <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent p-2">
              <p className="truncate text-xs text-white">{item.name}</p>
              {slideCount !== null ? (
                <p className="text-[10px] text-white/60">
                  {slideCount} {slideCount === 1 ? "slide" : "slides"}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-center overflow-hidden px-4">
              <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
              <p className={cn("truncate text-xs", error ? "text-amber-500" : "text-muted-foreground")}>
                {error ??
                  (slideCount !== null
                    ? `${slideCount} ${slideCount === 1 ? "slide" : "slides"}`
                    : preparing
                      ? "Preparing slides…"
                      : "")}
              </p>
            </div>
          )}
          <SlidesTypeBadge sourceType={item.sourceType} className="absolute right-1 top-1" />
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onOpen(item)}>
          <Eye className="mr-2 h-4 w-4" />
          Preview Slides
        </ContextMenuItem>
        {isInsideService && (
          <ContextMenuItem onClick={() => onAddToService(item)} disabled={!deck}>
            <Plus className="mr-2 h-4 w-4" />
            Add to Service
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => onRename(item)}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => onDelete(item)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remove from media
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
