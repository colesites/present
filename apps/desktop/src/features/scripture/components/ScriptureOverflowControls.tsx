"use client";

import {
  NumberInput,
  Segmented,
  SelectInput,
  StyleRow,
  StyleSection,
} from "../../../renderer/shared/components/style-controls";
import type { SlideElement } from "../../../shared/types";
import { measureWords } from "../lib/measure-words";
import {
  fitsAt,
  type ScriptureOverflowMode,
  type ScriptureSplitBy,
} from "../lib/overflow";
import { useScriptureOverflowStore } from "../lib/overflow-state";

export const MODE_OPTIONS: Array<{ value: ScriptureOverflowMode; label: string }> = [
  { value: "smart", label: "Shrink, then split" },
  { value: "shrink", label: "Shrink to fit" },
  { value: "split", label: "Split into slides" },
  { value: "fit", label: "Fill the box" },
  { value: "fixed", label: "Fixed size" },
];

export const MODE_NOTES: Record<ScriptureOverflowMode, string> = {
  smart: "A long verse shrinks to the smallest size below, then carries on over more slides.",
  shrink: "A long verse shrinks as far as it needs to. It is never split.",
  split: "A verse stays at its size and carries on over as many slides as it needs.",
  fit: "Every verse fills the box: short ones grow, long ones shrink.",
  fixed: "Every verse is set at its size, whatever its length.",
};

export const SPLIT_OPTIONS: Array<{ value: ScriptureSplitBy; label: string }> = [
  { value: "sentence", label: "Sentence" },
  { value: "words", label: "Words" },
  { value: "lines", label: "Lines" },
];

/**
 * "Long verses", in Bible edit: what becomes of a verse too long for its
 * slide (`scripture/lib/overflow.ts`). Changed here, the verses up now are
 * split again at once.
 */
export function ScriptureOverflowControls({
  verseElement,
}: {
  /** The verse box of the slide selected, to say whether its verse fits. */
  verseElement?: SlideElement | null;
}) {
  const overflow = useScriptureOverflowStore((state) => state.overflow);
  const setOverflow = useScriptureOverflowStore((state) => state.setOverflow);
  const splits = overflow.mode === "smart" || overflow.mode === "split";

  const overflows =
    overflow.mode === "fixed" && verseElement
      ? !fitsAt(
          verseElement.content,
          verseElement.style?.fontSize ?? 72,
          {
            width: Math.max(1, verseElement.width - (verseElement.style?.paddingLeft ?? 0) - (verseElement.style?.paddingRight ?? 0)),
            height: Math.max(1, verseElement.height - (verseElement.style?.paddingTop ?? 0) - (verseElement.style?.paddingBottom ?? 0)),
            lineHeight: verseElement.style?.lineHeight ?? 1.2,
          },
          (text, fontSize) =>
            measureWords(text, fontSize, {
              family: verseElement.style?.fontFamily ?? "Inter",
              weight: String(verseElement.style?.fontWeight ?? "400"),
            }),
        )
      : false;

  return (
    <StyleSection title="Long verses">
      <StyleRow label="Too long">
        <SelectInput
          label="When a verse is too long"
          value={overflow.mode}
          options={MODE_OPTIONS}
          onChange={(mode) => setOverflow({ mode: mode as ScriptureOverflowMode })}
        />
      </StyleRow>
      {overflow.mode === "smart" ? (
        <StyleRow label="Smallest">
          <NumberInput
            label="Smallest verse size"
            value={overflow.minFontSize}
            min={12}
            max={400}
            suffix="px"
            onChange={(minFontSize) => setOverflow({ minFontSize })}
          />
        </StyleRow>
      ) : null}
      {splits ? (
        <StyleRow label="Split at">
          <Segmented
            label="Split a verse at"
            value={overflow.splitBy}
            options={SPLIT_OPTIONS}
            onChange={(splitBy) => setOverflow({ splitBy: splitBy as ScriptureSplitBy })}
          />
        </StyleRow>
      ) : null}
      {splits && overflow.splitBy === "lines" ? (
        <StyleRow label="Lines">
          <NumberInput
            label="Most lines on a slide"
            value={overflow.maxLines}
            min={1}
            max={20}
            onChange={(maxLines) => setOverflow({ maxLines })}
          />
        </StyleRow>
      ) : null}
      <StyleRow label="Reference">
        <Segmented
          label="Room for the reference"
          value={overflow.compactFooter ? "compact" : "roomy"}
          options={[
            { value: "compact", label: "Compact" },
            { value: "roomy", label: "Roomy" },
          ]}
          onChange={(value) => setOverflow({ compactFooter: value === "compact" })}
        />
      </StyleRow>
      <p className="text-[10px] leading-4 text-muted-foreground">{MODE_NOTES[overflow.mode]}</p>
      {overflows ? (
        <p className="text-[10px] leading-4 text-destructive">
          This verse does not fit at its size: its last words are cut off.
        </p>
      ) : null}
    </StyleSection>
  );
}
