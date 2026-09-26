"use client";

import { useMemo } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Italic,
  Underline,
} from "lucide-react";
import { BackgroundEditor } from "../../renderer/shared/components/BackgroundEditor";
import { FontFamilySelect } from "../../renderer/shared/components/FontFamilySelect";
import {
  ColorInput,
  FillEditor,
  IconToggle,
  type FillKind,
  NumberInput,
  Segmented,
  SelectInput,
  SliderInput,
  StyleRow,
  StyleSection,
} from "../../renderer/shared/components/style-controls";
import {
  getFontWeightOptionsForFamily,
  useFontCatalog,
} from "../../renderer/shared/hooks/useFontCatalog";
import {
  SHADOW_PRESETS,
  layoutFrames,
  layoutOf,
  type ThemeFrame,
  type ThemeLayout,
  type ThemeLook,
  type ThemeText,
} from "./theme-look.mjs";

const GENERIC_WEIGHTS = [
  ["100", "Thin"],
  ["200", "Extra Light"],
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semibold"],
  ["700", "Bold"],
  ["800", "Extra Bold"],
  ["900", "Black"],
] as const;

const CASES: Array<{ value: ThemeText["case"]; label: string }> = [
  { value: "none", label: "As typed" },
  { value: "upper", label: "UPPERCASE" },
  { value: "lower", label: "lowercase" },
  { value: "title", label: "Title Case" },
  { value: "lineStart", label: "First letter of each line" },
];

const LAYOUTS: Array<{ value: ThemeLayout; label: string }> = [
  { value: "full", label: "Full" },
  { value: "lower-third", label: "Lower third" },
  { value: "upper-third", label: "Upper third" },
  { value: "card", label: "Card" },
];

/** The weights a family has, with the look's own kept even if it lacks it. */
function useWeightOptions(family: string, current: string) {
  const { faces } = useFontCatalog();
  return useMemo(() => {
    const own = getFontWeightOptionsForFamily(faces, family).map((option) => ({
      value: option.value,
      label: option.label.replace(/\s*\d+$/, "") || option.value,
    }));
    const list = own.length > 1 ? own : GENERIC_WEIGHTS.map(([value, label]) => ({ value, label }));
    return list.some((option) => option.value === current)
      ? list
      : [...list, { value: current, label: current }].sort((a, b) => Number(a.value) - Number(b.value));
  }, [current, faces, family]);
}

/** Four numbers for a frame: where it starts and how big it is, in percent. */
function FrameFields({
  frame,
  onChange,
  disabled,
  label,
}: {
  frame: ThemeFrame;
  onChange: (frame: ThemeFrame) => void;
  disabled?: boolean;
  label: string;
}) {
  const fields: Array<{ key: keyof ThemeFrame; name: string; min: number }> = [
    { key: "x", name: "X", min: -20 },
    { key: "y", name: "Y", min: -20 },
    { key: "width", name: "W", min: 4 },
    { key: "height", name: "H", min: 4 },
  ];
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {fields.map((field) => (
        <label key={field.key} className="flex flex-col gap-0.5">
          <span className="text-[9px] font-semibold uppercase text-muted-foreground">{field.name}</span>
          <NumberInput
            value={Math.round(frame[field.key] * 1000) / 10}
            min={field.min}
            max={field.key === "x" || field.key === "y" ? 96 : 100}
            step={0.5}
            suffix="%"
            label={`${label} ${field.name}`}
            disabled={disabled}
            onChange={(percent) => onChange({ ...frame, [field.key]: percent / 100 })}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Everything a theme is made of, to change: the words, their colour,
 * spacing, shadow and outline, the box behind them, and the background.
 * Where they sit is also on the canvas, to drag.
 */
export function ThemeInspector({
  look,
  onChange,
  disabled,
  canGradient,
}: {
  look: ThemeLook;
  onChange: (look: ThemeLook) => void;
  /** Why it can't be changed, if it can't. */
  disabled: boolean;
  canGradient: boolean;
}) {
  const { text } = look;
  const setText = (patch: Partial<ThemeText>) => onChange({ ...look, text: { ...text, ...patch } });
  const weights = useWeightOptions(text.fontFamily, text.fontWeight);
  const layout = layoutOf(look.frame);
  const power = canGradient ? null : "Power";
  const lockedFills: FillKind[] = canGradient ? [] : ["gradient", "mix"];

  const chooseLayout = (next: ThemeLayout) => {
    const frames = layoutFrames(next);
    const box =
      next === "full"
        ? look.box
          ? { ...look.box, frame: frames.box }
          : null
        : {
            frame: frames.box,
            radius: next === "card" ? look.box?.radius || 36 : look.box?.radius ?? 0,
            fill:
              look.box?.fill ??
              (next === "card"
                ? { kind: "color" as const, color: "rgba(255,255,255,0.92)" }
                : { kind: "color" as const, color: "rgba(0,0,0,0.62)" }),
          };
    onChange({ ...look, frame: frames.frame, box });
  };

  return (
    <fieldset disabled={disabled} className="min-w-0 disabled:opacity-60">
      <StyleSection title="Layout">
        <Segmented
          value={layout ?? ""}
          label="Layout"
          onChange={(value) => chooseLayout(value as ThemeLayout)}
          options={LAYOUTS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <FrameFields frame={look.frame} label="Words" onChange={(frame) => onChange({ ...look, frame })} />
        <p className="text-[10px] leading-4 text-muted-foreground">
          Drag the words and the box on the slide to place them. Alt drags without snapping.
        </p>
      </StyleSection>

      <StyleSection title="Words">
        <FontFamilySelect value={text.fontFamily} onChange={(fontFamily) => setText({ fontFamily })} className="[&>button]:h-8 [&>button]:text-[12px]" />
        <div className="flex gap-1.5">
          <SelectInput
            label="Weight"
            value={text.fontWeight}
            options={weights}
            onChange={(fontWeight) => setText({ fontWeight })}
          />
          <NumberInput
            value={text.fontSize}
            min={12}
            max={300}
            suffix="px"
            label="Size"
            onChange={(fontSize) => setText({ fontSize })}
            className="w-[76px] flex-none"
          />
        </div>
        <div className="flex gap-1.5">
          <IconToggle pressed={text.italic} onChange={(italic) => setText({ italic })} label="Italic">
            <Italic className="h-3.5 w-3.5" />
          </IconToggle>
          <IconToggle pressed={text.underline} onChange={(underline) => setText({ underline })} label="Underline">
            <Underline className="h-3.5 w-3.5" />
          </IconToggle>
          <SelectInput
            label="Letter case"
            value={text.case}
            options={CASES}
            onChange={(value) => setText({ case: value as ThemeText["case"] })}
          />
        </div>
        <div className="flex gap-1.5">
          <Segmented
            value={text.align}
            label="Alignment"
            onChange={(align) => setText({ align: align as ThemeText["align"] })}
            options={[
              { value: "left", label: <AlignLeft className="h-3.5 w-3.5" />, title: "Left" },
              { value: "center", label: <AlignCenter className="h-3.5 w-3.5" />, title: "Centre" },
              { value: "right", label: <AlignRight className="h-3.5 w-3.5" />, title: "Right" },
            ]}
          />
          <Segmented
            value={text.verticalAlign}
            label="Vertical position"
            onChange={(verticalAlign) => setText({ verticalAlign: verticalAlign as ThemeText["verticalAlign"] })}
            options={[
              { value: "top", label: <AlignVerticalJustifyStart className="h-3.5 w-3.5" />, title: "Top" },
              { value: "middle", label: <AlignVerticalJustifyCenter className="h-3.5 w-3.5" />, title: "Middle" },
              { value: "bottom", label: <AlignVerticalJustifyEnd className="h-3.5 w-3.5" />, title: "Bottom" },
            ]}
          />
        </div>
      </StyleSection>

      <StyleSection title="Colour" badge={text.gradient && !canGradient ? "Power" : null}>
        <Segmented
          value={text.gradient ? "gradient" : "solid"}
          label="Colour"
          onChange={(value) =>
            setText(
              value === "gradient"
                ? { gradient: { from: text.color, to: "#9ca3af", angle: 135 } }
                : { gradient: null, color: text.gradient?.from ?? text.color },
            )
          }
          options={[
            { value: "solid", label: "Solid" },
            { value: "gradient", label: "Gradient", disabled: !canGradient, title: power ? "Gradients come with Power" : undefined },
          ]}
        />
        {text.gradient ? (
          <>
            <div className="flex gap-1.5">
              <ColorInput label="Gradient start" value={text.gradient.from} onChange={(from) => text.gradient && setText({ gradient: { ...text.gradient, from } })} />
              <ColorInput label="Gradient end" value={text.gradient.to} onChange={(to) => text.gradient && setText({ gradient: { ...text.gradient, to } })} />
            </div>
            <StyleRow label="Angle">
              <SliderInput
                value={text.gradient.angle}
                min={0}
                max={360}
                suffix="°"
                label="Gradient angle"
                onChange={(angle) => text.gradient && setText({ gradient: { ...text.gradient, angle } })}
              />
            </StyleRow>
          </>
        ) : (
          <ColorInput label="Words colour" value={text.color} onChange={(color) => setText({ color })} />
        )}
        <StyleRow label="Opacity">
          <SliderInput
            value={Math.round(text.opacity * 100)}
            min={10}
            max={100}
            suffix="%"
            label="Opacity"
            onChange={(percent) => setText({ opacity: percent / 100 })}
          />
        </StyleRow>
      </StyleSection>

      <StyleSection title="Spacing">
        <StyleRow label="Letters">
          <SliderInput value={text.letterSpacing} min={-10} max={40} step={0.5} suffix="px" label="Letter spacing" onChange={(letterSpacing) => setText({ letterSpacing })} />
        </StyleRow>
        <StyleRow label="Lines">
          <SliderInput value={text.lineHeight} min={0.7} max={2.5} step={0.05} suffix="×" label="Line height" onChange={(lineHeight) => setText({ lineHeight })} />
        </StyleRow>
      </StyleSection>

      <StyleSection
        title="Shadow"
        enabled={Boolean(text.shadow)}
        onEnabledChange={(on) => setText({ shadow: on ? { ...SHADOW_PRESETS.soft } : null })}
      >
        {text.shadow ? (
          <>
            <div className="flex gap-1.5">
              {(Object.keys(SHADOW_PRESETS) as Array<keyof typeof SHADOW_PRESETS>).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setText({ shadow: { ...SHADOW_PRESETS[name] } })}
                  className="h-7 flex-1 rounded-md border border-border bg-background/40 text-[11px] capitalize text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  {name}
                </button>
              ))}
            </div>
            <StyleRow label="Colour">
              <ColorInput label="Shadow colour" alpha value={text.shadow.color} onChange={(color) => text.shadow && setText({ shadow: { ...text.shadow, color } })} />
            </StyleRow>
            <StyleRow label="Blur">
              <SliderInput value={text.shadow.blur} min={0} max={80} suffix="px" label="Shadow blur" onChange={(blur) => text.shadow && setText({ shadow: { ...text.shadow, blur } })} />
            </StyleRow>
            <StyleRow label="Offset">
              <NumberInput value={text.shadow.x} min={-60} max={60} suffix="x" label="Shadow across" onChange={(x) => text.shadow && setText({ shadow: { ...text.shadow, x } })} className="flex-1" />
              <NumberInput value={text.shadow.y} min={-60} max={60} suffix="y" label="Shadow down" onChange={(y) => text.shadow && setText({ shadow: { ...text.shadow, y } })} className="flex-1" />
            </StyleRow>
          </>
        ) : null}
      </StyleSection>

      <StyleSection
        title="Outline"
        enabled={Boolean(text.outline)}
        onEnabledChange={(on) => setText({ outline: on ? { color: "#000000", width: 4 } : null })}
      >
        {text.outline ? (
          <>
            <StyleRow label="Colour">
              <ColorInput label="Outline colour" alpha value={text.outline.color} onChange={(color) => text.outline && setText({ outline: { ...text.outline, color } })} />
            </StyleRow>
            <StyleRow label="Width">
              <SliderInput value={text.outline.width} min={0.5} max={30} step={0.5} suffix="px" label="Outline width" onChange={(width) => text.outline && setText({ outline: { ...text.outline, width } })} />
            </StyleRow>
          </>
        ) : null}
      </StyleSection>

      <StyleSection
        title="Box behind the words"
        badge={look.box && look.box.fill.kind !== "color" && !canGradient ? "Power" : null}
        enabled={Boolean(look.box)}
        onEnabledChange={(on) =>
          onChange({
            ...look,
            box: on
              ? {
                  frame: layoutFrames(layout ?? "full").box,
                  fill: { kind: "color", color: "rgba(0,0,0,0.6)" },
                  radius: layout === "card" ? 36 : 0,
                }
              : null,
          })
        }
      >
        {look.box ? (
          <>
            <FillEditor
              label="Box"
              value={look.box.fill}
              lockedKinds={lockedFills}
              lockedLabel="Gradients and mixes come with Power"
              onChange={(fill) => look.box && fill && onChange({ ...look, box: { ...look.box, fill } })}
            />
            <StyleRow label="Corners">
              <SliderInput value={look.box.radius} min={0} max={200} suffix="px" label="Corner radius" onChange={(radius) => look.box && onChange({ ...look, box: { ...look.box, radius } })} />
            </StyleRow>
            <FrameFields frame={look.box.frame} label="Box" onChange={(frame) => look.box && onChange({ ...look, box: { ...look.box, frame } })} />
          </>
        ) : null}
      </StyleSection>

      <StyleSection
        title="Background"
        badge={(look.background?.kind === "gradient" || look.background?.kind === "mix") && !canGradient ? "Power" : null}
      >
        <BackgroundEditor
          label="Background"
          value={look.background}
          noneLabel="Clear"
          lockedKinds={lockedFills}
          lockedLabel="Gradients and mixes come with Power"
          onChange={(background) => onChange({ ...look, background })}
        />
        <p className="text-[10px] leading-4 text-muted-foreground">
          {look.background?.kind === "media"
            ? `${look.background.name} plays behind the slide while it is live. Another computer shows it if its media library has a file of the same name.`
            : look.background
              ? "It covers any video or image behind the slide."
              : "Clear: your video, image or camera shows behind the words."}
        </p>
      </StyleSection>
    </fieldset>
  );
}
