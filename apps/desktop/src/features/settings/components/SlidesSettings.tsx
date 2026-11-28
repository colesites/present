"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { FontFamilySelect } from "../../../renderer/shared/components";
import { MediaPicker } from "../../../renderer/shared/components/MediaPicker";
import {
  getFontWeightOptionsForFamily,
  resolveFontWeightForFamily,
  useFontCatalog,
} from "../../../renderer/shared/hooks/useFontCatalog";
import { VideoThumbnail } from "../../media/components/VideoThumbnail";
import {
  MODE_NOTES,
  MODE_OPTIONS,
  SPLIT_OPTIONS,
} from "../../scripture/components/ScriptureOverflowControls";
import type { ScriptureOverflowMode, ScriptureSplitBy } from "../../scripture/lib/overflow";
import { useScriptureOverflowStore } from "../../scripture/lib/overflow-state";
import type { MediaItem } from "../../media/hooks/useMediaFolders";
import {
  SETTINGS_FIELD,
  SettingsBlock,
  SettingsButton,
  SettingsGroup,
  SettingsNumber,
  SettingsPage,
  SettingsRow,
  SettingsSelect,
  SettingsSwitch,
} from "./settings-ui";

/**
 * What becomes of a verse too long for its slide (`scripture/lib/overflow.ts`):
 * the same setting as Bible edit's "Long verses", here for every passage.
 */
function LongVerses() {
  const overflow = useScriptureOverflowStore((state) => state.overflow);
  const setOverflow = useScriptureOverflowStore((state) => state.setOverflow);
  const splits = overflow.mode === "smart" || overflow.mode === "split";
  return (
    <SettingsGroup title="Long verses" description={MODE_NOTES[overflow.mode]}>
      <SettingsRow label="When a verse is too long">
        <SettingsSelect
          label="When a verse is too long"
          value={overflow.mode}
          options={MODE_OPTIONS}
          onChange={(mode) => setOverflow({ mode: mode as ScriptureOverflowMode })}
        />
      </SettingsRow>
      {overflow.mode === "smart" ? (
        <SettingsRow label="Smallest size" description="A verse shrinks this far, then carries on over more slides.">
          <SettingsNumber
            label="Smallest verse size"
            value={overflow.minFontSize}
            onChange={(minFontSize) => setOverflow({ minFontSize })}
            min={12}
            max={400}
            suffix="px"
          />
        </SettingsRow>
      ) : null}
      {splits ? (
        <SettingsRow label="Split at" description="Where a verse carries on to the next slide.">
          <SettingsSelect
            label="Split a verse at"
            value={overflow.splitBy}
            options={SPLIT_OPTIONS.map((option) => ({
              ...option,
              label:
                option.value === "sentence"
                  ? "Sentences and clauses"
                  : option.value === "words"
                    ? "Evenly, by words"
                    : "A number of lines",
            }))}
            onChange={(splitBy) => setOverflow({ splitBy: splitBy as ScriptureSplitBy })}
          />
        </SettingsRow>
      ) : null}
      {splits && overflow.splitBy === "lines" ? (
        <SettingsRow label="Lines on a slide">
          <SettingsNumber
            label="Most lines on a slide"
            value={overflow.maxLines}
            onChange={(maxLines) => setOverflow({ maxLines })}
            min={1}
            max={20}
          />
        </SettingsRow>
      ) : null}
      <SettingsRow
        label="Compact reference"
        description="The reference takes only the room it needs, not three tenths of the slide."
      >
        <SettingsSwitch
          label="Compact reference"
          checked={overflow.compactFooter}
          onChange={(compactFooter) => setOverflow({ compactFooter })}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

/** How much of the preview's height a 1080-line screen's pixel is. */
const PREVIEW_HEIGHT = 117;

/**
 * A slide in miniature, set in the chosen font at the chosen size, so the
 * choice can be seen rather than imagined.
 */
function TypePreview({
  fontFamily,
  fontWeight,
  fontSize,
  lines,
  footer,
  footerSize,
  background,
}: {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
  lines: string[];
  footer?: string;
  footerSize?: number;
  background?: MediaItem | null;
}) {
  const scale = PREVIEW_HEIGHT / 1080;
  return (
    <div
      className="relative flex aspect-video w-[208px] flex-none flex-col items-center justify-center overflow-hidden rounded-lg bg-black px-3 text-center text-white shadow-inner ring-1 ring-white/10"
      style={{ fontFamily: `"${fontFamily}", Inter, sans-serif`, fontWeight: Number(fontWeight) || 400 }}
    >
      {background ? (
        <div className="absolute inset-0 opacity-70">
          <BackgroundThumbnail item={background} />
        </div>
      ) : null}
      <div className="relative" style={{ fontSize: Math.max(5, fontSize * scale), lineHeight: 1.2 }}>
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      {footer ? (
        <div
          className="relative mt-1.5 uppercase tracking-wide text-white/80"
          style={{ fontSize: Math.max(4, (footerSize ?? 40) * scale) }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}

function BackgroundThumbnail({ item }: { item: MediaItem }) {
  return item.type === "video" ? (
    <VideoThumbnail path={item.path} lastModified={item.lastModified} name={item.name} fit="cover" />
  ) : (
    <img src={item.url} alt="" draggable={false} className="h-full w-full object-cover" />
  );
}

/** A family, its weight and size, beside a preview of them. */
function TypeGroup({
  title,
  description,
  fontFamily,
  onFontFamilyChange,
  fontWeight,
  onFontWeightChange,
  fontSize,
  onFontSizeChange,
  minSize,
  preview,
  children,
}: {
  title: string;
  description: string;
  fontFamily: string;
  onFontFamilyChange: (family: string) => void;
  fontWeight: string;
  onFontWeightChange: (weight: string) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  minSize: number;
  preview: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { faces } = useFontCatalog();
  const weights = useMemo(() => getFontWeightOptionsForFamily(faces, fontFamily), [faces, fontFamily]);
  const resolved = useMemo(
    () => resolveFontWeightForFamily(faces, fontFamily, fontWeight),
    [faces, fontFamily, fontWeight],
  );
  // A family without the weight asked for takes its nearest, and the setting
  // says so, rather than naming a weight the text is not drawn in.
  useEffect(() => {
    if (resolved !== fontWeight) onFontWeightChange(resolved);
  }, [fontWeight, onFontWeightChange, resolved]);

  return (
    <SettingsGroup title={title} description={description}>
      <div className="flex">
        <div className="flex flex-none items-center border-r border-border/60 p-4">{preview}</div>
        <div className="min-w-0 flex-1 divide-y divide-border/60">
          <SettingsRow label="Font" className="min-h-[52px]">
            <FontFamilySelect
              value={fontFamily}
              onChange={onFontFamilyChange}
              className="w-[200px]"
              triggerClassName={SETTINGS_FIELD}
            />
          </SettingsRow>
          <SettingsRow label="Weight" className="min-h-[52px]">
            <SettingsSelect
              label={`${title} weight`}
              value={resolved}
              onChange={onFontWeightChange}
              className="w-[200px]"
              options={weights.length > 0 ? weights : [{ value: resolved, label: resolved }]}
            />
          </SettingsRow>
          <SettingsRow label="Size" className="min-h-[52px]">
            <SettingsNumber
              label={`${title} size`}
              value={fontSize}
              onChange={onFontSizeChange}
              min={minSize}
              max={400}
              suffix="px"
            />
          </SettingsRow>
          {children}
        </div>
      </div>
    </SettingsGroup>
  );
}

export function SlidesSettings({
  libraryFontFamily,
  onLibraryFontFamilyChange,
  libraryFontWeight,
  onLibraryFontWeightChange,
  libraryFontSize,
  onLibraryFontSizeChange,
  scriptureFontFamily,
  onScriptureFontFamilyChange,
  scriptureFontWeight,
  onScriptureFontWeightChange,
  scriptureFontSize,
  onScriptureFontSizeChange,
  scriptureFooterFontSize,
  onScriptureFooterFontSizeChange,
  scriptureBackgroundId,
  onScriptureBackgroundChange,
  allMediaItems,
}: {
  libraryFontFamily: string;
  onLibraryFontFamilyChange: (family: string) => void;
  libraryFontWeight: string;
  onLibraryFontWeightChange: (weight: string) => void;
  libraryFontSize: number;
  onLibraryFontSizeChange: (size: number) => void;
  scriptureFontFamily: string;
  onScriptureFontFamilyChange: (family: string) => void;
  scriptureFontWeight: string;
  onScriptureFontWeightChange: (weight: string) => void;
  scriptureFontSize: number;
  onScriptureFontSizeChange: (size: number) => void;
  scriptureFooterFontSize: number;
  onScriptureFooterFontSizeChange: (size: number) => void;
  scriptureBackgroundId: string | null;
  /** `null` for whatever media is on screen. */
  onScriptureBackgroundChange: (item: MediaItem | null) => void;
  allMediaItems: MediaItem[];
}) {
  const [choosing, setChoosing] = useState(false);
  const background = scriptureBackgroundId
    ? allMediaItems.find((item) => item.id === scriptureBackgroundId) ?? null
    : null;

  return (
    <SettingsPage
      title="Slides"
      description="How new song and Bible slides look. A change made to a slide in the editor stays as it is."
    >
      <TypeGroup
        title="Songs"
        description="New songs, and the slides made from their lyrics."
        fontFamily={libraryFontFamily}
        onFontFamilyChange={onLibraryFontFamilyChange}
        fontWeight={libraryFontWeight}
        onFontWeightChange={onLibraryFontWeightChange}
        fontSize={libraryFontSize}
        onFontSizeChange={onLibraryFontSizeChange}
        minSize={24}
        preview={
          <TypePreview
            fontFamily={libraryFontFamily}
            fontWeight={libraryFontWeight}
            fontSize={libraryFontSize}
            lines={["Amazing grace, how sweet", "the sound"]}
          />
        }
      />

      <TypeGroup
        title="Bible"
        description="Every passage shown from the Bible tab."
        fontFamily={scriptureFontFamily}
        onFontFamilyChange={onScriptureFontFamilyChange}
        fontWeight={scriptureFontWeight}
        onFontWeightChange={onScriptureFontWeightChange}
        fontSize={scriptureFontSize}
        onFontSizeChange={onScriptureFontSizeChange}
        minSize={12}
        preview={
          <TypePreview
            fontFamily={scriptureFontFamily}
            fontWeight={scriptureFontWeight}
            fontSize={scriptureFontSize}
            lines={["For God so loved the world"]}
            footer="John 3:16"
            footerSize={scriptureFooterFontSize}
            background={background}
          />
        }
      >
        <SettingsRow label="Reference" description="The size of the book, chapter and verse." className="min-h-[52px]">
          <SettingsNumber
            label="Reference size"
            value={scriptureFooterFontSize}
            onChange={onScriptureFooterFontSizeChange}
            min={8}
            max={400}
            suffix="px"
          />
        </SettingsRow>
      </TypeGroup>

      <LongVerses />

      <SettingsGroup
        title="Bible background"
        description="What is behind a passage. Without one, it goes over whatever media is on screen."
      >
        <SettingsRow
          label={
            <span className="flex items-center gap-3">
              <span className="relative flex aspect-video w-[72px] flex-none items-center justify-center overflow-hidden rounded-md bg-black ring-1 ring-white/10">
                {background ? (
                  <BackgroundThumbnail item={background} />
                ) : (
                  <ImageOff className="h-4 w-4 text-white/35" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{background ? background.name : "The media on screen"}</span>
                <span className="block text-[12px] font-normal text-muted-foreground">
                  {background
                    ? background.type === "video"
                      ? "Video"
                      : "Image"
                    : scriptureBackgroundId
                      ? "Not in the media library on this computer"
                      : "No background of its own"}
                </span>
              </span>
            </span>
          }
        >
          {scriptureBackgroundId ? (
            <SettingsButton variant="ghost" onClick={() => onScriptureBackgroundChange(null)}>
              Remove
            </SettingsButton>
          ) : null}
          <SettingsButton onClick={() => setChoosing((open) => !open)}>
            {choosing ? "Done" : background ? "Change" : "Choose"}
          </SettingsButton>
        </SettingsRow>
        {choosing ? (
          <SettingsBlock className="bg-background/30">
            <MediaPicker
              value={scriptureBackgroundId}
              onChoose={(item) => {
                onScriptureBackgroundChange(item);
                setChoosing(false);
              }}
            />
          </SettingsBlock>
        ) : null}
      </SettingsGroup>
    </SettingsPage>
  );
}
