"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, Search, Video } from "lucide-react";
import { VideoThumbnail } from "../../../features/media/components/VideoThumbnail";
import type { MediaItem } from "../../../features/media/hooks/useMediaFolders";
import { isBackgroundMedia } from "../../../features/themes/theme-look.mjs";
import { cn } from "../lib/utils";
import { useMediaLibraryStore } from "../store/mediaLibrary";
import { Segmented } from "./style-controls";

/** How many pictures the picker draws before asking for a search. */
const SHOWN = 60;

/**
 * Choosing an image or video from the media library, for a background.
 * The library is this computer's; another computer finds the same file by
 * its name.
 */
export function MediaPicker({
  value,
  onChoose,
  disabled,
}: {
  /** The chosen item's id, as a slide's `backgroundId` holds it. */
  value: string | null;
  onChoose: (item: MediaItem) => void;
  disabled?: boolean;
}) {
  const items = useMediaLibraryStore((state) => state.items);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter(
      (item) => (kind === "all" || item.type === kind) && (!needle || item.name.toLowerCase().includes(needle)),
    );
  }, [items, kind, query]);

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] leading-4 text-muted-foreground">
        No media yet. Add a folder of images or videos in the Media panel under Show, then choose one here.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", disabled && "pointer-events-none opacity-50")}>
      <div className="flex gap-1.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background/40 px-2">
          <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search media"
            aria-label="Search media"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </label>
        <Segmented
          value={kind}
          label="Kind of media"
          className="w-[108px] flex-none"
          onChange={(next) => setKind(next as typeof kind)}
          options={[
            { value: "all", label: "All" },
            { value: "image", label: <ImageIcon className="h-3.5 w-3.5" />, title: "Images" },
            { value: "video", label: <Video className="h-3.5 w-3.5" />, title: "Videos" },
          ]}
        />
      </div>
      <div className="grid max-h-[220px] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
        {shown.slice(0, SHOWN).map((item) => {
          const isChosen = Boolean(value) && isBackgroundMedia(value ?? "", item);
          return (
            <button
              key={item.id}
              type="button"
              title={item.name}
              onClick={() => onChoose(item)}
              className={cn(
                "relative aspect-video overflow-hidden rounded-md border bg-black transition",
                isChosen ? "border-primary ring-2 ring-primary/60" : "border-white/10 hover:border-primary/50",
              )}
            >
              {item.type === "video" ? (
                <VideoThumbnail path={item.path} lastModified={item.lastModified} name={item.name} fit="cover" />
              ) : (
                <img src={item.url} alt={item.name} draggable={false} className="h-full w-full object-cover" />
              )}
              {item.type === "video" ? (
                <Video className="absolute right-1 top-1 h-3 w-3 text-white drop-shadow" aria-hidden />
              ) : null}
            </button>
          );
        })}
      </div>
      {shown.length > SHOWN ? (
        <p className="text-[10px] text-muted-foreground">
          {shown.length - SHOWN} more. Search to find one.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">Nothing matches.</p>
      ) : null}
    </div>
  );
}
