"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../../renderer/shared/lib/utils";
import type { StageLayout, StageObject, StageObjectStyle } from "./layouts";
import { StageSlideView } from "./StageSlideView";
import type { StageFeed, StageWords } from "./useStageFeed";

/**
 * A stage layout drawn at its own size, from what the stage is being sent.
 * Its parent scales it: a stage screen to its window (`ScreenCanvas`), the
 * editor to its canvas, Multiview to a tile.
 *
 * `sample` shows each object with words of its kind where there are none
 * live, so a layout being made can be seen for what it will be.
 */
export function StageLayoutView({
  layout,
  feed,
  sample = false,
  children,
}: {
  layout: StageLayout;
  feed: StageFeed;
  sample?: boolean;
  /** Drawn over the objects, in the layout's pixels: the editor's handles. */
  children?: ReactNode;
}) {
  const now = useClock();
  return (
    <div
      className="relative overflow-hidden text-white"
      style={{
        width: layout.width,
        height: layout.height,
        backgroundColor: layout.background ?? "var(--present-screen-color, #000)",
      }}
    >
      {layout.objects.map((object) => (
        <div
          key={object.id}
          className="absolute"
          style={{ left: object.x, top: object.y, width: object.width, height: object.height }}
        >
          <StageObjectView object={object} feed={feed} sample={sample} now={now} />
        </div>
      ))}
      {children}
    </div>
  );
}

/** The time, once a second, for every clock on the layout. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);
  return now;
}

export function formatClock(date: Date, hours24: boolean, seconds: boolean): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const secondsText = seconds ? `:${String(date.getSeconds()).padStart(2, "0")}` : "";
  if (hours24) return `${String(hours).padStart(2, "0")}:${minutes}${secondsText}`;
  const hour = ((hours + 11) % 12) + 1;
  return `${hour}:${minutes}${secondsText} ${hours >= 12 ? "PM" : "AM"}`;
}

const SAMPLE_WORDS: Record<"current" | "next", StageWords> = {
  current: {
    text: "Current Slide Text",
    footer: null,
    label: "Verse 1",
    repeat: null,
    instruction: null,
  },
  next: { text: "Next Slide Text", footer: null, label: "Chorus", repeat: "x2", instruction: null },
};

/** The box an object is drawn in: its background, border and corners. */
function boxStyle(style: StageObjectStyle, shape?: StageObject["shape"]): CSSProperties {
  return {
    backgroundColor: style.background ?? undefined,
    border: style.borderColor && style.borderWidth > 0 ? `${style.borderWidth}px solid ${style.borderColor}` : undefined,
    borderRadius: shape === "ellipse" ? "50%" : style.radius,
    padding: style.padding,
  };
}

function StageObjectView({
  object,
  feed,
  sample,
  now,
}: {
  object: StageObject;
  feed: StageFeed;
  sample: boolean;
  now: Date;
}) {
  const style = object.style;
  const caption = object.caption?.replace("{timer}", feed.timer.label ?? (sample ? "Timer" : "Time remaining"));

  const frame = (content: ReactNode, sections?: StageWords) => (
    <div className="relative flex h-full w-full flex-col overflow-hidden" style={boxStyle(style, object.shape)}>
      {sections && (sections.label || sections.repeat) ? (
        <SectionChips words={sections} style={style} compact />
      ) : null}
      <div className="relative min-h-0 flex-1">{content}</div>
      {caption ? <Caption text={caption} /> : null}
    </div>
  );

  switch (object.kind) {
    case "shape":
      return <div className="h-full w-full" style={boxStyle(style, object.shape)} />;
    case "text":
      return frame(<FitText text={object.text ?? ""} style={style} />);
    case "current-text":
    case "next-text": {
      const which = object.kind === "current-text" ? "current" : "next";
      const live = feed[which];
      const words = live.text || live.label || live.repeat || !sample ? live : SAMPLE_WORDS[which];
      return frame(
        <FitText
          text={words.text ?? (which === "current" ? "No slide selected" : "")}
          footer={words.footer}
          style={style}
        />,
        words,
      );
    }
    case "current-slide":
      return (
        <div className="relative h-full w-full overflow-hidden" style={boxStyle(style)}>
          {sample && !feed.slide.slideText && !feed.slide.slideElements?.length ? (
            <FitText text="Current Slide" style={{ ...style, color: "rgba(255,255,255,0.5)" }} />
          ) : (
            <StageSlideView slide={feed.slide} showSections={false} />
          )}
        </div>
      );
    case "section":
    case "next-section": {
      const words = object.kind === "section" ? feed.current : feed.next;
      const shown =
        words.label || words.repeat || !sample ? words : SAMPLE_WORDS[object.kind === "section" ? "current" : "next"];
      return (
        <div className="h-full w-full overflow-hidden" style={boxStyle(style)}>
          <SectionChips words={shown} style={style} />
        </div>
      );
    }
    case "clock":
      return frame(
        <FitText
          text={formatClock(now, object.clock?.hours24 ?? false, object.clock?.seconds ?? true)}
          style={style}
          numeric
        />,
      );
    case "timer": {
      const text = feed.timer.text ?? (sample ? "05:00" : "--:--");
      const timeUp = feed.timer.timeUp;
      return frame(
        <FitText
          text={text}
          style={timeUp ? { ...style, color: timeUp.color } : style}
          numeric
          className={timeUp?.blink ? "present-time-up-blink" : undefined}
        />,
      );
    }
    case "timer-label":
      return frame(<FitText text={feed.timer.label ?? (sample ? "Timer" : "")} style={style} />);
  }
}

/** A small title at the bottom of a box, between two lines. */
function Caption({ text }: { text: string }) {
  return (
    <div className="pointer-events-none mt-2 flex flex-none items-center gap-3 text-[14px] uppercase tracking-[0.12em] text-zinc-400">
      <span className="h-px flex-1 bg-current/40" />
      <span className="truncate">{text}</span>
      <span className="h-px flex-1 bg-current/40" />
    </div>
  );
}

/** Where the song is, as the worship stage showed it: [Chorus] [x2]. */
function SectionChips({ words, style, compact = false }: { words: StageWords; style: StageObjectStyle; compact?: boolean }) {
  if (!words.label && !words.repeat) return null;
  const size = compact ? Math.max(18, Math.round(style.fontSize * 0.5)) : style.fontSize;
  return (
    <div
      className={cn(
        "flex flex-none flex-wrap gap-3 leading-none",
        style.align === "center" ? "justify-center" : style.align === "right" ? "justify-end" : "justify-start",
        compact ? "mb-3" : "h-full content-start",
      )}
      style={{
        fontFamily: `"${style.fontFamily}", Inter, sans-serif`,
        fontWeight: compact ? 700 : Number(style.fontWeight) || 900,
        fontSize: size,
        color: compact ? "#bae6fd" : style.color,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      }}
    >
      {[words.label, words.repeat].filter(Boolean).map((part) => (
        <span
          key={part}
          className={compact ? "" : "rounded-md bg-black/55 ring-2 ring-sky-200/30"}
          style={compact ? undefined : { padding: `${size * 0.2}px ${size * 0.26}px` }}
        >
          [{part}]
        </span>
      ))}
    </div>
  );
}

/**
 * Words in a box, set as the object's style says, and shrunk from its size
 * until they fit when it asks to.
 */
function FitText({
  text,
  footer,
  style,
  numeric = false,
  className,
}: {
  text: string;
  footer?: string | null;
  style: StageObjectStyle;
  numeric?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const words = useRef<HTMLDivElement>(null);

  // Shrunk on the element itself, measuring as it goes: one pass, before
  // the frame is shown, and again when the box changes size. React sets the
  // size the style asks for; this only ever takes it down from there.
  useLayoutEffect(() => {
    const outer = box.current;
    const inner = words.current;
    if (!outer || !inner) return;
    const fit = () => {
      let size = style.fontSize;
      inner.style.fontSize = `${size}px`;
      if (!style.fit) return;
      for (let step = 0; step < 24 && size > 12; step += 1) {
        const overflows = inner.scrollHeight > outer.clientHeight + 1 || inner.scrollWidth > outer.clientWidth + 1;
        if (!overflows) break;
        size = Math.max(12, Math.floor(size * 0.92));
        inner.style.fontSize = `${size}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    return () => observer.disconnect();
  }, [text, footer, style.fit, style.fontSize, style.fontFamily, style.fontWeight, style.uppercase]);

  return (
    <div
      ref={box}
      className="flex h-full w-full overflow-hidden"
      style={{
        alignItems: style.valign === "top" ? "flex-start" : style.valign === "bottom" ? "flex-end" : "center",
        justifyContent: style.align === "left" ? "flex-start" : style.align === "right" ? "flex-end" : "center",
      }}
    >
      <div
        ref={words}
        className={cn("max-w-full whitespace-pre-wrap break-words", numeric && "tabular-nums", className)}
        style={{
          fontFamily: `"${style.fontFamily}", Inter, sans-serif`,
          fontWeight: Number(style.fontWeight) || 400,
          fontSize: style.fontSize,
          lineHeight: 1.12,
          color: style.color,
          textAlign: style.align,
          textTransform: style.uppercase ? "uppercase" : undefined,
        }}
      >
        {text}
        {footer ? (
          <div className="mt-[0.35em] truncate text-[0.4em] opacity-80" style={{ textTransform: "none" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
