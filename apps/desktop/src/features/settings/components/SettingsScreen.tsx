"use client";

import { useMemo, useRef, useState } from "react";
import { SETTINGS_LANGUAGE_OPTIONS } from "../lib/constants";
import {
  FontFamilySelect,
  FontSizeInput,
} from "../../../renderer/shared/components";
import { cn } from "../../../renderer/shared/lib/utils";
import { MediaItem, MediaFolder } from "../../media/hooks/useMediaFolders";

interface SettingsScreenProps {
  settingsLang: string;
  setSettingsLang: (lang: string) => void;
  settingsScriptureFontFamily: string;
  setSettingsScriptureFontFamily: (font: string) => void;
  settingsScriptureFontSize: number;
  setSettingsScriptureFontSize: (size: number) => void;
  settingsScriptureTextAlign: "left" | "center" | "right";
  setSettingsScriptureTextAlign: (align: "left" | "center" | "right") => void;
  settingsScriptureBackgroundId: string | null;
  setSettingsScriptureBackgroundId: (id: string | null) => void;
  settingsTimerXPercent: number;
  setSettingsTimerXPercent: (value: number) => void;
  settingsTimerYPercent: number;
  setSettingsTimerYPercent: (value: number) => void;
  settingsTimerClockFontPx: number;
  setSettingsTimerClockFontPx: (value: number) => void;
  settingsTimerNameFontPx: number;
  setSettingsTimerNameFontPx: (value: number) => void;
  settingsTimerClockColor: string;
  setSettingsTimerClockColor: (value: string) => void;
  settingsTimerNameColor: string;
  setSettingsTimerNameColor: (value: string) => void;
  settingsTimerNameBannerEnabled: boolean;
  setSettingsTimerNameBannerEnabled: (value: boolean) => void;
  settingsTimerNameBannerColor: string;
  setSettingsTimerNameBannerColor: (value: string) => void;
  settingsTimerTitlePosition: "top" | "bottom";
  setSettingsTimerTitlePosition: (value: "top" | "bottom") => void;
  settingsMediaFolderId: string;
  setSettingsMediaFolderId: (id: string) => void;
  settingsMediaItems: MediaItem[];
  folders: MediaFolder[];
  allMediaItems: MediaItem[];
  selectMediaForOutput: (item: MediaItem | null) => void;
}

export function SettingsScreen({
  settingsLang,
  setSettingsLang,
  settingsScriptureFontFamily,
  setSettingsScriptureFontFamily,
  settingsScriptureFontSize,
  setSettingsScriptureFontSize,
  settingsScriptureTextAlign,
  setSettingsScriptureTextAlign,
  settingsScriptureBackgroundId,
  setSettingsScriptureBackgroundId,
  settingsTimerXPercent,
  setSettingsTimerXPercent,
  settingsTimerYPercent,
  setSettingsTimerYPercent,
  settingsTimerClockFontPx,
  setSettingsTimerClockFontPx,
  settingsTimerNameFontPx,
  setSettingsTimerNameFontPx,
  settingsTimerClockColor,
  setSettingsTimerClockColor,
  settingsTimerNameColor,
  setSettingsTimerNameColor,
  settingsTimerNameBannerEnabled,
  setSettingsTimerNameBannerEnabled,
  settingsTimerNameBannerColor,
  setSettingsTimerNameBannerColor,
  settingsTimerTitlePosition,
  setSettingsTimerTitlePosition,
  settingsMediaFolderId,
  setSettingsMediaFolderId,
  settingsMediaItems,
  folders,
  allMediaItems,
  selectMediaForOutput,
}: SettingsScreenProps) {
  const [activeSection, setActiveSection] = useState<"scripture" | "timer">(
    "scripture"
  );
  const previewRef = useRef<HTMLDivElement>(null);
  const timerBoxRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<null | "move">(null);
  const [timerDraft, setTimerDraft] = useState<{
    xPercent: number;
    yPercent: number;
    clockFontPx: number;
    nameFontPx: number;
    clockColor: string;
    nameColor: string;
    nameBannerEnabled: boolean;
    nameBannerColor: string;
    titlePosition: "top" | "bottom";
  } | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    timerX: number;
    timerY: number;
  } | null>(null);
  const minClockFont = 12;
  const maxClockFont = 400;
  const minNameFont = 8;
  const maxNameFont = 220;
  const normalizePercent = (value: number) => Number(value.toFixed(2));
  const clampTimerLayout = (layout: { xPercent: number; yPercent: number }) => {
    const xPercent = Math.min(Math.max(layout.xPercent, 0), 100);
    const yPercent = Math.min(Math.max(layout.yPercent, 0), 100);
    return { xPercent, yPercent };
  };
  const updateTimerDraft = (
    patch: Partial<{
      xPercent: number;
      yPercent: number;
      clockFontPx: number;
      nameFontPx: number;
      clockColor: string;
      nameColor: string;
      nameBannerEnabled: boolean;
      nameBannerColor: string;
      titlePosition: "top" | "bottom";
    }>
  ) => {
    setTimerDraft((previous) => ({
      ...(previous ?? {
        xPercent: settingsTimerXPercent,
        yPercent: settingsTimerYPercent,
        clockFontPx: settingsTimerClockFontPx,
        nameFontPx: settingsTimerNameFontPx,
        clockColor: settingsTimerClockColor,
        nameColor: settingsTimerNameColor,
        nameBannerEnabled: settingsTimerNameBannerEnabled,
        nameBannerColor: settingsTimerNameBannerColor,
        titlePosition: settingsTimerTitlePosition,
      }),
      ...patch,
    }));
  };
  const draftTimerXPercent = timerDraft?.xPercent ?? settingsTimerXPercent;
  const draftTimerYPercent = timerDraft?.yPercent ?? settingsTimerYPercent;
  const draftTimerClockFontPx =
    timerDraft?.clockFontPx ?? settingsTimerClockFontPx;
  const draftTimerNameFontPx =
    timerDraft?.nameFontPx ?? settingsTimerNameFontPx;
  const draftTimerClockColor =
    timerDraft?.clockColor ?? settingsTimerClockColor;
  const draftTimerNameColor = timerDraft?.nameColor ?? settingsTimerNameColor;
  const draftTimerNameBannerEnabled =
    timerDraft?.nameBannerEnabled ?? settingsTimerNameBannerEnabled;
  const draftTimerNameBannerColor =
    timerDraft?.nameBannerColor ?? settingsTimerNameBannerColor;
  const draftTimerTitlePosition =
    timerDraft?.titlePosition ?? settingsTimerTitlePosition;
  const clampedDraftTimer = clampTimerLayout({
    xPercent: draftTimerXPercent,
    yPercent: draftTimerYPercent,
  });
  const clampedDraftTimerX = clampedDraftTimer.xPercent;
  const clampedDraftTimerY = clampedDraftTimer.yPercent;
  const clampedTimer = clampTimerLayout({
    xPercent: settingsTimerXPercent,
    yPercent: settingsTimerYPercent,
  });
  const clampedTimerX = clampedTimer.xPercent;
  const clampedTimerY = clampedTimer.yPercent;
  const timerStyle = useMemo(
    () => ({
      left: `${clampedDraftTimerX}%`,
      top: `${clampedDraftTimerY}%`,
      transform: "translate(-50%, -50%)",
    }),
    [clampedDraftTimerX, clampedDraftTimerY]
  );
  const timerClockFontPx = useMemo(
    () => Math.min(Math.max(draftTimerClockFontPx, minClockFont), maxClockFont),
    [draftTimerClockFontPx]
  );
  const timerTitleFontPx = useMemo(
    () => Math.min(Math.max(draftTimerNameFontPx, minNameFont), maxNameFont),
    [draftTimerNameFontPx]
  );
  const hasPendingTimerChanges =
    normalizePercent(clampedDraftTimerX) !== normalizePercent(clampedTimerX) ||
    normalizePercent(clampedDraftTimerY) !== normalizePercent(clampedTimerY) ||
    timerClockFontPx !== settingsTimerClockFontPx ||
    timerTitleFontPx !== settingsTimerNameFontPx ||
    draftTimerClockColor !== settingsTimerClockColor ||
    draftTimerNameColor !== settingsTimerNameColor ||
    draftTimerNameBannerEnabled !== settingsTimerNameBannerEnabled ||
    draftTimerNameBannerColor !== settingsTimerNameBannerColor ||
    draftTimerTitlePosition !== settingsTimerTitlePosition;

  const startPointerDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    mode: "move"
  ) => {
    if (!previewRef.current) {
      return;
    }
    event.preventDefault();
    previewRef.current.setPointerCapture(event.pointerId);
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      timerX: clampedDraftTimerX,
      timerY: clampedDraftTimerY,
    };
    setDragMode(mode);
  };

  const onPreviewPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragMode || !dragStartRef.current || !previewRef.current) {
      return;
    }
    const rect = previewRef.current.getBoundingClientRect();
    const deltaXPct =
      ((event.clientX - dragStartRef.current.x) / rect.width) * 100;
    const deltaYPct =
      ((event.clientY - dragStartRef.current.y) / rect.height) * 100;

    if (dragMode === "move") {
      const timerRect = timerBoxRef.current?.getBoundingClientRect();
      const timerWidthPct = timerRect
        ? (timerRect.width / rect.width) * 100
        : 0;
      const timerHeightPct = timerRect
        ? (timerRect.height / rect.height) * 100
        : 0;
      const halfWidthPct = timerWidthPct / 2;
      const halfHeightPct = timerHeightPct / 2;
      const nextX = Math.min(
        Math.max(dragStartRef.current.timerX + deltaXPct, halfWidthPct),
        Math.max(100 - halfWidthPct, halfWidthPct)
      );
      const nextY = Math.min(
        Math.max(dragStartRef.current.timerY + deltaYPct, halfHeightPct),
        Math.max(100 - halfHeightPct, halfHeightPct)
      );
      updateTimerDraft({ xPercent: nextX, yPercent: nextY });
    }
  };

  const stopPointerDrag = () => {
    dragStartRef.current = null;
    setDragMode(null);
  };

  const getTimerSizePercent = () => {
    if (!previewRef.current || !timerBoxRef.current) {
      return { widthPct: 0, heightPct: 0 };
    }
    const previewRect = previewRef.current.getBoundingClientRect();
    const timerRect = timerBoxRef.current.getBoundingClientRect();
    if (previewRect.width === 0 || previewRect.height === 0) {
      return { widthPct: 0, heightPct: 0 };
    }
    return {
      widthPct: (timerRect.width / previewRect.width) * 100,
      heightPct: (timerRect.height / previewRect.height) * 100,
    };
  };

  const getTimerHalfSizePercent = () => {
    const { widthPct, heightPct } = getTimerSizePercent();
    return {
      halfWidthPct: widthPct / 2,
      halfHeightPct: heightPct / 2,
    };
  };

  const applyTimerLayout = () => {
    const { halfWidthPct, halfHeightPct } = getTimerHalfSizePercent();
    const nextX = Math.min(
      Math.max(clampedDraftTimerX, halfWidthPct),
      Math.max(100 - halfWidthPct, halfWidthPct)
    );
    const nextY = Math.min(
      Math.max(clampedDraftTimerY, halfHeightPct),
      Math.max(100 - halfHeightPct, halfHeightPct)
    );
    setSettingsTimerXPercent(nextX);
    setSettingsTimerYPercent(nextY);
    setSettingsTimerClockFontPx(timerClockFontPx);
    setSettingsTimerNameFontPx(timerTitleFontPx);
    setSettingsTimerClockColor(draftTimerClockColor);
    setSettingsTimerNameColor(draftTimerNameColor);
    setSettingsTimerNameBannerEnabled(draftTimerNameBannerEnabled);
    setSettingsTimerNameBannerColor(draftTimerNameBannerColor);
    setSettingsTimerTitlePosition(draftTimerTitlePosition);
    setTimerDraft(null);
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex h-full w-64 shrink-0 flex-col gap-4 border-r border-border bg-card px-4 py-5">
        <div>
          <h1 className="text-sm font-semibold">Settings</h1>
          <p className="text-[11px] text-muted-foreground">
            Configure Present for your context
          </p>
        </div>

        <nav className="space-y-1 text-xs">
          <button
            type="button"
            onClick={() => setActiveSection("scripture")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "scripture"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Scripture
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("timer")}
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-left font-medium transition",
              activeSection === "timer"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            Timer Layout
          </button>
        </nav>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-card px-6 py-3">
          <h2 className="text-sm font-semibold">
            {activeSection === "scripture" ? "Scripture" : "Timer Layout"}
          </h2>
          <p className="text-[11px] text-muted-foreground">
            {activeSection === "scripture"
              ? "Control how voice search listens for Bible passages."
              : "Drag timer position and customize timer/name style for output screens."}
          </p>
        </div>

        <div className="flex flex-1 flex-col space-y-6 overflow-hidden px-6 py-4">
          {activeSection === "scripture" ? (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Voice language
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Choose the language or accent the microphone should expect
                  when identifying scripture.
                </p>
                <div className="mt-2 max-w-xs">
                  <select
                    value={settingsLang}
                    onChange={(e) => setSettingsLang(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {SETTINGS_LANGUAGE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Typography
                </h3>
                <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 w-fit">
                  <FontFamilySelect
                    value={settingsScriptureFontFamily}
                    onChange={setSettingsScriptureFontFamily}
                  />

                  <FontSizeInput
                    value={settingsScriptureFontSize}
                    onChange={setSettingsScriptureFontSize}
                    presets={[6, 8, 10, 12, 14, 16, 18, 20, 24, 30]}
                    unit="vh"
                    min={1}
                    max={50}
                  />
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Text Alignment
                </h3>
                <div className="flex items-center gap-2">
                  {(["left", "center", "right"] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      onClick={() => setSettingsScriptureTextAlign(align)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs capitalize transition",
                        settingsScriptureTextAlign === align
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {align}
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Output timer layout
              </h3>
              <div
                ref={previewRef}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={stopPointerDrag}
                onPointerCancel={stopPointerDrag}
                className="relative aspect-video w-full max-w-xl overflow-hidden rounded-sm border border-border/60 bg-black"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/35 to-black/55" />
                {draftTimerNameBannerEnabled ? (
                  <div
                    style={{
                      backgroundColor: draftTimerNameBannerColor,
                      color: draftTimerNameColor,
                      fontSize: `${timerTitleFontPx}px`,
                    }}
                    className="absolute inset-x-0 top-0 z-20 px-2 py-1 text-center font-medium uppercase tracking-wider"
                  >
                    Timer Name
                  </div>
                ) : null}
                <div
                  ref={timerBoxRef}
                  style={timerStyle}
                  onPointerDown={(event) => startPointerDrag(event, "move")}
                  className="absolute z-20 box-border rounded-md border border-primary/60 bg-black/65 px-2 py-0 text-[9px] font-semibold tracking-wide shadow-lg select-none cursor-move"
                >
                  {!draftTimerNameBannerEnabled &&
                  draftTimerTitlePosition === "top" ? (
                    <div
                      style={{
                        fontSize: `${timerTitleFontPx}px`,
                        color: draftTimerNameColor,
                      }}
                      className="whitespace-nowrap overflow-hidden text-ellipsis font-medium uppercase tracking-wider"
                    >
                      Timer Name
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: `${timerClockFontPx}px`,
                      color: draftTimerClockColor,
                    }}
                    className="font-semibold leading-tight"
                  >
                    00:00:00
                  </div>
                  {!draftTimerNameBannerEnabled &&
                  draftTimerTitlePosition === "bottom" ? (
                    <div
                      style={{
                        fontSize: `${timerTitleFontPx}px`,
                        color: draftTimerNameColor,
                      }}
                      className="whitespace-nowrap overflow-hidden text-ellipsis font-medium uppercase tracking-wider"
                    >
                      Timer Name
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Horizontal</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={clampedDraftTimerX}
                    onChange={(event) =>
                      updateTimerDraft({ xPercent: Number(event.target.value) })
                    }
                    className="w-full accent-primary"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Vertical</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={clampedDraftTimerY}
                    onChange={(event) =>
                      updateTimerDraft({ yPercent: Number(event.target.value) })
                    }
                    className="w-full accent-primary"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Timer font size</span>
                  <input
                    type="range"
                    min={minClockFont}
                    max={maxClockFont}
                    value={timerClockFontPx}
                    onChange={(event) =>
                      updateTimerDraft({
                        clockFontPx: Number(event.target.value),
                      })
                    }
                    className="w-full accent-primary"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Name font size</span>
                  <input
                    type="range"
                    min={minNameFont}
                    max={maxNameFont}
                    value={timerTitleFontPx}
                    onChange={(event) =>
                      updateTimerDraft({
                        nameFontPx: Number(event.target.value),
                      })
                    }
                    className="w-full accent-primary"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  Alignment
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const { halfWidthPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ xPercent: halfWidthPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Left
                </button>
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ xPercent: 50 })}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Center
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { halfWidthPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ xPercent: 100 - halfWidthPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Right
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { halfHeightPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ yPercent: halfHeightPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Top
                </button>
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ yPercent: 50 })}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Middle
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { halfHeightPct } = getTimerHalfSizePercent();
                    updateTimerDraft({ yPercent: 100 - halfHeightPct });
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
                >
                  Bottom
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Timer color</span>
                  <input
                    type="color"
                    value={draftTimerClockColor}
                    onChange={(event) =>
                      updateTimerDraft({ clockColor: event.target.value })
                    }
                    className="h-8 w-full rounded border border-border bg-transparent"
                  />
                </label>
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Name color</span>
                  <input
                    type="color"
                    value={draftTimerNameColor}
                    onChange={(event) =>
                      updateTimerDraft({ nameColor: event.target.value })
                    }
                    className="h-8 w-full rounded border border-border bg-transparent"
                  />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draftTimerNameBannerEnabled}
                  onChange={(event) =>
                    updateTimerDraft({
                      nameBannerEnabled: event.target.checked,
                    })
                  }
                  className="accent-primary"
                />
                Name as top banner
              </label>
              {draftTimerNameBannerEnabled ? (
                <label className="space-y-1 text-[11px] text-muted-foreground">
                  <span>Banner background</span>
                  <input
                    type="color"
                    value={draftTimerNameBannerColor}
                    onChange={(event) =>
                      updateTimerDraft({ nameBannerColor: event.target.value })
                    }
                    className="h-8 w-full rounded border border-border bg-transparent"
                  />
                </label>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ titlePosition: "top" })}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition",
                    draftTimerTitlePosition === "top"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  Title top
                </button>
                <button
                  type="button"
                  onClick={() => updateTimerDraft({ titlePosition: "bottom" })}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs transition",
                    draftTimerTitlePosition === "bottom"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  Title bottom
                </button>
              </div>
              <button
                type="button"
                onClick={applyTimerLayout}
                disabled={!hasPendingTimerChanges}
                className={cn(
                  "rounded-md px-3 py-2 text-xs font-semibold transition",
                  hasPendingTimerChanges
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-muted text-muted-foreground"
                )}
              >
                Update timer layout
              </button>
            </section>
          )}

          {activeSection === "scripture" ? (
            <section className="flex flex-1 flex-col space-y-2 min-h-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Scripture background
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Choose a media file to display behind scripture passages.
              </p>
              {allMediaItems.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Add media in the Media tab to pick a background.
                </p>
              ) : (
                <div className="mt-3 flex flex-1 flex-col space-y-3 min-h-0">
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSettingsScriptureBackgroundId(null)}
                      className={
                        settingsScriptureBackgroundId === null
                          ? "rounded-md border border-primary bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                          : "rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                      }
                    >
                      Use current media
                    </button>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      Background override media
                    </span>
                  </div>

                  <div className="flex flex-1 flex-col space-y-2 min-h-0">
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span className="text-[11px] text-muted-foreground">
                        Folder
                      </span>
                      <select
                        value={settingsMediaFolderId}
                        onChange={(e) =>
                          setSettingsMediaFolderId(e.target.value)
                        }
                        className="h-7 rounded-md border border-input bg-background px-2 text-[11px] text-foreground"
                      >
                        <option value="all">All folders</option>
                        {folders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-2">
                      <div className="grid grid-cols-6 gap-1.5">
                        {settingsMediaItems.map((item) => {
                          const isActive =
                            settingsScriptureBackgroundId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setSettingsScriptureBackgroundId(item.id);
                                selectMediaForOutput(item);
                              }}
                              className={
                                (isActive
                                  ? "border-primary ring-1 ring-primary "
                                  : "border-border hover:border-primary ") +
                                "relative aspect-video overflow-hidden rounded-md border bg-black"
                              }
                            >
                              {item.type === "image" ? (
                                <img
                                  src={item.url}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <video
                                  src={item.url}
                                  className="h-full w-full object-cover"
                                  muted
                                  onMouseEnter={(e) => e.currentTarget.play()}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.pause();
                                    e.currentTarget.currentTime = 0;
                                  }}
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
