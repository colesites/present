"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ColorInput, Segmented } from "../../../renderer/shared/components/style-controls";
import { DEFAULT_TIME_UP, type TimeUpSettings } from "../../../renderer/shared/hooks/useTimers";
import { cn } from "../../../renderer/shared/lib/utils";
import {
  SETTINGS_FIELD,
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
  /** The name with the clock on the audience screens. */
  showName: boolean;
  nameBannerColor: string;
  titlePosition: "top" | "bottom";
  /** Behind the clock, or "" for nothing. */
  boxColor: string;
  /** What shows once the live timer runs out. */
  timeUp: TimeUpSettings;
}

/** The backgrounds offered behind the clock, and "Color" for any other. */
const BOX_CHOICES: Array<{ value: string; label: string; color: string }> = [
  { value: "none", label: "None", color: "" },
  { value: "black", label: "Black", color: "#000000" },
  { value: "dimmed", label: "Dimmed", color: "rgba(0, 0, 0, 0.65)" },
  { value: "color", label: "Color", color: "#1e293b" },
];

const boxChoiceOf = (color: string) =>
  BOX_CHOICES.find((choice) => choice.value !== "color" && choice.color === color.trim())?.value ?? "color";

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
        : key === "timeUp"
          ? JSON.stringify(draft.timeUp) !== JSON.stringify(layout.timeUp)
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

  const showNameInBox = current.showName && !current.nameBannerEnabled;
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
            className="relative mx-auto aspect-video w-full max-w-[560px] touch-none select-none overflow-hidden rounded-lg bg-black ring-1 ring-white/10"
          >
            <div className="pointer-events-none absolute inset-[5%] rounded border border-dashed border-white/10" />
            {current.showName && current.nameBannerEnabled ? (
              <div
                style={{
                  backgroundColor: current.nameBannerColor,
                  color: current.nameColor,
                  fontSize: nameFont * scale,
                  height: current.nameBannerHeightPx * scale,
                }}
                className={cn(
                  "absolute inset-x-0 z-20 flex items-center justify-center font-medium uppercase tracking-wider",
                  current.titlePosition === "top" ? "top-0" : "bottom-0",
                )}
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
                "absolute z-20 rounded-md text-center font-semibold tracking-wide text-white outline outline-1",
                dragging
                  ? "cursor-grabbing outline-primary"
                  : "cursor-grab outline-dashed outline-primary/40 hover:outline-primary",
              )}
              style={{
                left: `${x}%`,
                top: `${y}%`,
                transform: "translate(-50%, -50%)",
                padding: `${clockFont * 0.12 * scale}px ${clockFont * 0.25 * scale}px`,
                backgroundColor: current.boxColor || "transparent",
                borderRadius: clockFont * 0.12 * scale,
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
        <SettingsRow label="Background" description="Behind the clock, and the name when it sits with it.">
          <Segmented
            label="Background behind the clock"
            className="w-[260px]"
            value={boxChoiceOf(current.boxColor)}
            onChange={(value) => {
              const choice = BOX_CHOICES.find((each) => each.value === value);
              if (choice) update({ boxColor: choice.color });
            }}
            options={BOX_CHOICES.map(({ value, label }) => ({ value, label }))}
          />
        </SettingsRow>
        {boxChoiceOf(current.boxColor) === "color" ? (
          <SettingsRow label="Background color">
            <div className="w-[180px]">
              <ColorInput
                label="Background color"
                alpha
                value={current.boxColor}
                onChange={(value) => update({ boxColor: value })}
              />
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="Name" description="The timer's name, like Sermon or Offering.">
        <SettingsRow
          label="Show the name"
          description="With the clock on the audience screens. Stage screens show it where their layout has it."
        >
          <SettingsSwitch
            label="Show the timer's name"
            checked={current.showName}
            onChange={(checked) => update({ showName: checked })}
          />
        </SettingsRow>
        {current.showName ? (
          <>
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
            <SettingsRow
              label="Place"
              description={
                current.nameBannerEnabled
                  ? "The banner across the top or the bottom of the screen."
                  : "Above or below the clock."
              }
            >
              <Segmented
                label={current.nameBannerEnabled ? "Banner at the top or bottom" : "Name above or below the clock"}
                className="w-[168px]"
                value={current.titlePosition}
                onChange={(value) => update({ titlePosition: value === "top" ? "top" : "bottom" })}
                options={
                  current.nameBannerEnabled
                    ? [
                        { value: "top", label: "Top" },
                        { value: "bottom", label: "Bottom" },
                      ]
                    : [
                        { value: "top", label: "Above" },
                        { value: "bottom", label: "Below" },
                      ]
                }
              />
            </SettingsRow>
            <SettingsRow label="Banner" description="The name in a band across the screen instead.">
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
          </>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="When time is up"
        description="Once the live timer runs out and no other timer follows it."
      >
        <div className="flex">
          <div className="flex flex-none items-center border-r border-border/60 p-4">
            <TimeUpPreview layout={current} />
          </div>
          <div className="min-w-0 flex-1 divide-y divide-border/60">
            <SettingsRow label="Show a message" description="Instead of the clock stopped at 00:00:00." className="min-h-[52px]">
              <SettingsSwitch
                label="Show a message when time is up"
                checked={current.timeUp.enabled}
                onChange={(enabled) => update({ timeUp: { ...current.timeUp, enabled } })}
              />
            </SettingsRow>
            {current.timeUp.enabled ? (
              <>
                <SettingsRow label="Message" className="min-h-[52px]">
                  <input
                    aria-label="Time up message"
                    value={current.timeUp.text}
                    maxLength={40}
                    placeholder={DEFAULT_TIME_UP.text}
                    onChange={(event) => update({ timeUp: { ...current.timeUp, text: event.target.value } })}
                    className={cn(SETTINGS_FIELD, "w-[180px]")}
                  />
                </SettingsRow>
                <SettingsRow label="Color" className="min-h-[52px]">
                  <div className="w-[180px]">
                    <ColorInput
                      label="Time up color"
                      value={current.timeUp.color}
                      onChange={(color) => update({ timeUp: { ...current.timeUp, color } })}
                    />
                  </div>
                </SettingsRow>
                <SettingsRow label="Blink" className="min-h-[52px]">
                  <SettingsSwitch
                    label="Blink the message"
                    checked={current.timeUp.blink}
                    onChange={(blink) => update({ timeUp: { ...current.timeUp, blink } })}
                  />
                </SettingsRow>
              </>
            ) : null}
          </div>
        </div>
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

/**
 * The screen once time is up, in miniature: the message as the screens show
 * it, in its colour and blinking if it will, or the stopped clock without it.
 */
function TimeUpPreview({ layout }: { layout: TimerLayoutValue }) {
  const { timeUp } = layout;
  const scale = 117 / 1080;
  const clockFont = Math.min(Math.max(layout.clockFontPx, MIN_CLOCK_FONT), MAX_CLOCK_FONT);
  const nameFont = Math.min(Math.max(layout.nameFontPx, MIN_NAME_FONT), MAX_NAME_FONT);
  const name = (
    <div
      style={{ fontSize: Math.max(4, nameFont * scale), color: layout.nameColor }}
      className="whitespace-nowrap font-medium uppercase tracking-wider"
    >
      Sermon
    </div>
  );
  return (
    <div className="relative flex aspect-video w-[208px] flex-none items-center justify-center overflow-hidden rounded-lg bg-black ring-1 ring-white/10">
      <div
        className="text-center font-semibold"
        style={{
          backgroundColor: layout.boxColor || "transparent",
          padding: `${clockFont * 0.12 * scale}px ${clockFont * 0.25 * scale}px`,
          borderRadius: clockFont * 0.12 * scale,
        }}
      >
        {layout.showName && !layout.nameBannerEnabled && layout.titlePosition === "top" ? name : null}
        <div
          className={cn(
            "whitespace-nowrap leading-none tabular-nums",
            timeUp.enabled && timeUp.blink && "present-time-up-blink",
          )}
          style={{
            fontSize: Math.max(8, clockFont * scale),
            color: timeUp.enabled ? timeUp.color : layout.clockColor,
          }}
        >
          {timeUp.enabled ? timeUp.text.trim() || DEFAULT_TIME_UP.text : "00:00:00"}
        </div>
        {layout.showName && !layout.nameBannerEnabled && layout.titlePosition !== "top" ? name : null}
      </div>
    </div>
  );
}
