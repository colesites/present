"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { parseLyricsToSlides } from "../../../renderer/shared/lib/lyrics";
import type { LibraryItem, ContentSource } from "../../../shared/types";

export function useLibrary(
  input: { orgId: string | null; userId: string | null },
  contentSource: ContentSource,
) {
  const { orgId } = input;
  // Use unified library API which handles workspace routing and authorization
  const libraryItems = useQuery(
    api.libraries.list,
    { workspaceId: orgId ?? undefined }
  ) as
    | LibraryItem[]
    | undefined;

  const createLibraryItem = useMutation(api.libraries.create);
  const ensureCurrentUser = useMutation(api.users.ensureCurrent);
  const updateLibraryItem = useMutation(api.libraries.update);
  const removeLibraryItem = useMutation(api.libraries.remove);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [prevItems, setPrevItems] = useState(libraryItems);
  if (libraryItems !== prevItems) {
    setPrevItems(libraryItems);
    if (libraryItems && selectedItemId) {
      const exists = libraryItems.some((s) => s._id === selectedItemId);
      if (!exists) {
        setSelectedItemId(null);
      }
    }
  }

  const selectedItem = useMemo(() => {
    if (!selectedItemId || !libraryItems) return null;
    return libraryItems.find((s) => s._id === selectedItemId) ?? null;
  }, [selectedItemId, libraryItems]);

  const filteredItems = useMemo(() => {
    if (!libraryItems) return [];

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
    let effectiveUserId = input.userId;
    if (!orgId && !effectiveUserId) {
      const ensured = await ensureCurrentUser({});
      effectiveUserId = (ensured as { userId?: string } | null)?.userId ?? null;
    }
    if (!orgId && !effectiveUserId) {
      throw new Error("Account not ready yet. Please wait a moment and try again.");
    }
    const slides = parseLyricsToSlides(body);
    const id = await createLibraryItem({
      workspaceId: orgId ?? undefined,
      title: title.trim(),
      body,
      slides,
      categoryId: categoryId as any,
    });
    return id;
  };

  const updateExistingItem = async (
    itemId: string,
    title: string,
    body: string,
  ) => {
    const slides = parseLyricsToSlides(body);
    await updateLibraryItem({ 
      workspaceId: orgId ?? undefined,
      libraryId: itemId, 
      title, 
      body, 
      slides 
    });
  };

  const deleteItem = async (itemId: string) => {
    await removeLibraryItem({ 
      workspaceId: orgId ?? undefined,
      libraryId: itemId 
    });
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
  };

  return {
    libraryItems: (libraryItems ?? []) as any,
    isLoading: Boolean(orgId) && libraryItems === undefined,
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
