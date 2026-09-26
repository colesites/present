"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import type { SlideFill } from "../../../shared/types";
import { MediaPicker } from "./MediaPicker";
import { FillEditor, MIX_PRESETS, Segmented, type FillKind } from "./style-controls";

/** An image or video from the media library, as a background. */
export type MediaBackground = {
  kind: "media";
  mediaId: string;
  name: string;
  mediaType: "image" | "video";
};

export type Background = SlideFill | MediaBackground;

type BackgroundKind = FillKind | "media";

const NAMES: Record<Exclude<BackgroundKind, "none">, string> = {
  color: "Colour",
  gradient: "Gradient",
  mix: "Mix",
  media: "Media",
};

/**
 * A slide's or a theme's background: none, a colour, a gradient, a mix, or
 * an image or video from the media library, which plays behind the slide
 * while it is live. Choosing "Media" opens the library; nothing changes until
 * something in it is chosen.
 */
export function BackgroundEditor({
  value,
  onChange,
  noneLabel = "Clear",
  lockedKinds = [],
  lockedLabel,
  disabled,
  label,
}: {
  value: Background | null;
  onChange: (value: Background | null) => void;
  noneLabel?: string;
  lockedKinds?: FillKind[];
  lockedLabel?: string;
  disabled?: boolean;
  label: string;
}) {
  const [pickingMedia, setPickingMedia] = useState(false);
  const kind: BackgroundKind = value?.kind ?? "none";
  const shownKind: BackgroundKind = pickingMedia ? "media" : kind;
  const base =
    value?.kind === "color"
      ? value.color
      : value?.kind === "gradient"
        ? value.from
        : value?.kind === "mix"
          ? value.base
          : "#111827";

  const choose = (next: BackgroundKind) => {
    setPickingMedia(next === "media" && kind !== "media");
    if (next === kind || next === "media") return;
    if (next === "none") onChange(null);
    else if (next === "color") onChange({ kind: "color", color: base });
    else if (next === "gradient") onChange({ kind: "gradient", from: base, to: "#0e5e6f", angle: 90 });
    else onChange(MIX_PRESETS[0].fill);
  };

  const kinds: BackgroundKind[] = ["none", "color", "gradient", "mix", "media"];
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        value={shownKind}
        label={label}
        disabled={disabled}
        onChange={(next) => choose(next as BackgroundKind)}
        options={kinds.map((option) => {
          const locked = option !== "media" && lockedKinds.includes(option);
          const name = option === "none" ? noneLabel : NAMES[option];
          return {
            value: option,
            label: locked ? (
              <>
                <Lock className="h-2.5 w-2.5" /> {name}
              </>
            ) : (
              name
            ),
            disabled: locked,
            title: locked ? lockedLabel : option === "media" ? "An image or video from the media library" : undefined,
          };
        })}
      />
      {shownKind === "media" ? (
        <MediaPicker
          value={value?.kind === "media" ? value.mediaId : null}
          disabled={disabled}
          onChoose={(item) => {
            setPickingMedia(false);
            onChange({ kind: "media", mediaId: item.id, name: item.name, mediaType: item.type });
          }}
        />
      ) : value && value.kind !== "media" ? (
        <FillEditor label={label} value={value} hideKindPicker disabled={disabled} onChange={onChange} />
      ) : null}
    </div>
  );
}
