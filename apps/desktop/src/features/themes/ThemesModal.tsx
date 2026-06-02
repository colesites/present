"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Palette, Plus, Trash2, X } from "lucide-react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useThemesModalStore } from "../../renderer/shared/store/themesModal";
import { cn } from "../../renderer/shared/lib/utils";
import type { SlideElementStyle } from "../../shared/types";

interface ThemesModalProps {
  orgId: Id<"organizations"> | null;
  // When the user clicks "Apply", we hand the resolved style to the host
  // (the editor) so it can patch the currently-selected slide's text
  // elements. If the host can't apply (no slide selected), it should toast
  // the user.
  onApplyTheme: (payload: {
    style: SlideElementStyle;
    backgroundColor: string | null;
  }) => void;
}

type ThemeRow = {
  _id: Id<"themes">;
  name: string;
  style: SlideElementStyle | undefined;
  backgroundColor?: string;
  previewColor: string;
  order: number;
};

const SEED_PRESETS: Array<{
  name: string;
  previewColor: string;
  backgroundColor: string;
  style: SlideElementStyle;
}> = [
  {
    name: "Black",
    previewColor: "#000000",
    backgroundColor: "#000000",
    style: {
      color: "#ffffff",
      fontFamily: "Inter",
      fontSize: 64,
      fontWeight: "700",
      textAlign: "center",
      verticalAlign: "middle",
    },
  },
  {
    name: "Golden Ticket",
    previewColor: "#c89b3c",
    backgroundColor: "#1a1208",
    style: {
      color: "#f5c95a",
      fontFamily: "Playfair Display",
      fontSize: 60,
      fontWeight: "600",
      textAlign: "center",
      verticalAlign: "middle",
    },
  },
  {
    name: "Influence",
    previewColor: "#ff66e0",
    backgroundColor: "#5b1d6a",
    style: {
      color: "#ffffff",
      fontFamily: "Inter",
      fontSize: 64,
      fontWeight: "800",
      textAlign: "left",
      verticalAlign: "bottom",
      capitalization: "uppercase",
    },
  },
  {
    name: "United",
    previewColor: "#0f172a",
    backgroundColor: "#0f172a",
    style: {
      color: "#ffffff",
      fontFamily: "Bebas Neue",
      fontSize: 96,
      fontWeight: "700",
      textAlign: "center",
      verticalAlign: "middle",
      capitalization: "uppercase",
      letterSpacing: -2,
    } as SlideElementStyle,
  },
  {
    name: "Vivid",
    previewColor: "#7c3aed",
    backgroundColor: "#1c0b2e",
    style: {
      color: "#a78bfa",
      fontFamily: "Inter",
      fontSize: 72,
      fontWeight: "800",
      textAlign: "center",
      verticalAlign: "middle",
    },
  },
  {
    name: "White",
    previewColor: "#ffffff",
    backgroundColor: "#ffffff",
    style: {
      color: "#0a0a0a",
      fontFamily: "Inter",
      fontSize: 60,
      fontWeight: "500",
      textAlign: "center",
      verticalAlign: "middle",
    },
  },
];

export function ThemesModal({ orgId, onApplyTheme }: ThemesModalProps) {
  const isOpen = useThemesModalStore((state) => state.isOpen);
  const close = useThemesModalStore((state) => state.close);

  const themes = useQuery(
    api.themes.listByOrg,
    isOpen && orgId ? { orgId } : "skip",
  ) as ThemeRow[] | undefined;
  const createTheme = useMutation(api.themes.create);
  const updateTheme = useMutation(api.themes.update);
  const removeTheme = useMutation(api.themes.remove);

  const [selectedId, setSelectedId] = useState<Id<"themes"> | null>(null);
  const seededRef = useRef(false);

  // On first open with an empty themes list, seed the default presets so the
  // user always has something to pick from. Only runs once per session.
  useEffect(() => {
    if (!isOpen || !orgId || !themes || seededRef.current) return;
    if (themes.length > 0) {
      seededRef.current = true;
      return;
    }
    seededRef.current = true;
    void (async () => {
      for (const preset of SEED_PRESETS) {
        await createTheme({
          orgId,
          name: preset.name,
          style: preset.style,
          backgroundColor: preset.backgroundColor,
          previewColor: preset.previewColor,
        });
      }
    })();
  }, [createTheme, isOpen, orgId, themes]);

  const sorted = useMemo(
    () => (themes ? [...themes].sort((a, b) => a.order - b.order) : []),
    [themes],
  );

  const selected = useMemo(
    () => sorted.find((theme) => theme._id === selectedId) ?? null,
    [selectedId, sorted],
  );

  // Esc closes the modal.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close, isOpen]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!orgId) return;
    const id = await createTheme({
      orgId,
      name: "New Theme",
      style: {
        color: "#ffffff",
        fontFamily: "Inter",
        fontSize: 56,
        fontWeight: "600",
        textAlign: "center",
        verticalAlign: "middle",
      },
      backgroundColor: "#111",
      previewColor: "#1f2030",
    });
    setSelectedId(id);
  };

  const handleApply = () => {
    if (!selected) return;
    onApplyTheme({
      style: (selected.style as SlideElementStyle) ?? {},
      backgroundColor: selected.backgroundColor ?? null,
    });
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-start bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-label="Themes"
      onClick={close}
    >
      {/* Top-left anchored modal, matching ProPresenter's themes panel. */}
      <div
        className="ml-12 mt-16 w-[420px] max-w-[90vw] overflow-hidden rounded-md border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Palette
              className="h-3.5 w-3.5 text-muted-foreground"
              strokeWidth={1.8}
            />
            <p className="text-[12px] font-medium text-foreground">Themes</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCreate}
              className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              aria-label="New theme"
              title="New theme"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={close}
              className="rounded-sm p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        </header>

        {!orgId ? (
          <div className="p-6 text-center text-[11px] text-muted-foreground">
            Sign in to use themes.
          </div>
        ) : (
          <>
            <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto p-3">
              {sorted.length === 0 ? (
                <p className="col-span-3 py-6 text-center text-[11px] text-muted-foreground">
                  Loading defaults…
                </p>
              ) : (
                sorted.map((theme) => (
                  <ThemeTile
                    key={theme._id}
                    theme={theme}
                    isSelected={selectedId === theme._id}
                    onClick={() => setSelectedId(theme._id)}
                    onDoubleClick={() => {
                      setSelectedId(theme._id);
                      onApplyTheme({
                        style: (theme.style as SlideElementStyle) ?? {},
                        backgroundColor: theme.backgroundColor ?? null,
                      });
                      close();
                    }}
                  />
                ))
              )}
            </div>

            {/* Inspector */}
            {selected && (
              <div className="border-t border-border/70 bg-background/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <input
                    type="text"
                    key={selected._id}
                    defaultValue={selected.name}
                    onBlur={(event) =>
                      void updateTheme({
                        themeId: selected._id,
                        name: event.target.value,
                      })
                    }
                    className="flex-1 rounded-sm border border-border/70 bg-background/40 px-2 py-1 text-[12px] text-foreground focus:border-primary/60 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void removeTheme({ themeId: selected._id }).then(() =>
                        setSelectedId(null),
                      );
                    }}
                    className="ml-2 rounded-sm p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                    aria-label="Delete theme"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <ColorField
                    label="Background"
                    value={selected.backgroundColor ?? "#111111"}
                    onChange={(color) =>
                      void updateTheme({
                        themeId: selected._id,
                        backgroundColor: color,
                        previewColor: color,
                      })
                    }
                  />
                  <ColorField
                    label="Text"
                    value={
                      (selected.style as SlideElementStyle | undefined)?.color ??
                      "#ffffff"
                    }
                    onChange={(color) => {
                      const style = (selected.style ?? {}) as SlideElementStyle;
                      void updateTheme({
                        themeId: selected._id,
                        style: { ...style, color },
                      });
                    }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-sm border border-border/70 bg-background/40 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleApply}
                    className="rounded-sm bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Apply to slide
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ThemeTile({
  theme,
  isSelected,
  onClick,
  onDoubleClick,
}: {
  theme: ThemeRow;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const style = theme.style as SlideElementStyle | undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group flex flex-col items-stretch gap-1 rounded-sm transition",
        isSelected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-foreground/30",
      )}
    >
      <div
        className="flex h-16 w-full items-center justify-center overflow-hidden rounded-sm border border-border/40"
        style={{
          background: theme.backgroundColor ?? theme.previewColor,
        }}
      >
        <span
          className="px-2 text-center font-semibold leading-tight"
          style={{
            color: style?.color ?? "#fff",
            fontFamily: style?.fontFamily,
            fontSize: "11px",
            textTransform:
              style?.capitalization === "uppercase" ? "uppercase" : "none",
          }}
        >
          YOUR TITLE
        </span>
      </div>
      <p className="truncate text-center text-[10px] text-muted-foreground">
        {theme.name}
      </p>
    </button>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-sm border border-border/60 bg-background/40 px-2 py-1.5 text-[10px] text-muted-foreground">
      <span>{label}</span>
      <input
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-5 w-10 cursor-pointer rounded-sm border border-border/60 bg-transparent"
      />
    </label>
  );
}
