"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Plus } from "lucide-react";

import type { SlidesItem } from "../hooks/useMediaFolders";
import { useSlidesDeck } from "../hooks/useSlidesDeck";
import { MediaSlidePreview } from "./MediaSlidePreview";
import { SlidesTypeBadge } from "./SlidesItemCard";
import { Button } from "../../../renderer/shared/components/ui/button";
import { Spinner } from "../../../renderer/shared/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../renderer/shared/components/ui/alert-dialog";
import { cn } from "../../../renderer/shared/lib/utils";

/**
 * A Media deck's slides, to look through and pick from. Adding with none
 * picked adds the whole deck; with some, only those, in the deck's order.
 */
export function SlidesBrowserDialog({
  item,
  onClose,
  canAddToService,
  onAddToService,
}: {
  item: SlidesItem | null;
  onClose: () => void;
  /** A service is open to add to. */
  canAddToService: boolean;
  /** Whether they went in; the dialog stays open when they did not. */
  onAddToService: (item: SlidesItem, slideIndices: number[] | undefined) => Promise<boolean>;
}) {
  const { deck, preparing, error } = useSlidesDeck(item, item !== null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  // A different deck starts with nothing picked.
  useEffect(() => {
    setSelected(new Set());
  }, [item?.path]);

  const slides = deck?.slides ?? [];
  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const handleAdd = async () => {
    if (!item) return;
    setIsAdding(true);
    try {
      const added = await onAddToService(
        item,
        selected.size > 0 ? [...selected].sort((a, b) => a - b) : undefined,
      );
      if (added) onClose();
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <AlertDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="truncate">{item?.name}</span>
            {item ? <SlidesTypeBadge sourceType={item.sourceType} /> : null}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deck
              ? `${slides.length} ${slides.length === 1 ? "slide" : "slides"}. Click slides to pick only those, or add the whole deck.`
              : "Its slides, as the screens will show them."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="min-h-[240px] flex-1 overflow-y-auto rounded-lg border border-border/60 bg-secondary/20 p-3">
          {deck ? (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
            >
              {slides.map((slide, index) => {
                const isPicked = selected.has(index);
                return (
                  <button
                    key={slide.id ?? index}
                    type="button"
                    onClick={() => toggle(index)}
                    aria-pressed={isPicked}
                    className={cn(
                      "group relative aspect-video overflow-hidden rounded-lg border transition-all duration-150",
                      isPicked
                        ? "border-primary/70 ring-2 ring-primary/70 ring-offset-1 ring-offset-background"
                        : "border-border/60 hover:border-primary/40",
                      slide.hidden && !isPicked && "opacity-45",
                    )}
                  >
                    <MediaSlidePreview slide={slide} content={deck.content} />
                    <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
                      {index + 1}
                    </span>
                    {isPicked ? (
                      <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              {error ? (
                <>
                  <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden />
                  <span>{error}</span>
                </>
              ) : (
                <>
                  <Spinner className="size-5" />
                  <span>{preparing ? "Preparing slides…" : "Opening slides…"}</span>
                </>
              )}
            </div>
          )}
        </div>

        <AlertDialogFooter className="items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {deck && slides.length > 0 ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setSelected(
                      selected.size === slides.length
                        ? new Set()
                        : new Set(slides.map((_, index) => index)),
                    )
                  }
                >
                  {selected.size === slides.length ? "Clear" : "Select All"}
                </Button>
                {selected.size > 0 ? <span>{selected.size} picked</span> : null}
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {!canAddToService ? (
              <span className="text-xs text-muted-foreground">Open a service to add these slides.</span>
            ) : null}
            <AlertDialogCancel>Close</AlertDialogCancel>
            <Button
              onClick={() => void handleAdd()}
              disabled={!deck || !canAddToService || isAdding}
            >
              {isAdding ? <Spinner /> : <Plus />}
              {selected.size > 0 && selected.size < slides.length
                ? `Add ${selected.size} ${selected.size === 1 ? "Slide" : "Slides"} to Service`
                : "Add to Service"}
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
