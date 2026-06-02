"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  Plus,
  Trash2,
  Type as TypeIcon,
} from "lucide-react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { cn } from "../../../renderer/shared/lib/utils";

interface LayersTabPanelProps {
  orgId: Id<"organizations"> | null;
  activePropIds: string[];
  onSetActivePropIds: (ids: string[]) => void;
}

type Prop = {
  _id: Id<"props">;
  name: string;
  kind: "image" | "text";
  imageUrl?: string;
  text?: string;
  position:
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | "center"
    | "full";
  opacity: number;
  sizePercent: number;
  color?: string;
  fontSize?: number;
  order: number;
};

const POSITIONS: Prop["position"][] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
  "full",
];

export function LayersTabPanel({
  orgId,
  activePropIds,
  onSetActivePropIds,
}: LayersTabPanelProps) {
  const props = useQuery(
    api.props.listByOrg,
    orgId ? { orgId } : "skip",
  ) as Prop[] | undefined;
  const createProp = useMutation(api.props.create);
  const updateProp = useMutation(api.props.update);
  const removeProp = useMutation(api.props.remove);

  const [selectedId, setSelectedId] = useState<Id<"props"> | null>(null);

  const sorted = useMemo(
    () => (props ? [...props].sort((a, b) => a.order - b.order) : []),
    [props],
  );

  useEffect(() => {
    if (!selectedId && sorted.length > 0) {
      setSelectedId(sorted[0]._id);
    }
  }, [selectedId, sorted]);

  const selected = useMemo(
    () => sorted.find((p) => p._id === selectedId) ?? null,
    [selectedId, sorted],
  );

  if (!orgId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11px] text-muted-foreground">
        Sign in to manage props.
      </div>
    );
  }

  const toggleVisible = (id: Id<"props">) => {
    const idStr = id as unknown as string;
    if (activePropIds.includes(idStr)) {
      onSetActivePropIds(activePropIds.filter((x) => x !== idStr));
    } else {
      onSetActivePropIds([...activePropIds, idStr]);
    }
  };

  const handleCreateImage = async () => {
    if (!window.electronAPI?.selectPropImage) return;
    const picked = await window.electronAPI.selectPropImage();
    if (!picked) return;
    const id = await createProp({
      orgId,
      name: picked.name.replace(/\.[^.]+$/, ""),
      kind: "image",
      imageUrl: picked.dataUrl,
      position: "bottom-right",
      opacity: 1,
      sizePercent: 20,
    });
    setSelectedId(id);
  };

  const handleCreateText = async () => {
    const id = await createProp({
      orgId,
      name: "Text prop",
      kind: "text",
      text: "Live",
      position: "top-right",
      opacity: 1,
      sizePercent: 30,
      color: "#ffffff",
      fontSize: 48,
    });
    setSelectedId(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between px-3 py-2">
        <p className="text-[11px] font-medium text-foreground">Props</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCreateImage}
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            title="Add image prop"
            aria-label="Add image prop"
          >
            <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={handleCreateText}
            className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
            title="Add text prop"
            aria-label="Add text prop"
          >
            <TypeIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* Grid of prop thumbnails */}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto p-2">
        {sorted.length === 0 ? (
          <div className="col-span-2 flex flex-col items-center justify-center gap-2 px-6 py-8 text-center">
            <Layers
              className="h-8 w-8 text-muted-foreground/60"
              strokeWidth={1.4}
            />
            <p className="text-[11px] text-muted-foreground">
              No props yet. Add an image or text overlay.
            </p>
          </div>
        ) : (
          sorted.map((prop) => {
            const isVisible = activePropIds.includes(prop._id as unknown as string);
            return (
              <button
                key={prop._id}
                type="button"
                onClick={() => setSelectedId(prop._id)}
                className={cn(
                  "group relative flex flex-col gap-1 rounded-sm border p-1.5 text-left transition",
                  selectedId === prop._id
                    ? "border-primary"
                    : "border-border/40 hover:border-foreground/40",
                )}
              >
                <div
                  className="relative flex h-14 w-full items-center justify-center overflow-hidden rounded-sm bg-[repeating-conic-gradient(#1a1a1a_0_25%,#2a2a2a_0_50%)] bg-[length:10px_10px]"
                  style={{ opacity: prop.opacity }}
                >
                  {prop.kind === "image" && prop.imageUrl ? (
                    <img
                      src={prop.imageUrl}
                      alt=""
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span
                      className="px-1 text-center font-semibold leading-tight"
                      style={{
                        color: prop.color ?? "white",
                        fontSize: "12px",
                      }}
                    >
                      {prop.text}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="truncate text-[10px] text-foreground">
                    {prop.name}
                  </span>
                  <span
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleVisible(prop._id);
                    }}
                    className={cn(
                      "cursor-pointer rounded-sm p-0.5 transition",
                      isVisible
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title={isVisible ? "Hide on output" : "Show on output"}
                  >
                    {isVisible ? (
                      <Eye className="h-3 w-3" strokeWidth={1.8} />
                    ) : (
                      <EyeOff className="h-3 w-3" strokeWidth={1.8} />
                    )}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Inspector for the selected prop */}
      {selected && (
        <div className="border-t border-border/70 bg-background/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <input
              type="text"
              defaultValue={selected.name}
              key={selected._id}
              onBlur={(event) =>
                void updateProp({
                  propId: selected._id,
                  name: event.target.value,
                })
              }
              className="flex-1 rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
            />
            <button
              type="button"
              onClick={() =>
                void removeProp({ propId: selected._id }).then(() => {
                  onSetActivePropIds(
                    activePropIds.filter(
                      (x) => x !== (selected._id as unknown as string),
                    ),
                  );
                  setSelectedId(null);
                })
              }
              className="ml-2 rounded-sm p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
              aria-label="Delete prop"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
            </button>
          </div>

          {selected.kind === "text" && (
            <textarea
              key={`${selected._id}-text`}
              defaultValue={selected.text}
              onBlur={(event) =>
                void updateProp({
                  propId: selected._id,
                  text: event.target.value,
                })
              }
              className="mb-2 min-h-[44px] w-full resize-y rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[11px] text-foreground focus:border-primary/60 focus:outline-hidden"
            />
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Position</span>
              <div className="grid grid-cols-3 gap-0.5">
                {POSITIONS.map((position) => (
                  <button
                    key={position}
                    type="button"
                    onClick={() =>
                      void updateProp({ propId: selected._id, position })
                    }
                    aria-pressed={selected.position === position}
                    title={position}
                    className={cn(
                      "h-5 w-5 rounded-sm border text-[8px]",
                      selected.position === position
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border/60 text-muted-foreground hover:border-foreground/40",
                    )}
                  >
                    {position === "full"
                      ? "F"
                      : position
                          .split("-")
                          .map((p) => p[0].toUpperCase())
                          .join("")}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Size {selected.sizePercent}%</span>
              <input
                type="range"
                min={5}
                max={100}
                value={selected.sizePercent}
                onChange={(event) =>
                  void updateProp({
                    propId: selected._id,
                    sizePercent: Number(event.target.value),
                  })
                }
                className="w-32 accent-primary"
              />
            </label>

            <label className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Opacity {Math.round(selected.opacity * 100)}%</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selected.opacity}
                onChange={(event) =>
                  void updateProp({
                    propId: selected._id,
                    opacity: Number(event.target.value),
                  })
                }
                className="w-32 accent-primary"
              />
            </label>

            {selected.kind === "text" && (
              <>
                <label className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Color</span>
                  <input
                    type="color"
                    defaultValue={selected.color ?? "#ffffff"}
                    onChange={(event) =>
                      void updateProp({
                        propId: selected._id,
                        color: event.target.value,
                      })
                    }
                    className="h-5 w-10 rounded-sm border border-border/60 bg-transparent"
                  />
                </label>
                <label className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Font size {selected.fontSize ?? 48}px</span>
                  <input
                    type="range"
                    min={16}
                    max={160}
                    value={selected.fontSize ?? 48}
                    onChange={(event) =>
                      void updateProp({
                        propId: selected._id,
                        fontSize: Number(event.target.value),
                      })
                    }
                    className="w-32 accent-primary"
                  />
                </label>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
