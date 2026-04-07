"use client";

import { memo } from "react";
import { cn } from "../../../renderer/shared/lib/utils";

interface EditorHeaderProps {
  editorView: "slides" | "source";
  setEditorView: (view: "slides" | "source") => void;
  handleFix: () => void;
  isFixing: boolean;
  handleManualSave: () => void;
  isSaving: boolean;
}

export const EditorHeader = memo(function EditorHeader({
  editorView,
  setEditorView,
  handleFix,
  isFixing,
  handleManualSave,
  isSaving,
}: EditorHeaderProps) {
  return (
    <div className="border-b border-border bg-card/50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-muted/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.26em] text-muted-foreground">
            Editor
          </span>
          <div className="flex rounded-full border border-border bg-background/50 p-1">
            <button
              type="button"
              onClick={() => setEditorView("slides")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                editorView === "slides"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Slide
            </button>
            <button
              type="button"
              onClick={() => setEditorView("source")}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                editorView === "source"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Source
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFix}
            disabled={isFixing}
            className="rounded-full border border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {isFixing ? "Cleaning..." : "Clean text"}
          </button>
          <button
            type="button"
            onClick={handleManualSave}
            disabled={isSaving}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
});
