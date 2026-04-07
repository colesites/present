import { memo, useMemo, useState } from "react";
import { 
  GripVertical, 
  Image as ImageIcon,
  Plus, 
  Trash2, 
  Layers, 
  Layout, 
  Type, 
  Square, 
  Eye, 
  EyeOff, 
  Lock 
} from "lucide-react";
import { cn } from "../../../renderer/shared/lib/utils";
import { AutoFitText } from "../../../renderer/shared/components";
import type { LibrarySlide, LibraryContent, SlideElement } from "../../../shared/types";
import { getSlideBackgroundColor } from "../../library/lib/library-items";

const SLIDE_DRAG_DATA_KEY = "application/x-present-slide-index";
const LAYER_DRAG_DATA_KEY = "application/x-present-layer-index";

interface SlideListProps {
  sidebarTab: "slides" | "layers";
  setSidebarTab: (tab: "slides" | "layers") => void;
  slides: LibrarySlide[];
  selectedSlideId: string | null;
  selectedSlide: LibrarySlide | null;
  draggedSlideIndex: number | null;
  dropSlideIndex: number | null;
  content: LibraryContent | undefined;
  fontFamily: string;
  onAddSlide: () => void;
  onRemoveSlide: (id: string) => void;
  onSelectSlide: (id: string | null) => void;
  onDragStart: (index: number, event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (toIndex: number, fromIndex?: number) => void;
  setDropSlideIndex: (index: number | null) => void;
  setDraggedSlideIndex: (index: number | null) => void;
  onSelectElement: (id: string | null) => void;
  selectedElementId: string | null;
  onUpdateElement: (slideId: string | null, elementId: string | null, updater: (el: SlideElement) => SlideElement) => void;
  onReorderElements: (fromIndex: number, toIndex: number) => void;
}

export const SlideList = memo(function SlideList({
  sidebarTab,
  setSidebarTab,
  slides,
  selectedSlideId,
  selectedSlide,
  draggedSlideIndex,
  dropSlideIndex,
  content,
  fontFamily,
  onAddSlide,
  onRemoveSlide,
  onSelectSlide,
  onDragStart,
  onDrop,
  setDropSlideIndex,
  setDraggedSlideIndex,
  onSelectElement,
  selectedElementId,
  onUpdateElement,
  onReorderElements,
}: SlideListProps) {
  const [draggedLayerIndex, setDraggedLayerIndex] = useState<number | null>(null);
  const [dropLayerIndex, setDropLayerIndex] = useState<number | null>(null);
  const layerItems = useMemo(
    () =>
      (selectedSlide?.elements ?? [])
        .map((element, actualIndex) => ({ element, actualIndex }))
        .reverse(),
    [selectedSlide?.elements],
  );
  const layerCount = layerItems.length;

  return (
    <div className="flex h-full flex-col">
      {/* Sidebar Tabs */}
      <div className="flex items-center justify-between border-b border-border bg-card/40 p-1.5">
        <div className="flex w-full overflow-hidden rounded-lg bg-muted/30 p-1">
          <button
            onClick={() => setSidebarTab("slides")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-[10px] font-bold uppercase transition",
              sidebarTab === "slides" 
                ? "bg-background text-primary shadow-sm" 
                : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <Layout className="h-3 w-3" />
            Slides
          </button>
          <button
            onClick={() => setSidebarTab("layers")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-[10px] font-bold uppercase transition",
              sidebarTab === "layers" 
                ? "bg-background text-primary shadow-sm" 
                : "text-muted-foreground/60 hover:text-foreground"
            )}
          >
            <Layers className="h-3 w-3" />
            Objects
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-hide">
        {sidebarTab === "slides" ? (
          <div className="space-y-2 p-3">
            <div className="flex items-center justify-between mb-4">
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Playlist</span>
               <button
                 type="button"
                 onClick={onAddSlide}
                 className="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background/50 px-2.5 text-[10px] font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
               >
                 <Plus className="h-3 w-3" /> Add
               </button>
            </div>

            {slides.map((slide, index) => {
              const isSelected = slide.id === selectedSlideId;
              const backgroundColor = getSlideBackgroundColor(slide, content);
              return (
                <div
                  key={slide.id ?? index}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(SLIDE_DRAG_DATA_KEY, String(index));
                    onDragStart(index, event);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedSlideIndex !== index) {
                      setDropSlideIndex(index);
                    }
                  }}
                  onDragLeave={() => setDropSlideIndex(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const droppedIndex = Number.parseInt(
                      event.dataTransfer.getData(SLIDE_DRAG_DATA_KEY) ||
                        event.dataTransfer.getData("text/plain"),
                      10,
                    );
                    onDrop(index, Number.isFinite(droppedIndex) ? droppedIndex : undefined);
                  }}
                  onDragEnd={() => {
                    setDraggedSlideIndex(null);
                    setDropSlideIndex(null);
                  }}
                  onClick={() => {
                    onSelectSlide(slide.id ?? null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectSlide(slide.id ?? null);
                    }
                  }}
                  className={cn(
                    "group flex w-full flex-col gap-2 rounded-2xl border px-2 py-2 text-left transition",
                    isSelected
                      ? "border-primary bg-primary/10"
                      : "border-border/40 bg-muted/20 hover:border-border hover:bg-muted/40",
                    dropSlideIndex === index && "ring-2 ring-primary/40",
                    draggedSlideIndex === index && "opacity-40",
                  )}
                >
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground/30" />
                      <span className="text-[11px] font-medium text-muted-foreground/70">
                        {index + 1}.
                      </span>
                      <span className={cn(
                        "truncate text-[11px] font-bold uppercase tracking-tight",
                        isSelected ? "text-primary" : "text-foreground/80"
                      )}>
                        {slide.label?.trim() || "Untitled"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (slide.id) {
                          onRemoveSlide(slide.id);
                        }
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/45 transition hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div
                    className="relative aspect-video overflow-hidden rounded-xl border border-border px-4 py-3 bg-black shadow-lg shadow-black/20"
                    style={{ backgroundColor: backgroundColor ?? "var(--background)" }}
                  >
                    <div className="relative flex h-full items-center justify-center">
                      {slide.text.trim() ? (
                        <AutoFitText
                          text={slide.text.trim()}
                          className="pointer-events-none select-none text-center text-foreground"
                          style={{ fontFamily }}
                          maxFontSize={22}
                          minScale={0.4}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full flex-col p-4">
            <div className="mb-6 flex items-center justify-between">
               <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50">Layers</span>
               <span className="text-[10px] font-medium text-muted-foreground/30">{selectedSlide?.elements?.length || 0} items</span>
            </div>

            {layerCount > 0 ? (
              <div className="space-y-1.5">
                {layerItems.map(({ element: el, actualIndex }, displayIndex) => (
                  <div 
                    key={el.id}
                    draggable={layerCount > 1}
                    onDragStart={(event) => {
                      setDraggedLayerIndex(displayIndex);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData(
                        LAYER_DRAG_DATA_KEY,
                        String(displayIndex),
                      );
                      event.dataTransfer.setData("text/plain", String(displayIndex));
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggedLayerIndex !== displayIndex) {
                        setDropLayerIndex(displayIndex);
                      }
                    }}
                    onDragLeave={() => setDropLayerIndex(null)}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceDisplayIndex =
                        draggedLayerIndex ??
                        Number.parseInt(
                          event.dataTransfer.getData(LAYER_DRAG_DATA_KEY) ||
                            event.dataTransfer.getData("text/plain"),
                          10,
                        );

                      setDraggedLayerIndex(null);
                      setDropLayerIndex(null);

                      if (
                        !Number.isFinite(sourceDisplayIndex) ||
                        sourceDisplayIndex === displayIndex
                      ) {
                        return;
                      }

                      const fromActualIndex = layerCount - 1 - sourceDisplayIndex;
                      const toActualIndex = layerCount - 1 - displayIndex;
                      onReorderElements(fromActualIndex, toActualIndex);
                    }}
                    onDragEnd={() => {
                      setDraggedLayerIndex(null);
                      setDropLayerIndex(null);
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelectElement(el.id); }}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs transition active:scale-[0.98] cursor-pointer group border",
                      selectedElementId === el.id 
                        ? "bg-primary/10 text-primary border-primary/30" 
                        : "text-muted-foreground/80 hover:bg-muted/40 hover:text-foreground border-transparent",
                      dropLayerIndex === displayIndex && "ring-2 ring-primary/40",
                      draggedLayerIndex === displayIndex && "opacity-50",
                      layerCount > 1 && "cursor-grab active:cursor-grabbing",
                    )}
                  >
                    <div className="text-muted-foreground/35">
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <div className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-lg transition",
                      selectedElementId === el.id ? "bg-primary/20" : "bg-muted/60"
                    )}>
                      {el.type === "text" ? (
                        <Type className="h-3.5 w-3.5" />
                      ) : el.type === "image" ? (
                        <ImageIcon className="h-3.5 w-3.5" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <span className="truncate font-bold tracking-tight">
                        {el.type === "text"
                          ? el.contentRole === "scriptureVerse"
                            ? el.content || "Verse"
                            : el.contentRole === "scriptureFooter"
                              ? el.content || "Footer"
                              : el.content || (el.isPlaceholder ? "Text" : "Empty text")
                          : el.type === "image"
                            ? el.content?.trim() || `Image ${actualIndex + 1}`
                            : `Shape ${actualIndex + 1}`}
                      </span>
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40">{el.type}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          onUpdateElement(selectedSlideId, el.id, p => ({ ...p, isVisible: !p.isVisible })); 
                        }}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted"
                      >
                        {el.isVisible !== false ? <Eye className="h-3.5 w-3.5 opacity-40 hover:opacity-100" /> : <EyeOff className="h-3.5 w-3.5 text-red-500" />}
                      </button>
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          onUpdateElement(selectedSlideId, el.id, p => ({ ...p, isLocked: !p.isLocked })); 
                        }}
                        className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted"
                      >
                        {el.isLocked ? <Lock className="h-3.5 w-3.5 text-amber-500" /> : <Lock className="h-3.5 w-3.5 opacity-10 hover:opacity-40" />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center opacity-20 py-12">
                <Layers className="h-12 w-12 mb-3" />
                <p className="text-[10px] font-bold uppercase tracking-widest">No Layers</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
