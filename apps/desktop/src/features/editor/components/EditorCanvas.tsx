"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { 
  Image as ImageIcon, 
  Square, 
  Type, 
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
} from "../../../shared/types";
import { getCanvasSizeDimensions } from "../../library/lib/library-items";

interface EditorCanvasProps {
  editorView: "slides" | "source";
  draftBody: string;
  onSourceBodyChange: (body: string) => void;
  canvasSize: CanvasSizePreset;
  selectedSlide: LibrarySlide | null;
  selectedSlideId: string | null;
  selectedSlideBackground: string | null;
  updateSlide: (id: string | null, updater: (slide: LibrarySlide) => LibrarySlide) => void;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onAddElement: (type: SlideElementType) => void;
  onUpdateElement: (slideId: string | null, elementId: string | null, updater: (el: SlideElement) => SlideElement) => void;
  onRemoveElement: (slideId: string, elementId: string) => void;
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
}

type InteractionMode = "none" | "dragging" | "resizing";
const EDITOR_PREVIEW_TEXT_SIZE_MULTIPLIER = 0.25;

export const EditorCanvas = memo(function EditorCanvas({
  editorView,
  draftBody,
  onSourceBodyChange,
  canvasSize,
  selectedSlide,
  selectedSlideId,
  selectedSlideBackground,
  selectedElementId,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  onRemoveElement,
  fontFamily,
  fontBold,
  fontItalic,
  fontUnderline,
}: EditorCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasDimensions = getCanvasSizeDimensions(canvasSize);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const editingContentRef = useRef<string>("");
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
  } | null>(null);

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

        // For empty placeholders, ensure caret is inside the editor.
        if (!(el.textContent ?? "").trim()) {
          const range = document.createRange();
          const selection = window.getSelection();
          range.selectNodeContents(el);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
    }
  }, [editingElementId]);

  // Keyboard deletion support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedSlideId && selectedElementId && !editingElementId) {
        const target = e.target as HTMLElement;
        if (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        
        e.preventDefault();
        onRemoveElement(selectedSlideId, selectedElementId);
        onSelectElement(null);
      }

      if (e.key === "Escape" && editingElementId) {
        setEditingElementId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSlideId, selectedElementId, editingElementId, onRemoveElement, onSelectElement]);

  // Interaction handlers (Drag & Resize)
  const handleInteractionStart = (
    e: React.PointerEvent,
    element: SlideElement, 
    mode: InteractionMode, 
    handle: string | null = null
  ) => {
    e.stopPropagation();
    onSelectElement(element.id);

    if (element.isLocked && mode !== "none") {
      return;
    }
    
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

      if (interaction.mode === "dragging") {
        onUpdateElement(selectedSlideId, interaction.elementId, (prev) => ({
          ...prev,
          x: interaction.startElX + dx,
          y: interaction.startElY + dy,
        }));
      } else if (interaction.mode === "resizing" && interaction.handle) {
        let nextX = interaction.startElX;
        let nextY = interaction.startElY;
        let nextW = interaction.startElW;
        let nextH = interaction.startElH;

        if (interaction.handle.includes("left")) {
          nextX = interaction.startElX + dx;
          nextW = interaction.startElW - dx;
        }
        if (interaction.handle.includes("right")) {
          nextW = interaction.startElW + dx;
        }
        if (interaction.handle.includes("top")) {
          nextY = interaction.startElY + dy;
          nextH = interaction.startElH - dy;
        }
        if (interaction.handle.includes("bottom")) {
          nextH = interaction.startElH + dy;
        }

        onUpdateElement(selectedSlideId, interaction.elementId, (prev) => ({
          ...prev,
          x: nextX,
          y: nextY,
          width: Math.max(10, nextW),
          height: Math.max(10, nextH),
        }));
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerId !== interaction.pointerId) {
        return;
      }
      setInteraction(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [canvasDimensions.height, canvasDimensions.width, interaction, selectedSlideId, onUpdateElement]);

  if (editorView === "source") {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-background/50 h-full">
        <div className="border-b border-border px-4 py-3 bg-card/20">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60">
            Source editor
          </p>
        </div>
        <textarea
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
          <div className="px-1.5 py-1">
            <ToolbarButton
              active={false}
              onClick={() => onAddElement("text")}
              icon={<Type className="h-[18px] w-[18px]" />}
              label="Text tool (T)"
            />
          </div>
          <div className="px-1.5 py-1">
            <ToolbarButton
              active={false}
              onClick={() => onAddElement("shape")}
              icon={<Square className="h-[18px] w-[18px]" />}
              label="Shape tool"
            />
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
        onPointerDown={() => {
          onSelectElement(null);
        }}
      >
        {/* Slide Canvas */}
        <div 
          ref={canvasRef}
          className="relative w-full max-h-full max-w-full overflow-hidden bg-black shadow-none ring-0 outline-none"
          style={{ 
            aspectRatio: `${canvasDimensions.width} / ${canvasDimensions.height}`,
            backgroundColor: selectedSlideBackground ?? "#000000",
          }}
        >
          {selectedSlide?.elements?.map((element, elementIndex) => (
            <div
              key={element.id}
              onPointerDown={(e) => {
                if (element.type === "text" && editingElementId === element.id) {
                  e.stopPropagation();
                  return;
                }
                handleInteractionStart(e, element, "dragging");
              }}
              onDoubleClick={(e) => {
                if (element.type === "text" && !element.isLocked) {
                  e.stopPropagation();
                  editingContentRef.current =
                    element.isPlaceholder
                      ? ""
                      : element.richTextHtml?.trim() || plainTextToHtml(element.content || "");
                  setEditingElementId(element.id);
                }
              }}
              onClick={(e) => e.stopPropagation()} // Prevent deselection when clicking inside an element
              className={cn(
                "absolute transition-none group",
                element.isLocked ? "cursor-not-allowed" : "cursor-default",
                element.isVisible === false && "opacity-0 pointer-events-none"
              )}
                style={{
                  left: `${(element.x / canvasDimensions.width) * 100}%`,
                  top: `${(element.y / canvasDimensions.height) * 100}%`,
                  width: `${(element.width / canvasDimensions.width) * 100}%`,
                  height: `${(element.height / canvasDimensions.height) * 100}%`,
                  zIndex: elementIndex + 1,
                  opacity: element.style?.opacity ?? 1,
                  fontSize:
                    element.type === "text"
                      ? `calc(${((element.style?.fontSize ?? 120) * EDITOR_PREVIEW_TEXT_SIZE_MULTIPLIER) / 10.8} * 1cqw)`
                      : undefined,
                  lineHeight: "1.2",
                  transform: `rotate(${element.style?.rotation ?? 0}deg) scaleX(${element.style?.flipX ? -1 : 1}) scaleY(${element.style?.flipY ? -1 : 1})`,
                  containerType: 'size',
                touchAction:
                  element.type === "text" && editingElementId === element.id
                    ? "auto"
                    : "none",
              }}
            >
              {/* Selector Overlay (Active Selection) */}
              {selectedElementId === element.id && (
                <div className="absolute -inset-x-px -inset-y-px z-50 pointer-events-none ring-0 border border-primary/90">
                  {/* Selector lines provided in the border-primary above */}
                  
                  {/* 8 Handles */}
                  {!element.isLocked &&
                    [
                      "top-left", "top-middle", "top-right",
                      "mid-left", "mid-right",
                      "bottom-left", "bottom-middle", "bottom-right"
                    ].map(handle => (
                      <div
                        key={handle}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          handleInteractionStart(e, element, "resizing", handle);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "absolute h-1.5 w-1.5 bg-white border border-primary pointer-events-auto shadow-sm z-100",
                          handle === "top-left" && "-left-[3.5px] -top-[3.5px] cursor-nw-resize",
                          handle === "top-middle" && "left-1/2 -top-[3.5px] -translate-x-1/2 cursor-n-resize",
                          handle === "top-right" && "-right-[3.5px] -top-[3.5px] cursor-ne-resize",
                          handle === "mid-left" && "-left-[3.5px] top-1/2 -translate-y-1/2 cursor-w-resize",
                          handle === "mid-right" && "-right-[3.5px] top-1/2 -translate-y-1/2 cursor-e-resize",
                          handle === "bottom-left" && "-left-[3.5px] -bottom-[3.5px] cursor-sw-resize",
                          handle === "bottom-middle" && "left-1/2 -bottom-[3.5px] -translate-x-1/2 cursor-s-resize",
                          handle === "bottom-right" && "-right-[3.5px] -bottom-[3.5px] cursor-se-resize"
                        )}
                      />
                    ))}
                </div>
              )}

              {element.type === "text" ? (
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
              ) : element.type === "shape" ? (
                <div 
                  className="h-full w-full pointer-events-none"
                  style={{
                    backgroundColor: element.style?.backgroundColor,
                    border: `${element.style?.borderWidth ?? 0}px solid ${element.style?.borderColor ?? "transparent"}`,
                    borderRadius: `${element.style?.borderRadius ?? 0}px`,
                    opacity: element.style?.opacity ?? 1
                  }}
                />
              ) : element.type === "image" ? (
                element.content?.trim() ? (
                  <div
                    className="h-full w-full overflow-hidden pointer-events-none"
                    style={{
                      borderRadius: `${element.style?.borderRadius ?? 0}px`,
                      opacity: element.style?.opacity ?? 1,
                    }}
                  >
                    <img
                      src={element.content}
                      alt=""
                      draggable={false}
                      className="h-full w-full select-none"
                      style={{ objectFit: element.style?.objectFit ?? "cover" }}
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
                    <ImageIcon className="h-8 w-8" />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.2em]">
                      Image
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
        </div>
      </div>
    </div>
  );
});

function ToolbarButton({ 
  active, 
  onClick, 
  label,
  icon 
}: { 
  icon: React.ReactNode; 
  active: boolean; 
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-9 w-9 items-center justify-center rounded-full transition-colors active:scale-90",
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
