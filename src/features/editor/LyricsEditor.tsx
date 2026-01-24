"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import type { Song } from "@/types";
import { FontToolbar } from "./FontToolbar";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

interface LyricsEditorProps {
  song: Song;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  scrollToSlideIndex?: number | null;
  onSave: (title: string, lyrics: string) => Promise<void>;
  onFixLyrics: (lyrics: string) => Promise<string>;
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
  song,
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
  const [editTitle, setEditTitle] = useState(song.title);
  const [editLyrics, setEditLyrics] = useState(song.lyrics);
  const [isSaving, setIsSaving] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Track last known server state to detect external updates vs local edits
  const lastServerTitle = useRef(song.title);
  const lastServerLyrics = useRef(song.lyrics);
  const lastSongId = useRef(song._id);
  const latestSave = useRef<{ title: string; lyrics: string } | null>(null);

  // Sync with server state, but preserve local edits if divergent
  useEffect(() => {
    // If song changed completely, reset everything
    if (song._id !== lastSongId.current) {
      setEditTitle(song.title);
      setEditLyrics(song.lyrics);
      lastServerTitle.current = song.title;
      lastServerLyrics.current = song.lyrics;
      lastSongId.current = song._id;
      return;
    }

    // If server content changed (e.g. external update or save confirmation)
    if (song.title !== lastServerTitle.current) {
      // Only update if local matches old server (user hasn't typed)
      // AND the update isn't just our own save coming back
      const isMySave = latestSave.current?.title === song.title;
      if (!isMySave && editTitle === lastServerTitle.current) {
        setEditTitle(song.title);
      }
      lastServerTitle.current = song.title;
    }

    if (song.lyrics !== lastServerLyrics.current) {
      // Only update if local matches old server (user hasn't typed)
      // AND the update isn't just our own save coming back
      const isMySave = latestSave.current?.lyrics === song.lyrics;
      if (!isMySave && editLyrics === lastServerLyrics.current) {
        setEditLyrics(song.lyrics);
      }
      lastServerLyrics.current = song.lyrics;
    }
  }, [song._id, song.title, song.lyrics, editTitle, editLyrics]);

  const [isBlinking, setIsBlinking] = useState(false);

  // Debounced auto-save (silent, no toast)
  const debouncedAutoSave = useDebouncedCallback(
    async (title: string, lyrics: string) => {
      if (!title.trim()) return;
      latestSave.current = { title, lyrics };
      try {
        await onSave(title.trim(), lyrics);
        lastServerTitle.current = title.trim();
        lastServerLyrics.current = lyrics;
      } catch {
        // Silent fail for auto-save
      }
    },
    1000, // 1 second debounce
  );

  // Trigger auto-save when title or lyrics change
  useEffect(() => {
    if (
      editTitle.trim() &&
      (editTitle !== song.title || editLyrics !== song.lyrics)
    ) {
      debouncedAutoSave(editTitle, editLyrics);
    }
  }, [editTitle, editLyrics, song.title, song.lyrics, debouncedAutoSave]);

  // Scroll to slide position when scrollToSlideIndex changes
  useEffect(() => {
    if (scrollToSlideIndex == null || !textareaRef.current) return;

    const textarea = textareaRef.current;
    const lyrics = song.lyrics;

    // Split lyrics into blocks (separated by empty lines)
    // Each block corresponds to a slide
    const blocks: { start: number; end: number }[] = [];
    let currentStart = 0;
    let inBlock = false;
    let blockStart = 0;

    for (let i = 0; i <= lyrics.length; i++) {
      const char = lyrics[i];
      const isEnd = i === lyrics.length;
      const isNewline = char === "\n";

      if (isEnd || isNewline) {
        const lineStart = currentStart;
        const lineEnd = i;
        const line = lyrics.slice(lineStart, lineEnd).trim();

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
      blocks.push({ start: blockStart, end: lyrics.length });
    }

    // Find the target block
    if (scrollToSlideIndex >= blocks.length) {
      // Fallback: just go to end of document
      textarea.focus();
      textarea.setSelectionRange(lyrics.length, lyrics.length);
      onScrollComplete?.();
      return;
    }

    const targetBlock = blocks[scrollToSlideIndex];
    const startPos = targetBlock.start;
    const endPos = targetBlock.end;

    // Focus the textarea
    textarea.focus();

    // Scroll to position first
    const textBefore = lyrics.slice(0, startPos);
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
  }, [scrollToSlideIndex, song.lyrics, onScrollComplete]);

  const handleSave = useCallback(async () => {
    if (!editTitle.trim()) {
      toast.error("Title is required");
      return;
    }
    setIsSaving(true);
    latestSave.current = { title: editTitle, lyrics: editLyrics };
    try {
      await onSave(editTitle.trim(), editLyrics);
      lastServerTitle.current = editTitle.trim();
      lastServerLyrics.current = editLyrics;
      toast.success("Saved successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [editTitle, editLyrics, onSave]);

  const handleFix = useCallback(async () => {
    if (!editLyrics.trim()) return;
    setIsFixing(true);
    try {
      const fixed = await onFixLyrics(editLyrics);
      setEditLyrics(fixed);
      toast.success("Lyrics cleaned up");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fix lyrics");
    } finally {
      setIsFixing(false);
    }
  }, [editLyrics, onFixLyrics]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Title and actions */}
      <div className="flex items-center gap-3">
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Song title"
        />
        <button
          type="button"
          onClick={handleFix}
          disabled={isFixing}
          className="rounded-md border border-input px-4 py-2 text-xs font-medium text-foreground transition hover:bg-secondary disabled:opacity-50"
        >
          {isFixing ? "Fixing..." : "Fix lyrics"}
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

      {/* Lyrics textarea */}
      <textarea
        ref={textareaRef}
        value={editLyrics}
        onChange={(e) => setEditLyrics(e.target.value)}
        className={`flex-1 resize-none rounded-md border border-input bg-card p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${
          isBlinking ? "editor-blink" : ""
        }`}
        placeholder="[Verse 1]&#10;Line 1&#10;Line 2&#10;&#10;[Chorus]&#10;Line 1"
      />
    </div>
  );
});
