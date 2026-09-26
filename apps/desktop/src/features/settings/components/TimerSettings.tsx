"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorInput, Segmented } from "../../../renderer/shared/components/style-controls";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  SettingsBlock,
  SettingsButton,
  SettingsButtonGroup,
  SettingsGroup,
  SettingsPage,
  SettingsRow,
  SettingsSlider,
  SettingsSwitch,
} from "./settings-ui";

export interface TimerLayoutValue {
  xPercent: number;
  yPercent: number;
  clockFontPx: number;
  nameFontPx: number;
  nameBannerHeightPx: number;
  clockColor: string;
  nameColor: string;
  nameBannerEnabled: boolean;
  nameBannerColor: string;
  titlePosition: "top" | "bottom";
}

const MIN_CLOCK_FONT = 12;
const MAX_CLOCK_FONT = 400;
// Matching the core's own clamps (`compositor::overlays::draw_timer`), so a
// slider cannot ask for something that will be quietly pulled back into range.
const MIN_NAME_FONT = 8;
const MAX_NAME_FONT = 200;
const MIN_BANNER_HEIGHT = 24;
const MAX_BANNER_HEIGHT = 400;

const clampPercent = (value: number) => Math.min(Math.max(value, 0), 100);
const roundPercent = (value: number) => Number(value.toFixed(2));

/**
 * Where the timer sits on the screens and how it looks. Changes are tried on
 * the preview first and reach the screens when they are applied, so a timer
 * dragged across a live service does not wander across it too.
 */
export function TimerSettings({
  layout,
  onApply,
}: {
  layout: TimerLayoutValue;
  onApply: (layout: TimerLayoutValue) => void;
}) {
  const [draft, setDraft] = useState<TimerLayoutValue | null>(null);
  const current = draft ?? layout;
  const update = (patch: Partial<TimerLayoutValue>) =>
    setDraft((previous) => ({ ...(previous ?? layout), ...patch }));

  const previewRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; timerX: number; timerY: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(1);

  const clockFont = Math.min(Math.max(current.clockFontPx, MIN_CLOCK_FONT), MAX_CLOCK_FONT);
  const nameFont = Math.min(Math.max(current.nameFontPx, MIN_NAME_FONT), MAX_NAME_FONT);
  const x = clampPercent(current.xPercent);
  const y = clampPercent(current.yPercent);

  // The timer is set for a 1920 × 1080 screen. Everything in pixels on this
  // small preview is scaled by the same ratio, so what is seen here, and where
  // a drag stops, is what the screens will show.
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const measure = () => {
      const rect = preview.getBoundingClientRect();
      setScale(Math.min(rect.width / 1920, rect.height / 1080) || 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  /** Half the timer's size, as a share of the preview, to keep it inside. */
  const halfSize = () => {
    const preview = previewRef.current?.getBoundingClientRect();
    const timer = timerRef.current?.getBoundingClientRect();
    if (!preview || !timer || preview.width === 0 || preview.height === 0) {
      return { halfWidth: 0, halfHeight: 0 };
    }
    return {
      halfWidth: (timer.width / preview.width) * 50,
      halfHeight: (timer.height / preview.height) * 50,
    };
  };
  const inside = (value: number, half: number) => Math.min(Math.max(value, half), Math.max(100 - half, half));

  const changed = useMemo(() => {
    if (!draft) return false;
    return (Object.keys(layout) as Array<keyof TimerLayoutValue>).some((key) =>
      key === "xPercent" || key === "yPercent"
        ? roundPercent(clampPercent(draft[key])) !== roundPercent(clampPercent(layout[key]))
        : draft[key] !== layout[key],
    );
  }, [draft, layout]);

  const apply = () => {
    const { halfWidth, halfHeight } = halfSize();
    onApply({
      ...current,
      xPercent: inside(x, halfWidth),
      yPercent: inside(y, halfHeight),
      clockFontPx: clockFont,
      nameFontPx: nameFont,
    });
    setDraft(null);
  };

  const showNameInBox = !current.nameBannerEnabled;
  const nameLine = (
    <div
      style={{ fontSize: nameFont * scale, color: current.nameColor }}
      className="overflow-hidden text-ellipsis whitespace-nowrap font-medium uppercase tracking-wider"
    >
      Timer name
    </div>
  );

  return (
    <SettingsPage
      title="Timer"
      description="Where a countdown sits on the screens, and how it looks. Drag it on the preview."
    >
      <SettingsGroup title="Position">
        <SettingsBlock>
          <div
            ref={previewRef}
            onPointerMove={(event) => {
              const start = dragStart.current;
              const preview = previewRef.current?.getBoundingClientRect();
              if (!dragging || !start || !preview) return;
              const { halfWidth, halfHeight } = halfSize();
              update({
                xPercent: inside(start.timerX + ((event.clientX - start.x) / preview.width) * 100, halfWidth),
                yPercent: inside(start.timerY + ((event.clientY - start.y) / preview.height) * 100, halfHeight),
              });
            }}
            onPointerUp={() => {
              dragStart.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              dragStart.current = null;
              setDragging(false);
            }}
            className="relative mx-auto aspect-video w-full max-w-[560px] touch-none select-none overflow-hidden rounded-lg bg-gradient-to-br from-zinc-800 via-zinc-900 to-black ring-1 ring-white/10"
          >
            <div className="pointer-events-none absolute inset-[5%] rounded border border-dashed border-white/10" />
            {current.nameBannerEnabled ? (
              <div
                style={{
                  backgroundColor: current.nameBannerColor,
                  color: current.nameColor,
                  fontSize: nameFont * scale,
                  height: current.nameBannerHeightPx * scale,
                }}
                className="absolute inset-x-0 top-0 z-20 flex items-center justify-center font-medium uppercase tracking-wider"
              >
                Timer name
              </div>
            ) : null}
            <div
              ref={timerRef}
              onPointerDown={(event) => {
                if (!previewRef.current) return;
                event.preventDefault();
                previewRef.current.setPointerCapture(event.pointerId);
                dragStart.current = { x: event.clientX, y: event.clientY, timerX: x, timerY: y };
                setDragging(true);
              }}
              className={cn(
                "absolute z-20 rounded-md bg-black/65 text-center font-semibold tracking-wide text-white shadow-lg outline outline-1",
                dragging ? "cursor-grabbing outline-primary" : "cursor-grab outline-primary/50 hover:outline-primary",
              )}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
                padding: `${8 * scale}px ${16 * scale}px`,
              }}
            >
              {showNameInBox && current.titlePosition === "top" ? nameLine : null}
              <div style={{ fontSize: clockFont * scale, color: current.clockColor }} className="whitespace-nowrap leading-none tabular-nums">
                00:05:00
              </div>
              {showNameInBox && current.titlePosition === "bottom" ? nameLine : null}
            </div>
          </div>
        </SettingsBlock>
        <SettingsRow label="Align">
          <SettingsButtonGroup
            label="Align across"
            onPick={(value) => {
              const { halfWidth } = halfSize();
              update({ xPercent: value === "left" ? halfWidth : value === "right" ? 100 - halfWidth : 50 });
            }}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
          />
          <SettingsButtonGroup
            label="Align down"
            onPick={(value) => {
              const { halfHeight } = halfSize();
              update({ yPercent: value === "top" ? halfHeight : value === "bottom" ? 100 - halfHeight : 50 });
            }}
            options={[
              { value: "top", label: "Top" },
              { value: "middle", label: "Middle" },
              { value: "bottom", label: "Bottom" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Clock">
        <SettingsRow label="Size">
          <SettingsSlider
            label="Clock size"
            value={clockFont}
            min={MIN_CLOCK_FONT}
            max={MAX_CLOCK_FONT}
            suffix="px"
            onChange={(value) => update({ clockFontPx: value })}
          />
        </SettingsRow>
        <SettingsRow label="Color">
          <div className="w-[180px]">
            <ColorInput label="Clock color" value={current.clockColor} onChange={(value) => update({ clockColor: value })} />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Name" description="The timer's name, like Sermon or Offering.">
        <SettingsRow label="Size">
          <SettingsSlider
            label="Name size"
            value={nameFont}
            min={MIN_NAME_FONT}
            max={MAX_NAME_FONT}
            suffix="px"
            onChange={(value) => update({ nameFontPx: value })}
          />
        </SettingsRow>
        <SettingsRow label="Color">
          <div className="w-[180px]">
            <ColorInput label="Name color" value={current.nameColor} onChange={(value) => update({ nameColor: value })} />
          </div>
        </SettingsRow>
        <SettingsRow label="Place" disabled={current.nameBannerEnabled} description="Above or below the clock.">
          <Segmented
            label="Name above or below the clock"
            className="w-[168px]"
            disabled={current.nameBannerEnabled}
            value={current.titlePosition}
            onChange={(value) => update({ titlePosition: value === "top" ? "top" : "bottom" })}
            options={[
              { value: "top", label: "Above" },
              { value: "bottom", label: "Below" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="Banner" description="The name across the top of the screen instead.">
          <SettingsSwitch
            label="Name as a banner"
            checked={current.nameBannerEnabled}
            onChange={(checked) => update({ nameBannerEnabled: checked })}
          />
        </SettingsRow>
        {current.nameBannerEnabled ? (
          <>
            <SettingsRow label="Banner color">
              <div className="w-[180px]">
                <ColorInput
                  label="Banner color"
                  value={current.nameBannerColor}
                  onChange={(value) => update({ nameBannerColor: value })}
                />
              </div>
            </SettingsRow>
            <SettingsRow label="Banner height">
              <SettingsSlider
                label="Banner height"
                value={current.nameBannerHeightPx}
                min={MIN_BANNER_HEIGHT}
                max={MAX_BANNER_HEIGHT}
                suffix="px"
                onChange={(value) => update({ nameBannerHeightPx: value })}
              />
            </SettingsRow>
          </>
        ) : null}
      </SettingsGroup>

      {/* Changes wait here until they are applied. */}
      <div
        className={cn(
          "sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur transition",
          changed ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        )}
        aria-hidden={!changed}
      >
        <p className="text-[12.5px] text-muted-foreground">The screens show the timer as it was until you apply.</p>
        <div className="flex items-center gap-2">
          <SettingsButton variant="ghost" onClick={() => setDraft(null)}>
            Discard
          </SettingsButton>
          <SettingsButton variant="primary" onClick={apply}>
            Apply to screens
          </SettingsButton>
        </div>
      </div>
    </SettingsPage>
  );
}
