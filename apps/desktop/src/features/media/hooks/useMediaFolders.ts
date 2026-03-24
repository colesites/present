"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// Types for media items
export type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video";
  url: string; // local-media:// protocol URL
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

export type MediaFilters = {
  brightness: number; 
  contrast: number; 
  saturation: number; 
  blur: number; 
  grayscale: number; 
  sepia: number; 
  hueRotate: number; 
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

// IndexedDB helpers for storing folders
const DB_NAME = "present-media-db";
const STORE_NAME = "folder-handles"; // Keeping name for backward compatibility

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

async function saveFolderDB(
  id: string,
  name: string,
  path: string
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, name, path });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFoldersDB(): Promise<
  { id: string; name: string; path?: string; handle?: unknown }[]
> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function removeFolderDB(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clean up duplicate folders in IndexedDB
async function cleanupDuplicateFolders(): Promise<void> {
  const folders = await loadFoldersDB();
  const seenPaths = new Set<string>();
  const toDelete: string[] = [];

  for (const folder of folders) {
    if (!folder.path) {
      // Legacy browser handle - delete it since we moved to Electron paths
      toDelete.push(folder.id);
      continue;
    }
    
    if (seenPaths.has(folder.path)) {
      toDelete.push(folder.id);
    } else {
      seenPaths.add(folder.path);
    }
  }

  for (const id of toDelete) {
    await removeFolderDB(id);
  }
}

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
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Load saved folders on mount
  useEffect(() => {
    let isMounted = true;

    async function loadSavedFolders() {
      try {
        await cleanupDuplicateFolders();
        const saved = await loadFoldersDB();
        const validFolders: MediaFolder[] = [];
        
        for (const f of saved) {
          if (f.path) {
            validFolders.push({ id: f.id, name: f.name, path: f.path });
          }
        }

        if (isMounted) {
          setFolders(validFolders);
        }
      } catch (error) {
        console.error("Failed to load saved folders:", error);
      }
    }

    loadSavedFolders();

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

      setIsLoading(true);
      const items: MediaItem[] = [];

      for (const folder of folders) {
        try {
          const files = await window.electronAPI.readFolder(folder.path);
          for (const file of files) {
            const mediaType = getMediaType(file.name);
            if (mediaType) {
              const fullPath = `${folder.path}/${file.name}`;
                items.push({
                  id: `${folder.id}-${file.name}`,
                  name: file.name,
                  type: mediaType,
                  url: `local-media://media${encodeURI(fullPath)}`,
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
      setIsLoading(false);
    }

    loadAllMedia();
  }, [folders]);



  const mediaItems = useMemo(() => {
    if (!selectedFolderId) return allMediaItems;
    return allMediaItems.filter((item) => item.folderId === selectedFolderId);
  }, [allMediaItems, selectedFolderId]);

  const addFolder = useCallback(async () => {
    try {
      const result = await window.electronAPI.selectFolder();
      if (!result) return null; // Cancelled

      const { id, name, path } = result;

      // Check if folder already exists
      const existingInState = folders.find((f) => f.path === path);
      if (existingInState) {
        setSelectedFolderId(existingInState.id);
        return existingInState;
      }

      await saveFolderDB(id, name, path);

      const newFolder: MediaFolder = { id, name, path };
      setFolders((prev) => [...prev, newFolder]);
      setSelectedFolderId(id);

      return newFolder;
    } catch (error) {
      console.error("Add folder error:", error);
      throw error;
    }
  }, [folders]);

  const removeFolder = useCallback(
    async (folderId: string) => {
      await removeFolderDB(folderId);
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

  const resetMediaFilters = useCallback(() => {
    if (!activeMediaItem) return;
    setItemFilters((prev) => ({
      ...prev,
      [activeMediaItem.id]: DEFAULT_FILTERS,
    }));
  }, [activeMediaItem]);

  const mediaFilterCSS = useMemo(() => filtersToCSS(mediaFilters), [mediaFilters]);

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
    updateMediaFilters,
    resetMediaFilters,
    mediaFilterCSS,
  };
}
