"use client";

import { startTransition, useCallback, useMemo, useState } from "react";
import { ServiceItem } from "../../../shared/types";

export function usePresentMediaFlow<
  TMedia extends { id: string; type: string },
>(params: {
  serviceItems: ServiceItem[];
  allMediaItems: TMedia[];
  activeMediaItem: TMedia | null;

  setServiceItemIndex: (index: number) => void;
  setSelectedLibraryId: (id: string | null) => void;

  selectMediaForOutput: (item: TMedia | null) => void;

  onSelectScripture?: (refId: string) => void;
  onSelectPresentation?: (refId: string) => void;
  onClearScripture?: () => void;
  onClearPresentation?: () => void;

  setShouldAutoPlay: (v: boolean) => void;
}) {
  const {
    serviceItems,
    allMediaItems,
    activeMediaItem,
    setServiceItemIndex,
    setSelectedLibraryId,
    selectMediaForOutput,
    onSelectScripture,
    onSelectPresentation,
    onClearScripture,
    onClearPresentation,
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
        const libraryId = item.refId || item.libraryItem?._id;
        if (libraryId) {
          // Keep the current slide deck painted while React prepares the next
          // song's preview canvases. The service-row highlight remains urgent.
          startTransition(() => {
            setSelectedLibraryId(String(libraryId));
          });
          setPreviewMediaItem(null);
          onClearScripture?.();
          onClearPresentation?.();
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
        onClearPresentation?.();
      }

      if (item.type === "scripture") {
        const refId = item.refId;
        if (refId && onSelectScripture) {
          onSelectScripture(refId);
          setPreviewMediaItem(null);
          setSelectedLibraryId(null);
          onClearPresentation?.();
        }
      }

      if (item.type === "presentation") {
        const refId = item.refId;
        if (refId && onSelectPresentation) {
          onSelectPresentation(refId);
          setPreviewMediaItem(null);
          setSelectedLibraryId(null);
          onClearScripture?.();
        }
      }
    },
    [
      serviceItems,
      setServiceItemIndex,
      setSelectedLibraryId,
      allMediaItems,
      onSelectPresentation,
      onSelectScripture,
      onClearScripture,
      onClearPresentation,
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
    ],
  );

  const onOutputPreviewMedia = useCallback(() => {
    if (!previewMediaItem) return;

    if (previewMediaItem.type === "video") setShouldAutoPlay(true);

    selectMediaForOutput(previewMediaItem);
    // Keep current text/slide active when changing backgrounds.
    onClearScripture?.();
    onClearPresentation?.();
  }, [
    previewMediaItem,
    setShouldAutoPlay,
    selectMediaForOutput,
    onClearScripture,
    onClearPresentation,
  ]);

  const onMediaPanelSelect = useCallback(
    (item: TMedia | null) => {
      setPreviewMediaItem(null);
      onClearScripture?.();
      onClearPresentation?.();

      if (item?.type === "video") setShouldAutoPlay(true);

      selectMediaForOutput(item);
      // Keep current text/slide active when changing backgrounds.
    },
    [
      setShouldAutoPlay,
      selectMediaForOutput,
      onClearPresentation,
      onClearScripture,
    ],
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
