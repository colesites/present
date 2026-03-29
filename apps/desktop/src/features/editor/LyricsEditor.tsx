"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import type { LibraryItem } from "../../shared/types";
import { FontToolbar } from "./FontToolbar";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

interface LyricsEditorProps {
  libraryItem: LibraryItem;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  scrollToSlideIndex?: number | null;
  onSave: (title: string, body: string) => Promise<void>;
  onFixLyrics: (body: string) => Promise<string>;
  onFontStyleChange: (styles: {
    fontFamily?: string;
    fontSize?: number;
    fontBold?: boolean;
    fontItalic?: boolean;
    fontUnderline?: boolean;
  }) => void;
  onScrollComplete?: () => void;
}

export const LyricsEditor = memo(function LyricsEditor({
  libraryItem,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  scrollToSlideIndex,
  onSave,
  onFixLyrics,
  onFontStyleChange,
  onScrollComplete,
}: LyricsEditorProps) {
  const [editTitle, setEditTitle] = useState(libraryItem.title);
  const [editBody, setEditBody] = useState(libraryItem.body);
  const [isSaving, setIsSaving] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track last known server state to detect external updates vs local edits
  const lastServerTitle = useRef(libraryItem.title);
  const lastServerBody = useRef(libraryItem.body);
  const lastItemId = useRef(libraryItem._id);
  const latestSave = useRef<{ title: string; body: string } | null>(null);

  // Sync with server state, but preserve local edits if divergent
  useEffect(() => {
    // If item changed completely, reset everything
    if (libraryItem._id !== lastItemId.current) {
      setEditTitle(libraryItem.title);
      setEditBody(libraryItem.body);
      lastServerTitle.current = libraryItem.title;
      lastServerBody.current = libraryItem.body;
      lastItemId.current = libraryItem._id;
      return;
    }

    // If server content changed (e.g. external update or save confirmation)
    if (libraryItem.title !== lastServerTitle.current) {
      // Only update if local matches old server (user hasn't typed)
      // AND the update isn't just our own save coming back
      const isMySave = latestSave.current?.title === libraryItem.title;
      if (!isMySave && editTitle === lastServerTitle.current) {
        setEditTitle(libraryItem.title);
      }
      lastServerTitle.current = libraryItem.title;
    }

    if (libraryItem.body !== lastServerBody.current) {
      // Only update if local matches old server (user hasn't typed)
      // AND the update isn't just our own save coming back
      const isMySave = latestSave.current?.body === libraryItem.body;
      if (!isMySave && editBody === lastServerBody.current) {
        setEditBody(libraryItem.body);
      }
      lastServerBody.current = libraryItem.body;
    }
  }, [libraryItem._id, libraryItem.title, libraryItem.body, editTitle, editBody]);

  const [isBlinking, setIsBlinking] = useState(false);

  // Debounced auto-save (silent, no toast)
  const debouncedAutoSave = useDebouncedCallback(
    async (title: string, body: string) => {
      if (!title.trim()) return;
      latestSave.current = { title, body };
      try {
        await onSave(title.trim(), body);
        lastServerTitle.current = title.trim();
        lastServerBody.current = body;
      } catch {
        // Silent fail for auto-save
      }
    },
    1000, // 1 second debounce
  );

  // Trigger auto-save when title or body change
  useEffect(() => {
    if (
      editTitle.trim() &&
      (editTitle !== libraryItem.title || editBody !== libraryItem.body)
    ) {
      debouncedAutoSave(editTitle, editBody);
    }
  }, [editTitle, editBody, libraryItem.title, libraryItem.body, debouncedAutoSave]);

  // Scroll to slide position when scrollToSlideIndex changes
  useEffect(() => {
    if (scrollToSlideIndex == null || !textareaRef.current) return;

    const textarea = textareaRef.current;
    const body = libraryItem.body;

    // Split body into blocks (separated by empty lines)
    // Each block corresponds to a slide
    const blocks: { start: number; end: number }[] = [];
    let currentStart = 0;
    let inBlock = false;
    let blockStart = 0;

    for (let i = 0; i <= body.length; i++) {
      const char = body[i];
      const isEnd = i === body.length;
      const isNewline = char === "\n";

      if (isEnd || isNewline) {
        const lineStart = currentStart;
        const lineEnd = i;
        const line = body.slice(lineStart, lineEnd).trim();

        // Check if this line is a label like [Verse]
        const isLabel = /^\[.+\]$/.test(line);

        if (line.length > 0 && !isLabel) {
          if (!inBlock) {
            inBlock = true;
            blockStart = lineStart;
          }
        } else if (inBlock && (line.length === 0 || isLabel)) {
          // End of block
          blocks.push({
            start: blockStart,
            end: currentStart > 0 ? currentStart - 1 : 0,
          });
          inBlock = false;
          // Label starts a new potential block context
        }

        currentStart = i + 1;
      }
    }

    // Don't forget the last block
    if (inBlock) {
      blocks.push({ start: blockStart, end: body.length });
    }

    // Find the target block
    if (scrollToSlideIndex >= blocks.length) {
      // Fallback: just go to end of document
      textarea.focus();
      textarea.setSelectionRange(body.length, body.length);
      onScrollComplete?.();
      return;
    }

    const targetBlock = blocks[scrollToSlideIndex];
    const startPos = targetBlock.start;
    const endPos = targetBlock.end;

    // Focus the textarea
    textarea.focus();

    // Scroll to position first
    const textBefore = body.slice(0, startPos);
    const lineNumber = textBefore.split("\n").length - 1;
    const lineHeight = 20;
    const scrollTop = Math.max(0, lineNumber * lineHeight - 100);
    textarea.scrollTop = scrollTop;

    // Place cursor at end of the slide (no selection, so typing works immediately)
    textarea.setSelectionRange(endPos, endPos);

    // Trigger blink effect (border glow + caret blink)
    setIsBlinking(true);

    // Stop blinking after animation completes (0.6s * 5 = 3s), then notify parent
    const blinkTimeout = setTimeout(() => {
      setIsBlinking(false);
      onScrollComplete?.();
    }, 3000);

    // Cleanup timeout if effect re-runs or component unmounts
    return () => {
      clearTimeout(blinkTimeout);
    };
  }, [scrollToSlideIndex, libraryItem.body, onScrollComplete]);

  const handleSave = useCallback(async () => {
    if (!editTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    setIsSaving(true);
    latestSave.current = { title: editTitle, body: editBody };
    try {
      await onSave(editTitle.trim(), editBody);
      lastServerTitle.current = editTitle.trim();
      lastServerBody.current = editBody;
      toast.success("Saved successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [editTitle, editBody, onSave]);

  const handleFix = useCallback(async () => {
    if (!editBody.trim()) return;
    setIsFixing(true);
    try {
      const fixed = await onFixLyrics(editBody);
      setEditBody(fixed);
      toast.success("Content cleaned up");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clean up");
    } finally {
      setIsFixing(false);
    }
  }, [editBody, onFixLyrics]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Title and actions */}
      <div className="flex items-center gap-3">
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Title"
        />
        <button
          type="button"
          onClick={handleFix}
          disabled={isFixing}
          className="rounded-md border border-input px-4 py-2 text-xs font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
        >
          {isFixing ? "Cleaning..." : "Clean up body"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {isSaving ? "Saving..." : "Save"}{" "}
          <span className="text-[10px] opacity-60">⌘S</span>
        </button>
      </div>

      {/* Font toolbar */}
      <FontToolbar
        fontFamily={fontFamily}
        fontSize={fontSize}
        fontBold={fontBold}
        fontItalic={fontItalic}
        fontUnderline={fontUnderline}
        onFontFamilyChange={(f) => onFontStyleChange({ fontFamily: f })}
        onFontSizeChange={(s) => onFontStyleChange({ fontSize: s })}
        onBoldToggle={() => onFontStyleChange({ fontBold: !fontBold })}
        onItalicToggle={() => onFontStyleChange({ fontItalic: !fontItalic })}
        onUnderlineToggle={() =>
          onFontStyleChange({ fontUnderline: !fontUnderline })
        }
      />

      {/* Body textarea */}
      <textarea
        ref={textareaRef}
        value={editBody}
        onChange={(e) => setEditBody(e.target.value)}
        className={`flex-1 resize-none rounded-md border border-input bg-card p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${
          isBlinking ? "editor-blink" : ""
        }`}
        placeholder="[Verse 1]&#10;Line 1&#10;Line 2&#10;&#10;[Chorus]&#10;Line 1"
      />
    </div>
  );
});
