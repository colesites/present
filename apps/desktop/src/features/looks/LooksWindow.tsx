"use client";

import { Check, Monitor, Plus, RadioTower, Tv2 } from "lucide-react";
import { cn } from "../../renderer/shared/lib/utils";
import { useLooksConfig } from "../../renderer/shared/hooks";
import { Input } from "../../renderer/shared/components/ui/input";
import {
  LOOK_LAYER_ORDER,
  LOOK_TARGET_ORDER,
  type LookLayerKey,
  type LookTargetKey,
} from "../../shared/types/looks";

type LookLayerRow = {
  key: LookLayerKey | "text";
  label: string;
};

const LOOK_LAYER_ROWS: LookLayerRow[] = [
  ...LOOK_LAYER_ORDER.filter(
    (layer) => layer.key !== "slide" && layer.key !== "presentation"
  ),
  { key: "text", label: "Text" },
];

export function LooksWindow() {
  const {
    looksConfig,
    selectedLook,
    activeTargetConfig,
    setSelectedLook,
    setSelectedTarget,
    addLook,
    setLookName,
    setLayerEnabledForLook,
    setTextPositionForLook,
  } = useLooksConfig();

  const currentTarget = looksConfig.selectedTarget;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Title bar area */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Looks</h1>
          <p className="text-[11px] text-muted-foreground">
            Layer mapping and text placement per destination
          </p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar p-3">
          <div className="mb-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Looks
              </p>
              <button
                type="button"
                onClick={() => addLook()}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </button>
            </div>
          </div>

          <div className="space-y-1 text-sm">
            {looksConfig.looks.map((look) => {
              const isSelected = look.id === looksConfig.selectedLookId;
              return (
                <div
                  key={look.id}
                  className={cn(
                    "rounded-md border px-2 py-1.5",
                    isSelected
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-transparent"
                  )}
                >
                  <Input
                    value={look.name ?? ""}
                    onFocus={() => setSelectedLook(look.id)}
                    onChange={(event) =>
                      setLookName(look.id, event.target.value)
                    }
                    className={cn(
                      "h-7 border-none bg-transparent px-1 text-[12px] font-medium shadow-none focus-visible:ring-1",
                      isSelected ? "text-primary" : "text-foreground"
                    )}
                    aria-label="Look name"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-auto space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Active Target
            </p>
            <div className="space-y-1">
              {LOOK_TARGET_ORDER.map((target) => (
                <button
                  key={target.key}
                  type="button"
                  onClick={() => setSelectedTarget(target.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                    currentTarget === target.key
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {target.key === "program" ? (
                    <Monitor className="h-3.5 w-3.5" />
                  ) : target.key === "stage" ? (
                    <Tv2 className="h-3.5 w-3.5" />
                  ) : (
                    <RadioTower className="h-3.5 w-3.5" />
                  )}
                  {target.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          {/* Layer grid */}
          <section>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Layers
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              {/* Header row */}
              <div className="grid grid-cols-[200px_repeat(3,minmax(0,1fr))] border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <span>Layer</span>
                {LOOK_TARGET_ORDER.map((target) => (
                  <span key={target.key} className="text-center">
                    {target.label}
                  </span>
                ))}
              </div>

              {LOOK_LAYER_ROWS.map((layer) => (
                <div
                  key={layer.key}
                  className="grid grid-cols-[200px_repeat(3,minmax(0,1fr))] items-center border-b border-border/60 px-4 py-2.5 text-[13px] text-foreground last:border-b-0"
                >
                  <span>{layer.label}</span>
                  {LOOK_TARGET_ORDER.map((target) => {
                    const checked =
                      layer.key === "text"
                        ? Boolean(
                            selectedLook.targets[target.key].layers.slide ||
                              selectedLook.targets[target.key].layers.presentation
                          )
                        : Boolean(selectedLook.targets[target.key].layers[layer.key]);
                    return (
                      <label
                        key={`${layer.key}-${target.key}`}
                        className="flex items-center justify-center"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            if (layer.key === "text") {
                              setLayerEnabledForLook(
                                selectedLook.id,
                                target.key,
                                "slide",
                                enabled
                              );
                              setLayerEnabledForLook(
                                selectedLook.id,
                                target.key,
                                "presentation",
                                enabled
                              );
                              return;
                            }
                            setLayerEnabledForLook(
                              selectedLook.id,
                              target.key,
                              layer.key,
                              enabled
                            );
                          }}
                          className="peer sr-only"
                          aria-label={`${layer.label} on ${target.label}`}
                        />
                        <span
                          className={cn(
                            "inline-flex min-w-[56px] items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wide transition-colors",
                            checked
                              ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300"
                              : "border-border bg-transparent text-muted-foreground"
                          )}
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{checked ? "On" : "Off"}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>

          {/* Text position */}
          <section className="mt-6">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Text Position — {labelForTarget(currentTarget)}
            </p>
            <p className="mb-4 text-[11px] text-muted-foreground">
              Adjust text region for this destination without affecting others.
            </p>

            <div className="grid gap-4 md:grid-cols-2">
              <SliderField
                label="Horizontal"
                value={activeTargetConfig.textPosition.xPercent}
                onChange={(value) =>
                  setTextPositionForLook(selectedLook.id, currentTarget, {
                    xPercent: value,
                  })
                }
              />
              <SliderField
                label="Vertical"
                value={activeTargetConfig.textPosition.yPercent}
                onChange={(value) =>
                  setTextPositionForLook(selectedLook.id, currentTarget, {
                    yPercent: value,
                  })
                }
              />
              <SliderField
                label="Width"
                value={activeTargetConfig.textPosition.widthPercent}
                onChange={(value) =>
                  setTextPositionForLook(selectedLook.id, currentTarget, {
                    widthPercent: value,
                  })
                }
              />
              <SliderField
                label="Height"
                value={activeTargetConfig.textPosition.heightPercent}
                onChange={(value) =>
                  setTextPositionForLook(selectedLook.id, currentTarget, {
                    heightPercent: value,
                  })
                }
              />
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ToggleGroup
                title="Text Align"
                options={[
                  { key: "left", label: "Left" },
                  { key: "center", label: "Center" },
                  { key: "right", label: "Right" },
                ]}
                value={activeTargetConfig.textPosition.textAlign}
                onChange={(value) =>
                  setTextPositionForLook(selectedLook.id, currentTarget, {
                    textAlign: value as "left" | "center" | "right",
                  })
                }
              />
              <ToggleGroup
                title="Vertical Align"
                options={[
                  { key: "top", label: "Top" },
                  { key: "middle", label: "Middle" },
                  { key: "bottom", label: "Bottom" },
                ]}
                value={activeTargetConfig.textPosition.verticalAlign}
                onChange={(value) =>
                  setTextPositionForLook(selectedLook.id, currentTarget, {
                    verticalAlign: value as "top" | "middle" | "bottom",
                  })
                }
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

function labelForTarget(target: LookTargetKey) {
  if (target === "program") return "Screen 1";
  if (target === "stage") return "Stage";
  return "NDI";
}

function SliderField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const normalized = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <label className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-foreground">
        <span>{label}</span>
        <span className="text-muted-foreground">{normalized}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={normalized}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full accent-primary"
      />
    </label>
  );
}

function ToggleGroup({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Array<{ key: string; label: string }>;
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-foreground">{title}</p>
      <div className="inline-flex rounded-md border border-border bg-muted/20 p-1">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "rounded px-2.5 py-1 text-[11px] transition-colors",
              value === option.key
                ? "bg-primary/20 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
