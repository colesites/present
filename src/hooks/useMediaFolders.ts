"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// Types for media items
export type MediaItem = {
  id: string;
  name: string;
  type: "image" | "video";
  url: string; // Object URL for display
  file: File;
  folderId: string;
};

export type MediaFolder = {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  needsPermission?: boolean;
};

export type VideoSettings = {
  loop: boolean;
  muted: boolean;
  volume: number;
};

export type MediaFilters = {
  brightness: number; // 0-200, 100 is default
  contrast: number; // 0-200, 100 is default
  saturation: number; // 0-200, 100 is default
  blur: number; // 0-20, 0 is default
  grayscale: number; // 0-100, 0 is default
  sepia: number; // 0-100, 0 is default
  hueRotate: number; // 0-360, 0 is default
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

// IndexedDB helpers for storing folder handles
const DB_NAME = "present-media-db";
const STORE_NAME = "folder-handles";

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

async function saveHandle(
  id: string,
  name: string,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, name, handle });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandles(): Promise<
  { id: string; name: string; handle: FileSystemDirectoryHandle }[]
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

async function removeHandle(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Find a folder by name in IndexedDB
async function findHandleByName(name: string): Promise<{
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
} | null> {
  const handles = await loadHandles();
  return handles.find((h) => h.name === name) ?? null;
}

// Clean up duplicate folders in IndexedDB (keep only the first one by name)
async function cleanupDuplicateHandles(): Promise<void> {
  const handles = await loadHandles();
  const seenNames = new Set<string>();
  const toDelete: string[] = [];

  for (const handle of handles) {
    if (seenNames.has(handle.name)) {
      toDelete.push(handle.id);
    } else {
      seenNames.add(handle.name);
    }
  }

  for (const id of toDelete) {
    await removeHandle(id);
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

// Convert filters to CSS filter string
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

// LocalStorage keys
const FILTERS_STORAGE_KEY = "present-media-filters";

// Load filters from localStorage
function loadFiltersFromStorage(): Record<string, MediaFilters> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

// Save filters to localStorage
function saveFiltersToStorage(filters: Record<string, MediaFilters>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch (e) {
    console.error("Failed to save filters:", e);
  }
}

// Convert blob URL to data URL for cross-window communication
export async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  try {
    const response = await fetch(blobUrl);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Failed to convert blob to data URL:", e);
    return blobUrl; // Fallback to original
  }
}

export function useMediaFolders() {
  const [folders, setFolders] = useState<MediaFolder[]>([]);
  // Store ALL media from all folders
  const [allMediaItems, setAllMediaItems] = useState<MediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Load saved folder handles on mount
  useEffect(() => {
    let isMounted = true;

    async function loadSavedFolders() {
      try {
        // First, clean up any duplicate folders in IndexedDB
        await cleanupDuplicateHandles();

        const saved = await loadHandles();
        const validFolders: MediaFolder[] = [];
        const seenNames = new Set<string>();

        for (const { id, name, handle } of saved) {
          // Skip duplicates by name (shouldn't happen after cleanup, but just in case)
          if (seenNames.has(name)) continue;
          seenNames.add(name);

          // Verify we still have permission
          const permission = await handle.queryPermission({ mode: "read" });
          if (permission === "granted") {
            validFolders.push({ id, name, handle });
          } else if (permission === "prompt") {
            // Keep it but mark as needing permission
            validFolders.push({ id, name, handle, needsPermission: true });
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

  // Load ALL media from ALL folders when folders change (NOT when selectedFolderId changes)
  useEffect(() => {
    async function loadAllMedia() {
      if (folders.length === 0) {
        setAllMediaItems([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      const items: MediaItem[] = [];

      // Clean up previous object URLs
      for (const item of allMediaItems) {
        URL.revokeObjectURL(item.url);
      }

      for (const folder of folders) {
        try {
          // Request permission if needed
          const permission = await folder.handle.queryPermission({
            mode: "read",
          });
          if (permission !== "granted") {
            const newPermission = await folder.handle.requestPermission({
              mode: "read",
            });
            if (newPermission !== "granted") continue;
          }

          // Read files from folder
          for await (const entry of folder.handle.values()) {
            if (entry.kind === "file") {
              const mediaType = getMediaType(entry.name);
              if (mediaType) {
                const file = await entry.getFile();
                const url = URL.createObjectURL(file);
                items.push({
                  id: `${folder.id}-${entry.name}`,
                  name: entry.name,
                  type: mediaType,
                  url,
                  file,
                  folderId: folder.id,
                });
              }
            }
          }
        } catch (error) {
          console.error(`Failed to load media from ${folder.name}:`, error);
        }
      }

      // Sort by name
      items.sort((a, b) => a.name.localeCompare(b.name));
      setAllMediaItems(items);
      setIsLoading(false);
    }

    loadAllMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders]); // Only reload when folders change, NOT selectedFolderId

  // Reconnect a folder (request permission)
  const reconnectFolder = useCallback(
    async (folderId: string) => {
      const folder = folders.find((f) => f.id === folderId);
      if (!folder) return;

      try {
        const permission = await folder.handle.requestPermission({
          mode: "read",
        });
        if (permission === "granted") {
          setFolders((prev) =>
            prev.map((f) =>
              f.id === folderId ? { ...f, needsPermission: false } : f
            )
          );
        }
      } catch (error) {
        console.error("Failed to request permission:", error);
      }
    },
    [folders]
  );

  // Reconnect ALL folders that need permission
  const reconnectAllFolders = useCallback(async () => {
    const brokenFolders = folders.filter((f) => f.needsPermission);
    if (brokenFolders.length === 0) return;

    for (const folder of brokenFolders) {
      try {
        const permission = await folder.handle.requestPermission({
          mode: "read",
        });
        if (permission === "granted") {
          setFolders((prev) =>
            prev.map((f) =>
              f.id === folder.id ? { ...f, needsPermission: false } : f
            )
          );
        }
      } catch (error) {
        console.error(`Failed to reconnect folder ${folder.name}:`, error);
      }
    }
  }, [folders]);

  // Filter media items by selected folder (client-side, no reload)
  const mediaItems = useMemo(() => {
    if (!selectedFolderId) return allMediaItems;
    return allMediaItems.filter((item) => item.folderId === selectedFolderId);
  }, [allMediaItems, selectedFolderId]);

  // Add a new folder
  const addFolder = useCallback(async () => {
    try {
      // Check if File System Access API is supported
      if (!("showDirectoryPicker" in window)) {
        throw new Error("Your browser doesn't support folder selection");
      }

      const handle = await window.showDirectoryPicker({
        mode: "read",
      });

      const name = handle.name;

      // Check if folder already exists in IndexedDB (source of truth)
      const existingInDB = await findHandleByName(name);
      if (existingInDB) {
        // Folder already exists - just select it
        setSelectedFolderId(existingInDB.id);
        // Make sure it's in state too
        setFolders((prev) => {
          const inState = prev.find((f) => f.id === existingInDB.id);
          if (!inState) {
            return [
              ...prev,
              { id: existingInDB.id, name, handle: existingInDB.handle },
            ];
          }
          return prev;
        });
        return { id: existingInDB.id, name, handle: existingInDB.handle };
      }

      // Also check current state (in case IndexedDB check missed it)
      const existingInState = folders.find((f) => f.name === name);
      if (existingInState) {
        setSelectedFolderId(existingInState.id);
        return existingInState;
      }

      const id = `folder-${Date.now()}`;

      // Save to IndexedDB for persistence
      await saveHandle(id, name, handle);

      const newFolder: MediaFolder = { id, name, handle };

      // Update state with new folder - the useEffect will load media
      setFolders((prev) => [...prev, newFolder]);
      setSelectedFolderId(id); // Auto-select the new folder

      return newFolder;
    } catch (error) {
      const err = error as Error;
      // User cancelled the picker (clicked X or pressed Escape)
      if (err.name === "AbortError") {
        return null;
      }
      // User denied permission in the browser dialog
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        throw new Error(
          "Permission denied. Please allow access to add folders."
        );
      }
      // Other errors
      console.error("Add folder error:", err.name, err.message);
      throw error;
    }
  }, [folders]);

  // Remove a folder
  const removeFolder = useCallback(
    async (folderId: string) => {
      await removeHandle(folderId);

      // Revoke URLs for items from this folder
      setAllMediaItems((prev) => {
        const toRemove = prev.filter((item) => item.folderId === folderId);
        for (const item of toRemove) {
          URL.revokeObjectURL(item.url);
        }
        return prev.filter((item) => item.folderId !== folderId);
      });

      setFolders((prev) => prev.filter((f) => f.id !== folderId));

      // If removed folder was selected, clear selection
      if (selectedFolderId === folderId) {
        setSelectedFolderId(null);
      }
    },
    [selectedFolderId]
  );

  // Refresh media from all folders
  const refreshMedia = useCallback(async () => {
    // Trigger reload by updating folders reference
    setFolders((prev) => [...prev]);
  }, []);

  // Filter by type (uses filtered mediaItems, not allMediaItems)
  const images = useMemo(
    () => mediaItems.filter((item) => item.type === "image"),
    [mediaItems]
  );
  const videos = useMemo(
    () => mediaItems.filter((item) => item.type === "video"),
    [mediaItems]
  );

  // Select a media item for output
  const [activeMediaItem, setActiveMediaItem] = useState<MediaItem | null>(
    null
  );

  // Video settings (global for now)
  const [videoSettings, setVideoSettings] = useState<VideoSettings>({
    loop: true,
    muted: false,
    volume: 1,
  });

  // Per-item media filters - stored by item ID, persisted to localStorage
  const [itemFilters, setItemFilters] = useState<Record<string, MediaFilters>>(
    () => loadFiltersFromStorage()
  );

  // Save filters to localStorage whenever they change
  useEffect(() => {
    saveFiltersToStorage(itemFilters);
  }, [itemFilters]);

  // Get current item's filters (or defaults if none set)
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

  // Get CSS filter string for current item's filters
  const mediaFilterCSS = useMemo(
    () => filtersToCSS(mediaFilters),
    [mediaFilters]
  );

  return {
    folders,
    mediaItems, // This is now filtered by selectedFolderId
    allMediaItems, // All items from all folders
    images,
    videos,
    isLoading,
    selectedFolderId,
    setSelectedFolderId,
    addFolder,
    removeFolder,
    refreshMedia,
    reconnectFolder,
    reconnectAllFolders,
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
