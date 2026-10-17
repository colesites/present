"use client";

import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

import { createLocalMediaUrl } from "../../../shared/lib/local-media-url.mjs";
import { safelyUnlisten } from "../../../renderer/tauri/electron-bridge";

// Types for media items
export type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video";
  url: string; // local-media:// protocol URL
  path: string;
  folderId: string;
  lastModified: number;
};

export type MediaFolder = {
  id: string;
  name: string;
  path: string;
};

export type VideoSettings = {
  loop: boolean;
  muted: boolean;
  volume: number;
};

/**
 * How whole-screen media meets a screen of another shape: inside it with bars
 * (the default), filling it cropped, or stretched to it — `MediaFit` in Rust.
 */
export type MediaFit = "fit" | "fill" | "stretch";

export type MediaFilters = {
  brightness: number; 
  contrast: number; 
  saturation: number; 
  blur: number; 
  grayscale: number; 
  sepia: number; 
  hueRotate: number;
  /** Not a filter, but per media like them; absent is `"fit"`. */
  fit?: MediaFit;
};

export const DEFAULT_FILTERS: MediaFilters = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  hueRotate: 0,
};

export type MediaState = ReturnType<typeof useMediaFolders>;

// The folder list is Rust's (`state/file_state.rs`, `media-folders.json`): the
// same list that decides which files the app may read, and the one the live
// watch follows (`services/media_watch.rs`). The panel kept its own copy in
// IndexedDB before, which a removal never reached and each build had apart.
const listMediaFolders = () => invoke<MediaFolder[]>("list_media_folders");
const removeMediaFolder = (id: string) => invoke<boolean>("remove_media_folder", { id });
const addMediaFolder = (path: string) => invoke<MediaFolder>("add_media_folder", { path });

// Supported file extensions
const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"];

function getMediaType(fileName: string): "image" | "video" | null {
  const lower = fileName.toLowerCase();
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "image";
  if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "video";
  return null;
}

const createMediaId = (folderId: string, fileName: string) =>
  `${folderId}-${fileName}`;

const createMediaUrl = (filePath: string) => createLocalMediaUrl(filePath);

export function filtersToCSS(filters: MediaFilters): string {
  const parts: string[] = [];
  if (filters.brightness !== 100)
    parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast}%)`);
  if (filters.saturation !== 100)
    parts.push(`saturate(${filters.saturation}%)`);
  if (filters.blur > 0) parts.push(`blur(${filters.blur}px)`);
  if (filters.grayscale > 0) parts.push(`grayscale(${filters.grayscale}%)`);
  if (filters.sepia > 0) parts.push(`sepia(${filters.sepia}%)`);
  if (filters.hueRotate !== 0)
    parts.push(`hue-rotate(${filters.hueRotate}deg)`);
  return parts.length > 0 ? parts.join(" ") : "none";
}

const FILTERS_STORAGE_KEY = "present-media-filters";

function loadFiltersFromStorage(): Record<string, MediaFilters> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveFiltersToStorage(filters: Record<string, MediaFilters>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error("Failed to save filters:", e);
  }
}

// Stub for cross-window blob support (no longer needed for local-media, but keep signature)
export async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  return blobUrl;
}

export function useMediaFolders() {
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  const [allMediaItems, setAllMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // A re-read after a folder changed keeps showing what is there until the new
  // list is ready; only the first load shows the loading state.
  const hasLoadedMediaRef = useRef(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Load saved folders on mount
  useEffect(() => {
    let isMounted = true;
    listMediaFolders()
      .then((saved) => {
        if (isMounted) setFolders(saved);
      })
      .catch((error: unknown) => {
        console.error("Failed to load saved folders:", error);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Load ALL media from ALL folders via IPC
  useEffect(() => {
    async function loadAllMedia() {
      if (folders.length === 0) {
        setAllMediaItems([]);
        setIsLoading(false);
        return;
      }

      if (!hasLoadedMediaRef.current) {
        setIsLoading(true);
      }
      const items: MediaItem[] = [];

      for (const folder of folders) {
        try {
          const files = await window.electronAPI.readFolder(folder.path);
          for (const file of files) {
            const mediaType = getMediaType(file.name);
            if (mediaType) {
              const fullPath = `${folder.path}/${file.name}`;
                items.push({
                  id: createMediaId(folder.id, file.name),
                  name: file.name,
                  type: mediaType,
                  url: createMediaUrl(fullPath),
                  path: fullPath,
                  folderId: folder.id,
                  lastModified: file.lastModified || 0,
                });
            }
          }
        } catch (error) {
          console.error(`Failed to load media from ${folder.name}:`, error);
        }
      }

      items.sort((a, b) => a.name.localeCompare(b.name));
      setAllMediaItems(items);
      hasLoadedMediaRef.current = true;
      setIsLoading(false);
    }

    loadAllMedia();
  }, [folders]);



  const mediaItems = useMemo(() => {
    if (!selectedFolderId) return allMediaItems;
    return allMediaItems.filter((item) => item.folderId === selectedFolderId);
  }, [allMediaItems, selectedFolderId]);

  /**
   * Add every folder the operator picked.
   *
   * A church's media is not organised one folder at a time — backgrounds,
   * countdowns and a term's sermon series get added together — so the picker
   * takes as many as they select. Returns all of them; the last becomes the
   * selected one, which is the one they just finished choosing.
   *
   * Falls back to the single-folder picker on a build whose core predates the
   * plural one, so an older core does not leave the button doing nothing.
   */
  const addFolder = useCallback(async () => {
    try {
      const picked = window.electronAPI.selectFolders
        ? await window.electronAPI.selectFolders()
        : [await window.electronAPI.selectFolder()].filter(
            (folder): folder is MediaFolder => Boolean(folder),
          );
      if (!picked || picked.length === 0) return []; // Cancelled

      const added: MediaFolder[] = [];
      setFolders((previous) => {
        const next = [...previous];
        for (const { id, name, path } of picked) {
          const existing = next.find((folder) => folder.path === path);
          if (existing) {
            added.push(existing);
            continue;
          }
          const folder: MediaFolder = { id, name, path };
          next.push(folder);
          added.push(folder);
        }
        return next;
      });

      const last = added[added.length - 1] ?? picked[picked.length - 1];
      if (last) setSelectedFolderId(last.id);
      return added;
    } catch (error) {
      console.error("Add folder error:", error);
      throw error;
    }
  }, []);

  const removeFolder = useCallback(
    async (folderId: string) => {
      await removeMediaFolder(folderId);
      setAllMediaItems((prev) => prev.filter((item) => item.folderId !== folderId));
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
    },
    [selectedFolderId]
  );

  const refreshMedia = useCallback(async () => {
    setFolders((prev) => [...prev]);
  }, []);

  // A file added, removed or renamed in a media folder — by this app or any
  // other — re-reads the folders (`services/media_watch.rs`).
  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("media:folders-changed", () => void refreshMedia()))
      .then((unlisten) => {
        if (cancelled) {
          safelyUnlisten(unlisten);
          return;
        }
        detach = () => safelyUnlisten(unlisten);
      })
      .catch((error: unknown) => {
        console.error("[media] could not watch the media folders", error);
      });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [refreshMedia]);

  const images = useMemo(() => mediaItems.filter((item) => item.type === "image"), [mediaItems]);
  const videos = useMemo(() => mediaItems.filter((item) => item.type === "video"), [mediaItems]);

  const [activeMediaItem, setActiveMediaItem] = useState<MediaItem | null>(null);

  const [videoSettings, setVideoSettings] = useState<VideoSettings>({
    loop: true,
    muted: false,
    volume: 1,
  });

  const [itemFilters, setItemFilters] = useState<Record<string, MediaFilters>>(() => loadFiltersFromStorage());

  useEffect(() => {
    saveFiltersToStorage(itemFilters);
  }, [itemFilters]);

  const mediaFilters = useMemo(() => {
    if (!activeMediaItem) return DEFAULT_FILTERS;
    return itemFilters[activeMediaItem.id] ?? DEFAULT_FILTERS;
  }, [activeMediaItem, itemFilters]);

  const getMediaFiltersForItem = useCallback(
    (item: MediaItem | null | undefined) =>
      item ? itemFilters[item.id] ?? DEFAULT_FILTERS : DEFAULT_FILTERS,
    [itemFilters],
  );

  const selectMediaForOutput = useCallback((item: MediaItem | null) => {
    setActiveMediaItem(item);
  }, []);

  const updateVideoSettings = useCallback(
    (settings: Partial<VideoSettings>) => {
      setVideoSettings((prev) => ({ ...prev, ...settings }));
    },
    []
  );

  const updateMediaFilters = useCallback(
    (filters: Partial<MediaFilters>) => {
      if (!activeMediaItem) return;
      setItemFilters((prev) => ({
        ...prev,
        [activeMediaItem.id]: {
          ...(prev[activeMediaItem.id] ?? DEFAULT_FILTERS),
          ...filters,
        },
      }));
    },
    [activeMediaItem]
  );

  const updateMediaFiltersForItem = useCallback(
    (item: MediaItem | null | undefined, filters: Partial<MediaFilters>) => {
      if (!item) return;
      setItemFilters((prev) => ({
        ...prev,
        [item.id]: {
          ...(prev[item.id] ?? DEFAULT_FILTERS),
          ...filters,
        },
      }));
    },
    [],
  );

  // Resetting the filters leaves how the media fits the screen as it was.
  const resetMediaFilters = useCallback(() => {
    if (!activeMediaItem) return;
    setItemFilters((prev) => ({
      ...prev,
      [activeMediaItem.id]: { ...DEFAULT_FILTERS, fit: prev[activeMediaItem.id]?.fit },
    }));
  }, [activeMediaItem]);

  const resetMediaFiltersForItem = useCallback(
    (item: MediaItem | null | undefined) => {
      if (!item) return;
      setItemFilters((prev) => ({
        ...prev,
        [item.id]: { ...DEFAULT_FILTERS, fit: prev[item.id]?.fit },
      }));
    },
    [],
  );

  const mediaFilterCSS = useMemo(() => filtersToCSS(mediaFilters), [mediaFilters]);

  const addMediaFile = useCallback(async (folderId: string) => {
    try {
      const folder = folders.find(f => f.id === folderId);
      if (!folder) throw new Error("Folder not found");

      const fileSelection = await window.electronAPI.selectMediaFile();
      if (!fileSelection) return null;

      const targetPath = `${folder.path}/${fileSelection.name}`;
      const success = await window.electronAPI.copyMediaFile(fileSelection.path, targetPath);
      
      if (success) {
        // Trigger a refresh/reload by creating a new identity for the folders array
        setFolders(prev => [...prev]);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to add media file:", error);
      throw error;
    }
  }, [folders]);

  const createFolder = useCallback(async (name: string, parentPath?: string) => {
    try {
      let targetParent = parentPath;
      if (!targetParent) {
        const result = await window.electronAPI.selectFolder();
        if (!result) return null;
        targetParent = result.path;
      }

      const newPath = await window.electronAPI.createDirectory(targetParent, name);

      // Auto-add the folder to the app
      const newFolder = await addMediaFolder(newPath);
      setFolders(await listMediaFolders());
      setSelectedFolderId(newFolder.id);

      return newFolder;
    } catch (error) {
      console.error("Failed to create folder:", error);
      throw error;
    }
  }, []);

  const renameFolder = useCallback(async (id: string, newName: string) => {
    try {
      const folder = folders.find(f => f.id === id);
      if (!folder) throw new Error("Folder not found");
      
      const normalizedPath = folder.path.replace(/\\/g, '/');
      const parts = normalizedPath.split('/');
      parts.pop();
      const parentPath = parts.join('/');
      const newPath = `${parentPath}/${newName}`;
      
      if (folder.path === newPath) return true; // No change

      await window.electronAPI.renameDirectory(folder.path, newPath);

      // The renamed folder is a new media folder to Rust; the old one is gone.
      const renamed = await addMediaFolder(newPath);
      await removeMediaFolder(id);
      setFolders(await listMediaFolders());
      if (selectedFolderId === id) {
        setSelectedFolderId(renamed.id);
      }

      return true;
    } catch (error) {
      console.error("Failed to rename folder:", error);
      throw error;
    }
  }, [folders, selectedFolderId]);

  const renameMediaItem = useCallback(
    async (item: MediaItem, newName: string) => {
      const mediaType = getMediaType(newName) ?? item.type;
      const result = await window.electronAPI.renameMediaFile(item.path, newName);
      const nextItem: MediaItem = {
        ...item,
        id: createMediaId(item.folderId, result.name),
        name: result.name,
        type: mediaType,
        path: result.path,
        url: createMediaUrl(result.path),
        lastModified: Date.now(),
      };

      setAllMediaItems((prev) =>
        prev.map((current) => (current.id === item.id ? nextItem : current)),
      );
      setActiveMediaItem((current) =>
        current?.id === item.id ? nextItem : current,
      );
      return nextItem;
    },
    [],
  );

  const deleteMediaItem = useCallback(async (item: MediaItem) => {
    await window.electronAPI.deleteMediaFile(item.path);
    setAllMediaItems((prev) =>
      prev.filter((current) => current.id !== item.id),
    );
    setActiveMediaItem((current) => (current?.id === item.id ? null : current));
  }, []);

  return {
    folders,
    mediaItems,
    allMediaItems,
    images,
    videos,
    isLoading,
    selectedFolderId,
    setSelectedFolderId,
    addFolder,
    removeFolder,
    refreshMedia,
    activeMediaItem,
    selectMediaForOutput,
    videoSettings,
    updateVideoSettings,
    mediaFilters,
    getMediaFiltersForItem,
    updateMediaFilters,
    updateMediaFiltersForItem,
    resetMediaFilters,
    resetMediaFiltersForItem,
    mediaFilterCSS,
    addMediaFile,
    createFolder,
    renameFolder,
    renameMediaItem,
    deleteMediaItem,
  };
}
