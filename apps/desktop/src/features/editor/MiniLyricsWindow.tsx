"use client";

import { useEffect, useState } from "react";
import { MiniLyricsEditor } from "./MiniLyricsEditor";

export function MiniLyricsWindow() {
  const [item, setItem] = useState<MiniLyricsPayload | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onMiniLyricsData) {
      return;
    }
    return window.electronAPI.onMiniLyricsData((payload) => {
      setItem(payload);
      document.title = payload.title
        ? `Mini Lyrics - ${payload.title}`
        : "Mini Lyrics Editor";
    });
  }, []);

  useEffect(() => {
    window.electronAPI?.notifyMiniLyricsReady?.();
  }, []);

  const handleSave = async (body: string) => {
    if (!item) {
      return;
    }
    const result = await window.electronAPI.saveMiniLyrics({
      libraryId: item.libraryId,
      body,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Failed to save lyrics");
    }
  };

  if (!item) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-xs text-muted-foreground">
        Loading lyrics...
      </div>
    );
  }

  return (
    <MiniLyricsEditor
      key={item.libraryId}
      item={item}
      onClose={() => {
        void window.electronAPI.closeMiniLyricsWindow(item.libraryId);
      }}
      onSave={handleSave}
    />
  );
}
