"use client";

import { ScriptureTextLayer } from "../../../renderer/shared/components/ScriptureTextLayer";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";
import { ScriptureLayoutControls } from "./ScriptureLayoutControls";

interface ScriptureLayoutEditorProps {
  text?: string | null;
  footer?: string | null;
  scriptureFontFamily: string;
  scriptureFontSize: number;
  scriptureTextAlign: ScriptureTextAlign;
  scriptureVerticalAlign: ScriptureVerticalAlign;
  scriptureFooterAlign: ScriptureTextAlign;
  scriptureFooterPosition: ScriptureFooterPosition;
  onScriptureFontSizeChange: (value: number) => void;
  onScriptureTextAlignChange: (value: ScriptureTextAlign) => void;
  onScriptureVerticalAlignChange: (value: ScriptureVerticalAlign) => void;
  onScriptureFooterAlignChange: (value: ScriptureTextAlign) => void;
  onScriptureFooterPositionChange: (value: ScriptureFooterPosition) => void;
}

const DEFAULT_PREVIEW_TEXT =
  "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
const DEFAULT_PREVIEW_FOOTER = "John 3:16 (KJV)";

export function ScriptureLayoutEditor({
  text,
  footer,
  scriptureFontFamily,
  scriptureFontSize,
  scriptureTextAlign,
  scriptureVerticalAlign,
  scriptureFooterAlign,
  scriptureFooterPosition,
  onScriptureFontSizeChange,
  onScriptureTextAlignChange,
  onScriptureVerticalAlignChange,
  onScriptureFooterAlignChange,
  onScriptureFooterPositionChange,
}: ScriptureLayoutEditorProps) {
  const previewText = text?.trim() || DEFAULT_PREVIEW_TEXT;
  const previewFooter = footer?.trim() || DEFAULT_PREVIEW_FOOTER;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="border-b border-border px-4 py-3 bg-card/20">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground/60">
          Scripture layout editor
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card/40 p-4 scrollbar-hide">
          <ScriptureLayoutControls
            fontSize={scriptureFontSize}
            onFontSizeChange={onScriptureFontSizeChange}
            textAlign={scriptureTextAlign}
            onTextAlignChange={onScriptureTextAlignChange}
            verticalAlign={scriptureVerticalAlign}
            onVerticalAlignChange={onScriptureVerticalAlignChange}
            footerAlign={scriptureFooterAlign}
            onFooterAlignChange={onScriptureFooterAlignChange}
            footerPosition={scriptureFooterPosition}
            onFooterPositionChange={onScriptureFooterPositionChange}
          />
        </div>

        <div className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card/30 p-4">
          <div className="mx-auto flex h-full max-w-5xl flex-col gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/55">
              Live preview
            </p>
            <div className="relative aspect-video min-h-[240px] overflow-hidden rounded-xl border border-border/60 bg-black shadow-lg shadow-black/20">
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/35 to-black/60" />
              <ScriptureTextLayer
                text={previewText}
                footer={previewFooter}
                fontFamily={scriptureFontFamily}
                fontSize={scriptureFontSize}
                textAlign={scriptureTextAlign}
                verticalAlign={scriptureVerticalAlign}
                footerAlign={scriptureFooterAlign}
                footerPosition={scriptureFooterPosition}
                maxFontSize={scriptureFontSize}
                minScale={0.3}
                containerClassName="absolute inset-0 z-10 flex flex-col p-8"
                bodyClassName="min-h-0 w-full flex-1"
                textClassName="pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
                footerClassName="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/90 drop-shadow-md"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
