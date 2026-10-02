"use client";

import { useMemo } from "react";
import { Check, Monitor, Plus, RadioTower, Trash2 } from "lucide-react";
import { cn } from "../../renderer/shared/lib/utils";
import { useLooksConfig } from "../../renderer/shared/hooks";
import { Input } from "../../renderer/shared/components/ui/input";
import { useScreens } from "../../renderer/tauri/screens";
import { LayoutEditor } from "./LayoutEditor";
import {
  LOOK_LAYER_ORDER,
  lookColumn,
  lookTargetForScreen,
  type LookLayerKey,
  type LookTargetKey,
} from "../../shared/types/looks";

/** A column of the layer grid: an audience screen, or the NDI output. */
type LookColumn = { key: LookTargetKey; label: string; ndi: boolean };

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
    setSelectedLook,
    setSelectedTarget,
    addLook,
    removeLook,
    setLookName,
    setLayerEnabledForLook,
    setLayersEnabledForLook,
    setLayoutForLook,
  } = useLooksConfig();
  const { screens } = useScreens();

  // The audience screens as Screen Configuration names them, then the NDI
  // output in Connections. A stage screen shows its stage layout, not a look.
  const columns = useMemo<LookColumn[]>(() => {
    const audience = (screens ?? [])
      .filter((screen) => screen.group === "audience")
      .flatMap((screen) => {
        const key = lookTargetForScreen(screen.id);
        return key ? [{ key, label: screen.name, ndi: false }] : [];
      });
    return [
      ...(audience.length > 0 ? audience : [{ key: "program", label: "Screen", ndi: false }]),
      { key: "ndi", label: "NDI output", ndi: true },
    ];
  }, [screens]);

  // A screen since removed is no column to edit: back to the first.
  const currentColumn =
    columns.find((column) => column.key === looksConfig.selectedTarget) ?? columns[0];
  const currentTarget = currentColumn.key;
  const activeTargetConfig = lookColumn(selectedLook, currentTarget);
  const gridColumns = { gridTemplateColumns: `200px repeat(${columns.length}, minmax(96px, 1fr))` };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Title bar area */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Looks</h1>
          <p className="text-[11px] text-muted-foreground">
            The layers each audience screen shows, and where each one sits on it. Stage screens show
            the stage layout chosen for them in Screen Configuration.
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
              const isOnlyLook = looksConfig.looks.length <= 1;
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
                  <div className="flex items-center gap-1">
                    <Input
                      value={look.name ?? ""}
                      onFocus={() => setSelectedLook(look.id)}
                      onChange={(event) =>
                        setLookName(look.id, event.target.value)
                      }
                      className={cn(
                        "h-7 flex-1 border-none bg-transparent px-1 text-[12px] font-medium shadow-none focus-visible:ring-1",
                        isSelected ? "text-primary" : "text-foreground"
                      )}
                      aria-label="Look name"
                    />
                    {/*
                      The last look has no delete: every destination reads its
                      layers from one, so there is always a look. Disabled
                      rather than hidden, so it is clear the button exists and
                      why it cannot be used.
                    */}
                    <button
                      type="button"
                      onClick={() => removeLook(look.id)}
                      disabled={isOnlyLook}
                      title={
                        isOnlyLook
                          ? "The last look cannot be removed"
                          : `Remove ${look.name || "this look"}`
                      }
                      aria-label={`Remove ${look.name || "look"}`}
                      className={cn(
                        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition",
                        isOnlyLook
                          ? "cursor-not-allowed text-muted-foreground/30"
                          : "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-auto space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Layout for
            </p>
            <div className="space-y-1">
              {columns.map((column) => (
                <button
                  key={column.key}
                  type="button"
                  onClick={() => setSelectedTarget(column.key)}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] transition-colors",
                    currentTarget === column.key
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {column.ndi ? (
                    <RadioTower className="h-3.5 w-3.5 flex-none" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5 flex-none" />
                  )}
                  <span className="truncate">{column.label}</span>
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
            <div className="overflow-x-auto rounded-xl border border-border">
              {/* Header row */}
              <div
                className="grid min-w-max border-b border-border bg-muted/30 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                style={gridColumns}
              >
                <span>Layer</span>
                {columns.map((column) => (
                  <span key={column.key} className="truncate px-1 text-center" title={column.label}>
                    {column.label}
                  </span>
                ))}
              </div>

              {LOOK_LAYER_ROWS.map((layer) => (
                <div
                  key={layer.key}
                  className="grid min-w-max items-center border-b border-border/60 px-4 py-2.5 text-[13px] text-foreground last:border-b-0"
                  style={gridColumns}
                >
                  <span>{layer.label}</span>
                  {columns.map((column) => {
                    const { layers } = lookColumn(selectedLook, column.key);
                    const checked =
                      layer.key === "text"
                        ? Boolean(layers.slide || layers.presentation)
                        : Boolean(layers[layer.key]);
                    return (
                      <label
                        key={`${layer.key}-${column.key}`}
                        className="flex items-center justify-center"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            if (layer.key === "text") {
                              setLayersEnabledForLook(
                                selectedLook.id,
                                column.key,
                                ["slide", "presentation"],
                                enabled
                              );
                              return;
                            }
                            setLayerEnabledForLook(
                              selectedLook.id,
                              column.key,
                              layer.key,
                              enabled
                            );
                          }}
                          className="peer sr-only"
                          aria-label={`${layer.label} on ${column.label}`}
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

          <LayoutEditor
            key={`${selectedLook.id}:${currentTarget}`}
            layout={activeTargetConfig.layout ?? {}}
            // The Screen's banner is never held back by its Messages switch
            // (`services/look_scene.rs`), so it shows there whatever it says.
            layers={
              currentTarget === "program"
                ? { ...activeTargetConfig.layers, messages: true }
                : activeTargetConfig.layers
            }
            columnLabel={currentColumn.label}
            onChange={(layout) => setLayoutForLook(selectedLook.id, currentTarget, layout)}
          />
        </main>
      </div>
    </div>
  );
}
