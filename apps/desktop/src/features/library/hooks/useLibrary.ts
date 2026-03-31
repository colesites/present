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

const normalizeSearchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const scoreLibrarySearchMatch = (
  item: Pick<LibraryItem, "title" | "body" | "_creationTime">,
  rawQuery: string,
): number => {
  const query = normalizeSearchText(rawQuery);
  if (!query) {
    return 0;
  }

  const title = normalizeSearchText(item.title);
  const body = normalizeSearchText(item.body);
  const combined = `${title} ${body}`.trim();

  if (!combined) {
    return 0;
  }

  if (title === query) {
    return 1200;
  }

  if (title.includes(query)) {
    return 900 + query.length;
  }

  if (combined.includes(query)) {
    return 700 + query.length;
  }

  const tokens = query.split(" ").filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return 0;
  }

  let matchedTokens = 0;
  let score = 0;

  for (const token of tokens) {
    if (title.includes(token)) {
      matchedTokens += 1;
      score += 6;
      continue;
    }

    if (body.includes(token)) {
      matchedTokens += 1;
      score += 3;
    }
  }

  const requiredMatches =
    tokens.length === 1
      ? 1
      : tokens.length <= 3
        ? 2
        : Math.max(2, Math.ceil(tokens.length * 0.4));

  if (matchedTokens < requiredMatches) {
    return 0;
  }

  return score + matchedTokens;
};

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
      result = result
        .map((item) => ({
          item,
          score: scoreLibrarySearchMatch(item, searchQuery),
        }))
        .filter((entry) => entry.score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            right.item._creationTime - left.item._creationTime,
        )
        .map((entry) => entry.item);
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
