"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useDebouncedCallback } from "use-debounce";
import { cn } from "../../renderer/shared/lib/utils";
import {
  breakLyricsIntoChunks,
  fixLyrics,
} from "../../renderer/shared/lib/lyrics";

type MiniLyricsEditorProps = {
  item: MiniLyricsPayload;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
};

function getLyricBlockRange(body: string, slideIndex: number) {
  if (slideIndex < 0) {
    return null;
  }

  const blockPattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  let match: RegExpExecArray | null;
  let currentIndex = 0;

  while ((match = blockPattern.exec(body)) != null) {
    if (currentIndex === slideIndex) {
      return {
        start: match.index,
        end: match.index + match[0].length,
      };
    }
    currentIndex += 1;
  }

  return null;
}

export const MiniLyricsEditor = memo(function MiniLyricsEditor({
  item,
  onClose,
  onSave,
}: MiniLyricsEditorProps) {
  const [body, setBody] = useState(item.body);
  const [lastSavedBody, setLastSavedBody] = useState(item.body);
  const [isSaving, setIsSaving] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle",
  );
  const [linesPerSlide, setLinesPerSlide] = useState(2);
  const saveCounterRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setBody(item.body);
    setLastSavedBody(item.body);
    setSaveState("idle");
  }, [item]);

  useEffect(() => {
    if (item.initialSlideIndex == null) {
      return;
    }

    const textarea = textareaRef.current;
    const range = getLyricBlockRange(item.body, item.initialSlideIndex);
    if (!textarea || !range) {
      return;
    }

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(range.end, range.end);
      const lineCount = item.body.slice(0, range.start).split("\n").length;
      textarea.scrollTop = Math.max(0, (lineCount - 3) * 20);
    });
  }, [item.body, item.initialSlideIndex]);

  const saveBody = useCallback(
    async (nextBody: string) => {
      if (nextBody === lastSavedBody) {
        return;
      }

      const saveId = saveCounterRef.current + 1;
      saveCounterRef.current = saveId;
      setIsSaving(true);
      setSaveState("idle");
      try {
        await onSave(nextBody);
        if (saveCounterRef.current === saveId) {
          setLastSavedBody(nextBody);
          setSaveState("saved");
        }
      } catch {
        if (saveCounterRef.current === saveId) {
          setSaveState("error");
        }
      } finally {
        if (saveCounterRef.current === saveId) {
          setIsSaving(false);
        }
      }
    },
    [lastSavedBody, onSave],
  );

  const debouncedSave = useDebouncedCallback((nextBody: string) => {
    void saveBody(nextBody);
  }, 900);

  const handleBodyChange = (nextBody: string) => {
    setBody(nextBody);
    setSaveState("idle");
    debouncedSave(nextBody);
  };

  const handleManualSave = () => {
    debouncedSave.cancel();
    void saveBody(body);
  };

  const handleFixAndBreak = async () => {
    if (!body.trim() || isFixing) {
      return;
    }

    debouncedSave.cancel();
    setIsFixing(true);
    try {
      const fixedBody = await fixLyrics(body);
      const nextBody = breakLyricsIntoChunks(fixedBody, linesPerSlide);
      setBody(nextBody);
      await saveBody(nextBody);
    } finally {
      setIsFixing(false);
    }
  };

  const hasChanges = body !== lastSavedBody;

  return (
    <section className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/70 bg-card/95 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">
            {item.title || "Untitled"}
          </p>
        </div>
        <button
          type="button"
          onClick={handleManualSave}
          disabled={!hasChanges || isSaving}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition",
            hasChanges
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-secondary text-muted-foreground",
            isSaving && "cursor-wait opacity-70",
          )}
        >
          <Check className="h-3.5 w-3.5" />
          {isSaving ? "Saving" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          aria-label="Close mini editor"
          title="Close mini editor"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => handleBodyChange(event.target.value)}
        className="min-h-0 flex-1 resize-none bg-background px-3 py-3 font-mono text-[12px] leading-5 text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="Type lyrics..."
        spellCheck
      />

      <footer className="shrink-0 border-t border-border/70 bg-card/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFixAndBreak}
            disabled={isFixing || !body.trim()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[#ff6f59]/30 bg-[#ff6f59]/12 px-2 text-[11px] font-semibold text-[#ff6f59] transition hover:bg-[#ff6f59]/18 disabled:cursor-not-allowed disabled:opacity-50"
            title="Fix & split lyrics"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isFixing ? "Working" : "Fix / Break"}
          </button>
          <label className="min-w-0 flex flex-1 items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Lines
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={linesPerSlide}
              onChange={(event) => setLinesPerSlide(Number(event.target.value))}
              className="min-w-0 flex-1 accent-primary"
            />
            <span className="w-4 text-right text-foreground">
              {linesPerSlide}
            </span>
          </label>
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{body.split(/\s+/).filter(Boolean).length} words</span>
          <span
            className={cn(
              saveState === "saved" && "text-primary",
              saveState === "error" && "text-destructive",
            )}
          >
            {saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save failed"
                : isSaving
                  ? "Saving..."
                  : hasChanges
                    ? "Autosaving..."
                    : "Up to date"}
          </span>
        </div>
      </footer>
    </section>
  );
});
