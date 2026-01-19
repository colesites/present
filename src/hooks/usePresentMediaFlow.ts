"use client";

import { useCallback, useMemo, useState } from "react";
import type { Id } from "@/../convex/_generated/dataModel";

// service item typing stays loose: we only read type/song/_id/refId
type ServiceItemLike =
  | { type: "song"; song?: { _id: Id<"songs"> } | null }
  | { type: "media"; refId: string }
  | { type: string; [key: string]: unknown };

export function usePresentMediaFlow<
  TMedia extends { id: string; type: string },
>(params: {
  serviceItems: ServiceItemLike[];
  allMediaItems: TMedia[];
  activeMediaItem: TMedia | null;

  setServiceItemIndex: (index: number) => void;
  setSelectedSongId: (id: Id<"songs"> | null) => void;

  // ✅ NOW uses your real MediaItem type (TMedia), so no mismatch
  selectMediaForOutput: (item: TMedia | null) => void;

  selectSlide: (slideId: string, text: string) => Promise<void> | void;
  onSelectScripture?: (refId: string) => void;

  setShouldAutoPlay: (v: boolean) => void;
}) {
  const {
    serviceItems,
    allMediaItems,
    activeMediaItem,
    setServiceItemIndex,
    setSelectedSongId,
    selectMediaForOutput,
    selectSlide,
    setShouldAutoPlay,
  } = params;

  const [previewMediaItem, setPreviewMediaItem] = useState<TMedia | null>(null);

  const showViewMedia = useMemo(() => previewMediaItem, [previewMediaItem]);

  const onSelectServiceItem = useCallback(
    (index: number) => {
      const item = serviceItems[index];
      if (!item) return;

      setServiceItemIndex(index);

      if (item.type === "song") {
        const songId = (item as any).song?._id as Id<"songs"> | undefined;
        if (songId) {
          setSelectedSongId(songId);
          setPreviewMediaItem(null);
          return;
        }
      }

      if (item.type === "media") {
        const refId = (item as any).refId as string | undefined;
        if (!refId) return;

        const mediaItem = allMediaItems.find((m) => m.id === refId) ?? null;
        setPreviewMediaItem(mediaItem);
        setSelectedSongId(null);
      }

      if (item.type === "scripture") {
        const refId = (item as any).refId as string | undefined;
        if (refId && params.onSelectScripture) {
          params.onSelectScripture(refId);
          setPreviewMediaItem(null);
          setSelectedSongId(null);
        }
      }
    },
    [serviceItems, setServiceItemIndex, setSelectedSongId, allMediaItems],
  );

  const onDoubleClickServiceItem = useCallback(
    (index: number) => {
      const item = serviceItems[index];
      if (!item || item.type !== "media") return;

      const refId = (item as any).refId as string | undefined;
      if (!refId) return;

      const mediaItem = allMediaItems.find((m) => m.id === refId) ?? null;
      if (!mediaItem) return;

      // autoplay if it’s a video
      if ((mediaItem as any).type === "video") setShouldAutoPlay(true);

      setPreviewMediaItem(mediaItem);
      selectMediaForOutput(mediaItem);
      selectSlide("", "");
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

    if ((previewMediaItem as any).type === "video") setShouldAutoPlay(true);

    selectMediaForOutput(previewMediaItem);
    selectSlide("", "");
  }, [previewMediaItem, setShouldAutoPlay, selectMediaForOutput, selectSlide]);

  const onMediaPanelSelect = useCallback(
    (item: TMedia | null) => {
      setPreviewMediaItem(null);

      if ((item as any)?.type === "video") setShouldAutoPlay(true);

      selectMediaForOutput(item);
    },
    [setShouldAutoPlay, selectMediaForOutput],
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
