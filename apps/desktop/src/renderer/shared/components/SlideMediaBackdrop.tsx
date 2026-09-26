"use client";

import { VideoThumbnail } from "../../../features/media/components/VideoThumbnail";
import { findBackgroundMedia } from "../../../features/themes/theme-look.mjs";
import { cn } from "../lib/utils";
import { useMediaLibraryStore } from "../store/mediaLibrary";

/**
 * A slide's image or video background (`backgroundId`), as a still behind a
 * picture of the slide. The output plays it as the media layer; everywhere
 * else a slide is drawn small, this stands in for it.
 */
export function SlideMediaBackdrop({
  backgroundId,
  className,
}: {
  backgroundId: string | null | undefined;
  className?: string;
}) {
  const items = useMediaLibraryStore((state) => state.items);
  const item = findBackgroundMedia(backgroundId, items);
  if (!item) return null;
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {item.type === "video" ? (
        <VideoThumbnail path={item.path} lastModified={item.lastModified} name={item.name} fit="cover" />
      ) : (
        <img src={item.url} alt="" draggable={false} className="h-full w-full object-cover" />
      )}
    </div>
  );
}
