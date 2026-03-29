"use client";

import { useEffect, useMemo, useState } from "react";
import { parseLyricsToSlides } from "../../../renderer/shared/lib/lyrics";
import type { LibraryItem, ContentSource } from "../../../shared/types";
import {
  createLocalLibraryItem,
  enqueueSyncOperation,
  readOrgLibraryItems,
  removeLibraryItemLocal,
  upsertLibraryItem,
} from "../../../renderer/shared/offline/localData";

export function useLibrary(
  input: { orgId: string | null; userId: string | null },
  contentSource: ContentSource,
) {
  const workspaceId = input.orgId ?? "personal";
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>(() =>
    readOrgLibraryItems(workspaceId)
  );

  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    setLibraryItems(readOrgLibraryItems(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (selectedItemId) {
      const exists = libraryItems.some((s) => s._id === selectedItemId);
      if (!exists) {
        setSelectedItemId(null);
      }
    }
  }, [libraryItems, selectedItemId]);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return libraryItems.find((s) => s._id === selectedItemId) ?? null;
  }, [selectedItemId, libraryItems]);

  const filteredItems = useMemo(() => {
    let result = libraryItems;

    // Filter by category
    if (selectedCategoryId) {
      result = result.filter((s) => s.categoryId === selectedCategoryId);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.body.toLowerCase().includes(query),
      );
    }

    // Filter by content source
    // For now, if "community" is selected, we show nothing (placeholder for public API)
    if (contentSource === "community") {
      return [];
    }

    return result;
  }, [libraryItems, selectedCategoryId, searchQuery, contentSource]);

  const createNewItem = async (
    title: string,
    body: string,
    categoryId?: string,
  ) => {
    if (!title.trim()) return null;
    const slides = parseLyricsToSlides(body);
    const nextItem = createLocalLibraryItem(workspaceId, {
      title: title.trim(),
      body,
      slides,
      categoryId: categoryId as LibraryItem["categoryId"],
      userId: input.userId ?? undefined,
      createdAt: Date.now(),
    });
    setLibraryItems(readOrgLibraryItems(workspaceId));
    enqueueSyncOperation(workspaceId, "library", String(nextItem._id), "create", nextItem);
    return nextItem._id;
  };

  const updateExistingItem = async (
    itemId: string,
    title: string,
    body: string,
  ) => {
    const slides = parseLyricsToSlides(body);
    const existing = libraryItems.find((item) => item._id === itemId);
    if (!existing) {
      return;
    }
    const nextItem = upsertLibraryItem(workspaceId, {
      ...existing,
      title,
      body,
      slides,
      updatedAt: Date.now(),
    });
    setLibraryItems(readOrgLibraryItems(workspaceId));
    enqueueSyncOperation(workspaceId, "library", itemId, "update", nextItem);
  };

  const deleteItem = async (itemId: string) => {
    removeLibraryItemLocal(workspaceId, itemId);
    setLibraryItems(readOrgLibraryItems(workspaceId));
    enqueueSyncOperation(workspaceId, "library", itemId, "delete", { id: itemId });
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
  };

  return {
    libraryItems: libraryItems as any,
    isLoading: false,
    filteredItems,
    selectedItem,
    selectedItemId,
    selectedCategoryId,
    searchQuery,
    setSelectedItemId,
    setSelectedCategoryId,
    setSearchQuery,
    createNewItem,
    updateExistingItem,
    deleteItem,
  };
}
