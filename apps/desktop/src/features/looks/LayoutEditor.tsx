"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import { cn } from "../../renderer/shared/lib/utils";
import {
  normalizeLayout,
  type LookBox,
  type LookLayerKey,
  type LookLayout,
} from "../../shared/types/looks";
import { LAYOUT_PRESETS, STARTING_PLACEMENTS, boxStyle } from "../../shared/lib/screen-layout.mjs";

/** The parts of a screen a column can place. */
type Part = "words" | "slide" | "media" | "props" | "timer" | "messages";
/** The parts placed as a box, dragged and sized on the screen. */
type BoxPart = "words" | "slide" | "media" | "props";

const PARTS: Array<{ key: Part; label: string; layers: LookLayerKey[]; tint: string }> = [
  // The Text layer's words, and the Slide layer's presentations. The look's
  // keys are older than the names (`looks-config.mjs`).
  { key: "words", label: "Words", layers: ["slide"], tint: "amber" },
  { key: "slide", label: "Slide", layers: ["presentation"], tint: "orange" },
  { key: "media", label: "Media", layers: ["media", "videoInput"], tint: "sky" },
  { key: "props", label: "Props", layers: ["props"], tint: "violet" },
  { key: "timer", label: "Timer", layers: ["timer"], tint: "emerald" },
  { key: "messages", label: "Messages", layers: ["messages", "announcements"], tint: "rose" },
];

const PART_OF = Object.fromEntries(PARTS.map((part) => [part.key, part])) as Record<
  Part,
  (typeof PARTS)[number]
>;

const TINTS: Record<string, { box: string; chip: string }> = {
  amber: { box: "border-amber-400/80 bg-amber-400/10 text-amber-200", chip: "bg-amber-400/20 text-amber-200" },
  orange: { box: "border-orange-400/80 bg-orange-400/10 text-orange-200", chip: "bg-orange-400/20 text-orange-200" },
  sky: { box: "border-sky-400/80 bg-sky-400/10 text-sky-200", chip: "bg-sky-400/20 text-sky-200" },
  violet: { box: "border-violet-400/80 bg-violet-400/10 text-violet-200", chip: "bg-violet-400/20 text-violet-200" },
  emerald: { box: "border-emerald-400/80 bg-emerald-400/15 text-emerald-200", chip: "bg-emerald-400/20 text-emerald-200" },
  rose: { box: "border-rose-400/80 bg-rose-400/15 text-rose-200", chip: "bg-rose-400/20 text-rose-200" },
};

const MIN_BOX = 5;

type Drag =
  | { kind: "move"; part: BoxPart; from: LookBox; x: number; y: number }
  | { kind: "resize"; part: BoxPart; from: LookBox; x: number; y: number; corner: Corner }
  | { kind: "timer"; from: { xPercent: number; yPercent: number }; x: number; y: number };

type Corner = "nw" | "ne" | "sw" | "se";

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
const round = (value: number) => Math.round(value * 10) / 10;

/** A box kept on the screen and big enough to see, as `LookBox::clamped`. */
const keptOnScreen = (box: LookBox): LookBox => {
  const width = clamp(box.widthPercent, MIN_BOX, 100);
  const height = clamp(box.heightPercent, MIN_BOX, 100);
  return {
    xPercent: round(clamp(box.xPercent, width / 2, 100 - width / 2)),
    yPercent: round(clamp(box.yPercent, height / 2, 100 - height / 2)),
    widthPercent: round(width),
    heightPercent: round(height),
  };
};

/** A box with one corner dragged by `dx`, `dy` percent, the opposite one held. */
const resized = (box: LookBox, corner: Corner, dx: number, dy: number): LookBox => {
  let left = box.xPercent - box.widthPercent / 2;
  let right = box.xPercent + box.widthPercent / 2;
  let top = box.yPercent - box.heightPercent / 2;
  let bottom = box.yPercent + box.heightPercent / 2;
  if (corner === "nw" || corner === "sw") left = clamp(left + dx, 0, right - MIN_BOX);
  else right = clamp(right + dx, left + MIN_BOX, 100);
  if (corner === "nw" || corner === "ne") top = clamp(top + dy, 0, bottom - MIN_BOX);
  else bottom = clamp(bottom + dy, top + MIN_BOX, 100);
  return keptOnScreen({
    xPercent: (left + right) / 2,
    yPercent: (top + bottom) / 2,
    widthPercent: right - left,
    heightPercent: bottom - top,
  });
};

const areaOf = (layout: LookLayout, part: BoxPart): LookBox | null =>
  part === "words"
    ? (layout.words?.area ?? null)
    : part === "media"
      ? (layout.media?.area ?? null)
      : (layout[part] ?? null);

const withArea = (layout: LookLayout, part: BoxPart, area: LookBox): LookLayout => {
  if (part === "words" && layout.words) return { ...layout, words: { ...layout.words, area } };
  if (part === "media" && layout.media) return { ...layout, media: { ...layout.media, area } };
  if (part === "slide" || part === "props") return { ...layout, [part]: area };
  return layout;
};

/** `#rrggbb` and an opacity from 0 to 100, from `#rgb`, `#rrggbb` or `#rrggbbaa`. */
const splitColor = (value: string | undefined): { hex: string; alpha: number } => {
  const hex = (value ?? "").replace(/^#/, "");
  if (hex.length === 3) return { hex: `#${[...hex].map((c) => c + c).join("")}`, alpha: 100 };
  if (hex.length === 6) return { hex: `#${hex}`, alpha: 100 };
  if (hex.length === 8) {
    return { hex: `#${hex.slice(0, 6)}`, alpha: Math.round((parseInt(hex.slice(6), 16) / 255) * 100) };
  }
  return { hex: "#000000", alpha: 70 };
};

const joinColor = (hex: string, alpha: number) =>
  `${hex}${Math.round((clamp(alpha, 0, 100) / 100) * 255)
    .toString(16)
    .padStart(2, "0")}`;

/**
 * Where each layer sits on one screen. The canvas is the screen: drag a box
 * to move it, a corner to size it; the panel beside it has the rest. Every
 * change is the column's whole layout, sent as one.
 */
export function LayoutEditor({
  layout,
  layers,
  columnLabel,
  onChange,
}: {
  layout: LookLayout;
  layers: Record<LookLayerKey, boolean>;
  columnLabel: string;
  onChange: (layout: LookLayout) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Part>("words");
  // A ref, not state: the moves of a quick drag arrive before a render
  // would have stored where it began.
  const dragRef = useRef<Drag | null>(null);
  // While a box is dragged it moves here; the column hears of it once, on
  // letting go.
  const [draft, setDraftState] = useState<LookLayout | null>(null);
  const draftRef = useRef<LookLayout | null>(null);
  const setDraft = (next: LookLayout | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const shown = draft ?? layout;

  const commit = (next: LookLayout) => onChange(normalizeLayout(next));
  const shows = (part: Part) => PART_OF[part].layers.some((key) => layers[key]);

  const startDrag = (event: ReactPointerEvent, next: Drag, part: Part) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(part);
    canvasRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = next;
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (!drag || !canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const dx = ((event.clientX - drag.x) / bounds.width) * 100;
    const dy = ((event.clientY - drag.y) / bounds.height) * 100;
    if (drag.kind === "timer") {
      if (!layout.timer) return;
      setDraft({
        ...layout,
        timer: {
          ...layout.timer,
          xPercent: round(clamp(drag.from.xPercent + dx, 0, 100)),
          yPercent: round(clamp(drag.from.yPercent + dy, 0, 100)),
        },
      });
      return;
    }
    const area =
      drag.kind === "move"
        ? keptOnScreen({ ...drag.from, xPercent: drag.from.xPercent + dx, yPercent: drag.from.yPercent + dy })
        : resized(drag.from, drag.corner, dx, dy);
    setDraft(withArea(layout, drag.part, area));
  };

  const endDrag = (event: ReactPointerEvent) => {
    if (canvasRef.current?.hasPointerCapture(event.pointerId)) {
      canvasRef.current.releasePointerCapture(event.pointerId);
    }
    if (dragRef.current && draftRef.current) commit(draftRef.current);
    dragRef.current = null;
    setDraft(null);
  };

  const placeBox = (part: BoxPart) => {
    const area = areaOf(shown, part);
    if (!area) return null;
    const tint = TINTS[PART_OF[part].tint];
    const isSelected = selected === part;
    return (
      <div
        key={part}
        role="button"
        tabIndex={0}
        aria-label={`${part} box`}
        onPointerDown={(event) => startDrag(event, { kind: "move", part, from: area, x: event.clientX, y: event.clientY }, part)}
        className={cn(
          "absolute cursor-move select-none rounded-[3px] border-2 border-dashed",
          tint.box,
          isSelected
            ? "z-30 border-solid"
            : part === "media"
              ? "z-0"
              : part === "slide"
                ? "z-[5]"
                : "z-10",
          !shows(part) && "opacity-40",
        )}
        style={{
          ...boxStyle(area),
          ...(part === "words" && shown.words?.backdrop ? { backgroundColor: shown.words.backdrop } : {}),
        }}
      >
        {part === "words" && shown.words ? (
          <div
            className={cn(
              "flex h-full w-full flex-col overflow-hidden p-[4%] text-white",
              shown.words.verticalAlign === "top" && "justify-start",
              shown.words.verticalAlign === "middle" && "justify-center",
              shown.words.verticalAlign === "bottom" && "justify-end",
            )}
            style={{ textAlign: shown.words.textAlign }}
          >
            <span
              className="font-semibold leading-tight drop-shadow"
              // About the size a verse is drawn at on the screen.
              style={{ fontSize: `clamp(6px, ${3.5 * (shown.words.scalePercent / 100)}cqw, 64px)` }}
            >
              Amazing grace, how sweet the sound
            </span>
          </div>
        ) : (
          <span className={cn("absolute left-1 top-1 rounded px-1 text-[10px] font-medium", tint.chip)}>
            {part === "media"
              ? shown.media?.fill
                ? "Media · fill"
                : "Media · fit"
              : part === "slide"
                ? "Slide"
                : "Props"}
          </span>
        )}
        {isSelected
          ? (["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
              <span
                key={corner}
                aria-hidden="true"
                onPointerDown={(event) =>
                  startDrag(event, { kind: "resize", part, from: area, x: event.clientX, y: event.clientY, corner }, part)
                }
                className={cn(
                  "absolute h-2.5 w-2.5 rounded-sm border border-white bg-zinc-900",
                  corner === "nw" && "-left-1.5 -top-1.5 cursor-nwse-resize",
                  corner === "ne" && "-right-1.5 -top-1.5 cursor-nesw-resize",
                  corner === "sw" && "-bottom-1.5 -left-1.5 cursor-nesw-resize",
                  corner === "se" && "-bottom-1.5 -right-1.5 cursor-nwse-resize",
                )}
              />
            ))
          : null}
      </div>
    );
  };

  const presetId = LAYOUT_PRESETS.find(
    (preset) => JSON.stringify(normalizeLayout(preset.layout)) === JSON.stringify(normalizeLayout(layout)),
  )?.id;

  return (
    <section className="mt-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Layout — {columnLabel}
        </p>
        <button
          type="button"
          onClick={() => commit({})}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        Where each layer sits on {columnLabel}. What you show once appears on every screen, each laid out its own
        way: full screen on the projector, a lower third on the stream.
      </p>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.description}
            onClick={() => commit(preset.layout)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] transition-colors",
              presetId === preset.id
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 xl:flex-row">
        {/* The screen */}
        <div className="min-w-0 flex-1">
          <div
            ref={canvasRef}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative aspect-video w-full max-w-[760px] touch-none overflow-hidden rounded-lg border border-border bg-zinc-950 [container-type:size]"
          >
            {!shown.media && shows("media") ? (
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(56,189,248,0.10),rgba(56,189,248,0.02))]" />
            ) : null}
            {placeBox("media")}
            {placeBox("slide")}
            {placeBox("props")}
            {placeBox("words")}
            {!shown.words && shows("words") ? (
              <div className="pointer-events-none absolute inset-[8%] flex items-center justify-center text-center">
                <span className="font-semibold text-white/60" style={{ fontSize: "clamp(8px, 3.5cqw, 64px)" }}>
                  Amazing grace, how sweet the sound
                </span>
              </div>
            ) : null}
            {shown.messages && shown.messages.edge !== "asSent" && shows("messages") ? (
              <div
                className={cn(
                  "pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center border-y border-rose-400/60 bg-rose-500/25 py-[1.2%] text-rose-100",
                  shown.messages.edge === "top" ? "top-0" : "bottom-0",
                )}
                style={{ fontSize: `clamp(7px, ${1.4 * (shown.messages.scalePercent / 100)}cqw, 28px)` }}
              >
                Message
              </div>
            ) : null}
            {shown.timer ? (
              <TimerMarker
                timer={shown.timer}
                selected={selected === "timer"}
                faded={!shows("timer")}
                onPointerDown={(event, timer) =>
                  startDrag(event, { kind: "timer", from: timer, x: event.clientX, y: event.clientY }, "timer")
                }
              />
            ) : null}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Drag a box to move it, a corner to size it. A faded part is switched off on this screen in Layers.
          </p>
        </div>

        {/* The parts */}
        <div className="w-full shrink-0 space-y-3 xl:w-72">
          <div className="flex flex-wrap gap-1">
            {PARTS.map((part) => (
              <button
                key={part.key}
                type="button"
                onClick={() => setSelected(part.key)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] transition-colors",
                  selected === part.key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {part.label}
                {shown[part.key] ? <span className="ml-1 text-[9px] opacity-70">●</span> : null}
              </button>
            ))}
          </div>
          <PartPanel
            part={selected}
            layout={layout}
            shownHere={shows(selected)}
            columnLabel={columnLabel}
            onChange={commit}
          />
        </div>
      </div>
    </section>
  );
}

function TimerMarker({
  timer,
  selected,
  faded,
  onPointerDown,
}: {
  timer: { xPercent: number; yPercent: number; scalePercent: number };
  selected: boolean;
  faded: boolean;
  onPointerDown: (event: ReactPointerEvent, timer: { xPercent: number; yPercent: number }) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Timer"
      onPointerDown={(event) => onPointerDown(event, timer)}
      className={cn(
        "absolute z-40 -translate-x-1/2 -translate-y-1/2 cursor-move select-none whitespace-nowrap rounded border px-1.5 py-0.5 font-semibold tabular-nums",
        TINTS.emerald.box,
        selected && "ring-2 ring-emerald-300",
        faded && "opacity-40",
      )}
      style={{
        left: `${timer.xPercent}%`,
        top: `${timer.yPercent}%`,
        fontSize: `clamp(7px, ${2 * (timer.scalePercent / 100)}cqw, 40px)`,
      }}
    >
      00:05:00
    </div>
  );
}

function PartPanel({
  part,
  layout,
  shownHere,
  columnLabel,
  onChange,
}: {
  part: Part;
  layout: LookLayout;
  shownHere: boolean;
  columnLabel: string;
  onChange: (layout: LookLayout) => void;
}) {
  const placed = Boolean(layout[part]);
  const { label } = PART_OF[part];
  const { words, slide, media, props, timer, messages } = layout;
  const place = (on: boolean) => {
    const next = { ...layout };
    if (on) Object.assign(next, { [part]: STARTING_PLACEMENTS[part] });
    else delete next[part];
    onChange(next);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      {!shownHere ? (
        <p className="rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
          {label} is switched off on {columnLabel} in Layers.
        </p>
      ) : null}
      <ToggleRow
        title={label}
        options={[
          { key: "screen", label: "As the Screen" },
          { key: "placed", label: part === "messages" ? "Set here" : "Placed" },
        ]}
        value={placed ? "placed" : "screen"}
        onChange={(key) => place(key === "placed")}
      />

      {part === "words" && words ? (
        <>
          <BoxFields area={words.area} onChange={(area) => onChange({ ...layout, words: { ...words, area } })} />
          <ToggleRow
            title="Align"
            options={[
              { key: "left", label: "Left" },
              { key: "center", label: "Center" },
              { key: "right", label: "Right" },
            ]}
            value={words.textAlign}
            onChange={(key) =>
              onChange({ ...layout, words: { ...words, textAlign: key as "left" | "center" | "right" } })
            }
          />
          <ToggleRow
            title="Vertical"
            options={[
              { key: "top", label: "Top" },
              { key: "middle", label: "Middle" },
              { key: "bottom", label: "Bottom" },
            ]}
            value={words.verticalAlign}
            onChange={(key) =>
              onChange({ ...layout, words: { ...words, verticalAlign: key as "top" | "middle" | "bottom" } })
            }
          />
          <RangeField
            label="Size"
            value={words.scalePercent}
            min={25}
            max={200}
            onChange={(scalePercent) => onChange({ ...layout, words: { ...words, scalePercent } })}
          />
          <CheckRow
            label="Words only"
            hint="A designed slide's words in this box, in its font — not the whole slide shrunk into it."
            checked={words.textOnly}
            onChange={(textOnly) => onChange({ ...layout, words: { ...words, textOnly } })}
          />
          <BackdropField
            value={words.backdrop}
            onChange={(backdrop) => {
              const next = { ...words };
              if (backdrop) next.backdrop = backdrop;
              else delete next.backdrop;
              onChange({ ...layout, words: next });
            }}
          />
        </>
      ) : null}

      {part === "media" && media ? (
        <>
          <BoxFields area={media.area} onChange={(area) => onChange({ ...layout, media: { ...media, area } })} />
          <ToggleRow
            title="In its box"
            options={[
              { key: "fit", label: "Fit inside" },
              { key: "fill", label: "Fill" },
            ]}
            value={media.fill ? "fill" : "fit"}
            onChange={(key) => onChange({ ...layout, media: { ...media, fill: key === "fill" } })}
          />
        </>
      ) : null}

      {part === "slide" && slide ? (
        <>
          <p className="text-[10px] text-muted-foreground">
            A presentation's slide — a PDF's page, a PowerPoint's — shrunk evenly into this box, its shape
            kept.
          </p>
          <BoxFields area={slide} onChange={(area) => onChange({ ...layout, slide: area })} />
        </>
      ) : null}

      {part === "props" && props ? (
        <>
          <p className="text-[10px] text-muted-foreground">
            The props, all of them, shrunk evenly into this box where they keep their places.
          </p>
          <BoxFields area={props} onChange={(area) => onChange({ ...layout, props: area })} />
        </>
      ) : null}

      {part === "timer" && timer ? (
        <>
          <RangeField
            label="Across"
            value={timer.xPercent}
            min={0}
            max={100}
            onChange={(xPercent) => onChange({ ...layout, timer: { ...timer, xPercent } })}
          />
          <RangeField
            label="Down"
            value={timer.yPercent}
            min={0}
            max={100}
            onChange={(yPercent) => onChange({ ...layout, timer: { ...timer, yPercent } })}
          />
          <RangeField
            label="Size"
            value={timer.scalePercent}
            min={25}
            max={300}
            onChange={(scalePercent) => onChange({ ...layout, timer: { ...timer, scalePercent } })}
          />
        </>
      ) : null}

      {part === "messages" && messages ? (
        <>
          <ToggleRow
            title="Edge"
            options={[
              { key: "asSent", label: "As sent" },
              { key: "top", label: "Top" },
              { key: "bottom", label: "Bottom" },
            ]}
            value={messages.edge}
            onChange={(key) =>
              onChange({ ...layout, messages: { ...messages, edge: key as "asSent" | "top" | "bottom" } })
            }
          />
          <RangeField
            label="Size"
            value={messages.scalePercent}
            min={25}
            max={300}
            onChange={(scalePercent) => onChange({ ...layout, messages: { ...messages, scalePercent } })}
          />
        </>
      ) : null}

      {!placed ? (
        <p className="text-[10px] text-muted-foreground">
          {part === "words"
            ? "The words are where the slide puts them, full screen."
            : part === "slide"
              ? "A presentation's slide fills the screen."
              : part === "media"
              ? "The media fills the screen, letterboxed."
              : part === "props"
                ? "Each prop sits where it was put up."
                : part === "timer"
                  ? "The clock sits where Settings puts it."
                  : "Banners run along the edge they were sent to."}
        </p>
      ) : null}
    </div>
  );
}

function BoxFields({ area, onChange }: { area: LookBox; onChange: (area: LookBox) => void }) {
  const set = (patch: Partial<LookBox>) => onChange(keptOnScreen({ ...area, ...patch }));
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      <RangeField label="Across" value={area.xPercent} min={0} max={100} onChange={(xPercent) => set({ xPercent })} />
      <RangeField label="Down" value={area.yPercent} min={0} max={100} onChange={(yPercent) => set({ yPercent })} />
      <RangeField label="Width" value={area.widthPercent} min={MIN_BOX} max={100} onChange={(widthPercent) => set({ widthPercent })} />
      <RangeField label="Height" value={area.heightPercent} min={MIN_BOX} max={100} onChange={(heightPercent) => set({ heightPercent })} />
    </div>
  );
}

function BackdropField({ value, onChange }: { value?: string; onChange: (value?: string) => void }) {
  const { hex, alpha } = splitColor(value);
  return (
    <div className="space-y-1.5">
      <CheckRow
        label="Backdrop"
        hint="A band of colour behind the words: what makes a lower third."
        checked={Boolean(value)}
        onChange={(on) => onChange(on ? joinColor(hex, alpha) : undefined)}
      />
      {value ? (
        <div className="flex items-center gap-2 pl-5">
          <input
            type="color"
            value={hex}
            onChange={(event) => onChange(joinColor(event.target.value, alpha))}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent"
            aria-label="Backdrop colour"
          />
          <div className="flex-1">
            <RangeField label="Opacity" value={alpha} min={0} max={100} onChange={(next) => onChange(joinColor(hex, next))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const shown = Math.round(clamp(value, min, max));
  return (
    <label className="block space-y-1">
      <div className="flex items-center justify-between text-[11px] text-foreground">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{shown}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={shown}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full accent-primary"
      />
    </label>
  );
}

function CheckRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 accent-primary"
      />
      <span className="space-y-0.5">
        <span className="block text-[11px] text-foreground">{label}</span>
        <span className="block text-[10px] leading-snug text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

function ToggleRow({
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
    <div className="space-y-1">
      <p className="text-[11px] text-foreground">{title}</p>
      <div className="inline-flex flex-wrap rounded-md border border-border bg-muted/20 p-0.5">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => onChange(option.key)}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] transition-colors",
              value === option.key ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
