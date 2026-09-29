"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Folder, Image as ImageIcon, Search, Video } from "lucide-react";
import { VideoThumbnail } from "../../../features/media/components/VideoThumbnail";
import type { MediaItem } from "../../../features/media/hooks/useMediaFolders";
import { isBackgroundMedia } from "../../../features/themes/theme-look.mjs";
import { cn } from "../lib/utils";
import { useMediaLibraryStore } from "../store/mediaLibrary";
import { Segmented } from "./style-controls";

/** How many pictures are drawn at a time, before Show more. */
const PAGE = 48;

type Kind = "all" | "image" | "video";

/** A media folder and what in it is of the kind being looked for. */
type FolderGroup = { id: string; name: string; items: MediaItem[] };

/** The last part of a folder's path, for media whose folder is not listed. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-2) ?? "Media";
}

function counted(items: MediaItem[]): string {
  const videos = items.filter((item) => item.type === "video").length;
  const images = items.length - videos;
  const parts = [
    videos ? `${videos} video${videos === 1 ? "" : "s"}` : null,
    images ? `${images} image${images === 1 ? "" : "s"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** A still of an image or video, filling its frame. */
function Still({ item }: { item: MediaItem }) {
  return item.type === "video" ? (
    <VideoThumbnail path={item.path} lastModified={item.lastModified} name={item.name} fit="cover" />
  ) : (
    <img src={item.url} alt="" draggable={false} className="h-full w-full object-cover" />
  );
}

const TILE_FRAME = "relative block aspect-video w-full overflow-hidden rounded-md border bg-black transition";
const GRID = "grid grid-cols-3 gap-x-2 gap-y-2.5 @2xl:grid-cols-4 @4xl:grid-cols-5";

/**
 * Choosing an image or video from the media library, for a background.
 * The library is this computer's; another computer finds the same file by
 * its name.
 *
 * The folders come first, and a folder is opened to choose from it: a whole
 * library at once was a wall of pictures too small to tell apart.
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
  const folders = useMediaLibraryStore((state) => state.folders);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const everyGroup = useMemo(() => {
    const byFolder = new Map<string, MediaItem[]>();
    for (const item of items) {
      if (kind !== "all" && item.type !== kind) continue;
      const list = byFolder.get(item.folderId);
      if (list) list.push(item);
      else byFolder.set(item.folderId, [item]);
    }
    const listed: FolderGroup[] = folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      items: byFolder.get(folder.id) ?? [],
    }));
    for (const [id, list] of byFolder) {
      if (!folders.some((folder) => folder.id === id)) {
        listed.push({ id, name: folderName(list[0].path), items: list });
      }
    }
    return listed;
  }, [items, folders, kind]);
  // A folder with nothing of this kind has nothing to open.
  const groups = useMemo(() => everyGroup.filter((group) => group.items.length > 0), [everyGroup]);

  const openFolder = openId ? (everyGroup.find((group) => group.id === openId) ?? null) : null;
  const chosenFolderId = value ? items.find((item) => isBackgroundMedia(value, item))?.folderId : undefined;

  const needle = query.trim().toLowerCase();
  // Inside a folder, a search looks in that folder; outside, in all of them.
  const shown = useMemo(() => {
    if (!openFolder && !needle) return [];
    const pool = openFolder ? openFolder.items : groups.flatMap((group) => group.items);
    return needle ? pool.filter((item) => item.name.toLowerCase().includes(needle)) : pool;
  }, [openFolder, needle, groups]);

  const browse = (id: string | null) => {
    setOpenId(id);
    setQuery("");
    setLimit(PAGE);
  };

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[11px] leading-4 text-muted-foreground">
        No media yet. Add a folder of images or videos in the Media panel under Show, then choose one here.
      </p>
    );
  }

  const showingFolders = !openFolder && !needle;

  return (
    <div className={cn("@container flex flex-col gap-2.5", disabled && "pointer-events-none opacity-50")}>
      <div className="flex gap-1.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background/40 px-2">
          <Search className="h-3.5 w-3.5 flex-none text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE);
            }}
            placeholder={openFolder ? `Search ${openFolder.name}` : "Search all media"}
            aria-label="Search media"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </label>
        <Segmented
          value={kind}
          label="Kind of media"
          className="w-[108px] flex-none"
          onChange={(next) => {
            setKind(next as Kind);
            setLimit(PAGE);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "image", label: <ImageIcon className="h-3.5 w-3.5" />, title: "Images" },
            { value: "video", label: <Video className="h-3.5 w-3.5" />, title: "Videos" },
          ]}
        />
      </div>

      {openFolder ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => browse(null)}
            className="flex h-6 flex-none items-center gap-0.5 rounded-md pl-0.5 pr-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Folders
          </button>
          <span className="text-muted-foreground/40" aria-hidden>
            /
          </span>
          <span className="truncate text-[11px] font-semibold text-foreground">{openFolder.name}</span>
          <span className="flex-none text-[10px] text-muted-foreground">{counted(openFolder.items)}</span>
        </div>
      ) : null}

      {/* The scrolling is outside the grid: a grid of a limited height squeezes its rows to fit. */}
      <div className="max-h-[320px] overflow-y-auto pr-0.5">
        {showingFolders ? (
          groups.length > 0 ? (
            <div className={GRID}>
              {groups.map((group) => {
                const cover = group.items.find((item) => item.type === "image") ?? group.items[0];
                const holdsChoice = group.id === chosenFolderId;
                return (
                  <button
                    key={group.id}
                    type="button"
                    title={`Open ${group.name}`}
                    onClick={() => browse(group.id)}
                    className="group flex min-w-0 flex-col gap-1 text-left"
                  >
                    <span
                      className={cn(
                        TILE_FRAME,
                        holdsChoice ? "border-primary/70" : "border-white/10 group-hover:border-primary/50",
                      )}
                    >
                      <Still item={cover} />
                      {holdsChoice ? (
                        <span className="absolute right-1 top-1 rounded bg-primary px-1 py-px text-[9px] font-semibold text-primary-foreground">
                          In use
                        </span>
                      ) : null}
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-foreground">
                      <Folder className="h-3 w-3 flex-none text-muted-foreground" aria-hidden />
                      <span className="truncate">{group.name}</span>
                    </span>
                    <span className="-mt-0.5 truncate text-[10px] text-muted-foreground">{counted(group.items)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-2 text-[10px] text-muted-foreground">
              No {kind === "image" ? "images" : "videos"} in the media folders.
            </p>
          )
        ) : shown.length > 0 ? (
          <div className={GRID}>
            {shown.slice(0, limit).map((item) => {
              const isChosen = Boolean(value) && isBackgroundMedia(value ?? "", item);
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.name}
                  onClick={() => onChoose(item)}
                  className="group flex min-w-0 flex-col gap-1 text-left"
                >
                  <span
                    className={cn(
                      TILE_FRAME,
                      isChosen ? "border-primary ring-2 ring-primary/60" : "border-white/10 group-hover:border-primary/50",
                    )}
                  >
                    <Still item={item} />
                    {item.type === "video" ? (
                      <Video className="absolute right-1 top-1 h-3 w-3 text-white drop-shadow" aria-hidden />
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "truncate text-[10px]",
                      isChosen ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                    )}
                  >
                    {item.name}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="py-2 text-[10px] text-muted-foreground">Nothing matches.</p>
        )}
        {!showingFolders && shown.length > limit ? (
          <button
            type="button"
            onClick={() => setLimit((current) => current + PAGE)}
            className="mt-2.5 w-full rounded-md border border-border py-1.5 text-[11px] font-medium text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            {shown.length - limit > PAGE ? `Show ${PAGE} more of ${shown.length - limit}` : `Show the last ${shown.length - limit}`}
          </button>
        ) : null}
      </div>
    </div>
  );
}
