"use client";

import { useCallback, useMemo, useState } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";

import { ServiceItem } from "../types";

export function usePresentMediaFlow<
  TMedia extends { id: string; type: string },
>(params: {
  serviceItems: ServiceItem[];
  allMediaItems: TMedia[];
  activeMediaItem: TMedia | null;

  setServiceItemIndex: (index: number) => void;
  setSelectedLibraryId: (id: string | null) => void;

  // ✅ NOW uses your real MediaItem type (TMedia), so no mismatch
  selectMediaForOutput: (item: TMedia | null) => void;

  selectSlide: (slideId: string, text: string) => Promise<void> | void;
  onSelectScripture?: (refId: string) => void;
  onClearScripture?: () => void;

  setShouldAutoPlay: (v: boolean) => void;
}) {
  const {
    serviceItems,
    allMediaItems,
    activeMediaItem,
    setServiceItemIndex,
    setSelectedLibraryId,
    selectMediaForOutput,
    selectSlide,
    onClearScripture,
    setShouldAutoPlay,
  } = params;

  const [previewMediaItem, setPreviewMediaItem] = useState<TMedia | null>(null);

  const showViewMedia = useMemo(() => previewMediaItem, [previewMediaItem]);

  const onSelectServiceItem = useCallback(
    (index: number) => {
      const item = serviceItems[index];
      if (!item) return;

      setServiceItemIndex(index);

      if (item.type === "library") {
        const libraryId = item.libraryItem?._id;
        if (libraryId) {
          setSelectedLibraryId(libraryId);
          setPreviewMediaItem(null);
          onClearScripture?.();
          return;
        }
      }

      if (item.type === "media") {
        const refId = item.refId;
        if (!refId) return;

        const mediaItem = allMediaItems.find((m) => m.id === refId) ?? null;
        setPreviewMediaItem(mediaItem);
        setSelectedLibraryId(null);
        onClearScripture?.();

        // Go live immediately for media items
        if (mediaItem?.type === "video") setShouldAutoPlay(true);
        selectMediaForOutput(mediaItem);
        // Keep current text/slide active when changing backgrounds.
      }

      if (item.type === "scripture") {
        const refId = item.refId;
        if (refId && params.onSelectScripture) {
          params.onSelectScripture(refId);
          setPreviewMediaItem(null);
          setSelectedLibraryId(null);
        }
      }
    },
    [
      serviceItems,
      setServiceItemIndex,
      setSelectedLibraryId,
      allMediaItems,
      onClearScripture,
      selectMediaForOutput,
      selectSlide,
      setShouldAutoPlay,
      params,
    ],
  );

  const onDoubleClickServiceItem = useCallback(
    (index: number) => {
      const item = serviceItems[index];
      if (!item || item.type !== "media") return;

      const refId = item.refId;
      if (!refId) return;

      const mediaItem = allMediaItems.find((m) => m.id === refId) ?? null;
      if (!mediaItem) return;

      // autoplay if it’s a video
      if (mediaItem.type === "video") setShouldAutoPlay(true);

      setPreviewMediaItem(mediaItem);
      selectMediaForOutput(mediaItem);
      // Keep current text/slide active when changing backgrounds.
    },
    [
      serviceItems,
      allMediaItems,
      setShouldAutoPlay,
      selectMediaForOutput,
      selectSlide,
    ],
  );

  const onOutputPreviewMedia = useCallback(() => {
    if (!previewMediaItem) return;

    if (previewMediaItem.type === "video") setShouldAutoPlay(true);

    selectMediaForOutput(previewMediaItem);
    // Keep current text/slide active when changing backgrounds.
    onClearScripture?.();
  }, [
    previewMediaItem,
    setShouldAutoPlay,
    selectMediaForOutput,
    selectSlide,
    onClearScripture,
  ]);

  const onMediaPanelSelect = useCallback(
    (item: TMedia | null) => {
      setPreviewMediaItem(null);
      onClearScripture?.();

      if (item?.type === "video") setShouldAutoPlay(true);

      selectMediaForOutput(item);
      // Keep current text/slide active when changing backgrounds.
    },
    [setShouldAutoPlay, selectMediaForOutput, selectSlide, onClearScripture],
  );

  const isPreviewOutputting =
    previewMediaItem?.id != null && activeMediaItem?.id === previewMediaItem.id;

  return {
    previewMediaItem,
    showViewMedia,
    isPreviewOutputting,
    onSelectServiceItem,
    onDoubleClickServiceItem,
    onOutputPreviewMedia,
    onMediaPanelSelect,
  };
}
