"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LibraryContent,
  LibraryItem,
  LibraryItemDraft,
  ContentSource,
} from "../../../shared/types";
import {
  createLocalLibraryItem,
  enqueueSyncOperation,
  readOrgLibraryItems,
  removeLibraryItemLocal,
  upsertLibraryItem,
} from "../../../renderer/shared/offline/localData";
import {
  buildSlidesFromBody,
  createComposedLibraryDraft,
  DEFAULT_CANVAS_SIZE,
  normalizeLibraryContent,
  normalizeLibraryItem,
  normalizeLibrarySlide,
  reorderLibrarySlides,
  slidesToBody,
} from "../lib/library-items";
import type { LibraryTextStyleDefaults } from "../lib/library-items";
import {
  useLibrarySearchModeStore,
  type LibrarySearchMode,
} from "../../../renderer/shared/store/librarySearchMode";

export type { LibrarySearchMode };

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

const scoreExactLibrarySearchMatch = (
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

  if (title === query) {
    return 1200;
  }

  if (title.includes(query)) {
    return 900 + query.length;
  }

  if (body.includes(query)) {
    return 700 + query.length;
  }

  if (combined.includes(query)) {
    return 600 + query.length;
  }

  return 0;
};

export function useLibrary(
  input: { orgId: string | null; userId: string | null },
  contentSource: ContentSource,
  options?: {
    defaultTextStyle?: LibraryTextStyleDefaults;
  },
) {
  const defaultTextStyle = options?.defaultTextStyle;
  const workspaceId = input.orgId ?? "personal";
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>(() =>
    readOrgLibraryItems(workspaceId).map((item) =>
      normalizeLibraryItem(item, defaultTextStyle),
    )
  );

  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchMode = useLibrarySearchModeStore((state) => state.searchMode);
  const setSearchMode = useLibrarySearchModeStore(
    (state) => state.setSearchMode,
  );

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setLibraryItems(
        readOrgLibraryItems(workspaceId).map((item) =>
          normalizeLibraryItem(item, defaultTextStyle),
        ),
      );
    }, 0);
    return () => {
      window.clearTimeout(timerId);
    };
  }, [defaultTextStyle, workspaceId]);

  useEffect(() => {
    if (selectedItemId) {
      const exists = libraryItems.some((s) => s._id === selectedItemId);
      if (!exists) {
        const timerId = window.setTimeout(() => {
          setSelectedItemId(null);
        }, 0);
        return () => {
          window.clearTimeout(timerId);
        };
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
      const scoreMatch =
        searchMode === "exact"
          ? scoreExactLibrarySearchMatch
          : scoreLibrarySearchMatch;
      result = result
        .map((item) => ({
          item,
          score: scoreMatch(item, searchQuery),
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
  }, [libraryItems, selectedCategoryId, searchMode, searchQuery, contentSource]);

  const createNewItem = async (
    title: string,
    body: string,
    categoryId?: string,
    content?: LibraryContent,
  ) => {
    return createItemFromDraft(
      {
        title,
        body,
        slides: buildSlidesFromBody(
          body,
          content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
          defaultTextStyle,
        ),
        content,
      },
      categoryId,
    );
  };

  const createItemFromDraft = async (
    draft: LibraryItemDraft,
    categoryId?: string,
  ) => {
    if (!draft.title.trim()) return null;

    const canvasSize =
      draft.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE;
    const slides =
      Array.isArray(draft.slides) && draft.slides.length > 0
        ? draft.slides.map((slide) =>
            normalizeLibrarySlide(slide, canvasSize, defaultTextStyle),
          )
        : buildSlidesFromBody(draft.body, canvasSize, defaultTextStyle);

    const nextItem = createLocalLibraryItem(workspaceId, {
      title: draft.title.trim(),
      body: draft.body,
      slides,
      content: normalizeLibraryContent(draft.content, slides),
      categoryId: categoryId as LibraryItem["categoryId"],
      userId: input.userId ?? undefined,
      createdAt: Date.now(),
    });
    setLibraryItems(
      readOrgLibraryItems(workspaceId).map((item) =>
        normalizeLibraryItem(item, defaultTextStyle),
      ),
    );
    enqueueSyncOperation(
      workspaceId,
      "library",
      String(nextItem._id),
      "create",
      nextItem,
    );
    return nextItem._id;
  };

  const saveExistingItem = async (
    itemId: string,
    input: LibraryItemDraft,
  ) => {
    const existing = libraryItems.find((item) => item._id === itemId);
    if (!existing) {
      return;
    }
    const slides =
      Array.isArray(input.slides) && input.slides.length > 0
        ? input.slides.map((slide) =>
            normalizeLibrarySlide(
              slide,
              input.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
              defaultTextStyle,
            ),
          )
        : buildSlidesFromBody(
            input.body,
            input.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
            defaultTextStyle,
          );
    const body =
      typeof input.body === "string" ? input.body : slidesToBody(slides);
    const content = normalizeLibraryContent(input.content, slides);
    const nextItem = upsertLibraryItem(workspaceId, {
      ...existing,
      title: input.title,
      body,
      slides,
      content,
      updatedAt: Date.now(),
    });
    setLibraryItems(
      readOrgLibraryItems(workspaceId).map((item) =>
        normalizeLibraryItem(item, defaultTextStyle),
      ),
    );
    enqueueSyncOperation(workspaceId, "library", itemId, "update", nextItem);
  };

  const updateExistingItem = async (
    itemId: string,
    title: string,
    body: string,
  ) => {
    const existing = libraryItems.find((item) => item._id === itemId);
    await saveExistingItem(itemId, {
      title,
      body,
      slides: buildSlidesFromBody(
        body,
        existing?.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
        defaultTextStyle,
      ),
      content: existing?.content,
    });
  };

  const createComposedItem = async (
    title: string,
    itemIds: string[],
    categoryId?: string,
    // Optional: per-source-item slide selections, keyed by libraryId. Each
    // value is the list of slide indexes to include (in the order they
    // appear in the source item). When a libraryId is omitted, ALL slides
    // from that source are included (back-compat behaviour).
    slideSelections?: Record<string, number[]>,
  ) => {
    // Look up items by id and rebuild the list in the order of `itemIds`.
    // The old code used `libraryItems.filter(...)`, which silently dropped
    // the selection order and produced the "song 3 above song 2" bug the
    // operator reported.
    const byId = new Map(libraryItems.map((item) => [String(item._id), item]));
    const selectedItems = itemIds
      .map((id) => byId.get(String(id)))
      .filter((item): item is (typeof libraryItems)[number] =>
        Boolean(item),
      );
    if (selectedItems.length === 0 || !title.trim()) {
      return null;
    }
    const draft = createComposedLibraryDraft(
      title.trim(),
      selectedItems,
      defaultTextStyle,
      slideSelections,
    );
    return createNewItem(
      draft.title,
      draft.body,
      categoryId,
      draft.content,
    );
  };

  const reorderItemSlides = async (
    itemId: string,
    fromIndex: number,
    toIndex: number,
  ) => {
    const existing = libraryItems.find((item) => item._id === itemId);
    if (!existing) {
      return;
    }
    const slides = reorderLibrarySlides(existing.slides, fromIndex, toIndex);
    await saveExistingItem(itemId, {
      title: existing.title,
      body: slidesToBody(slides),
      slides,
      content: existing.content,
    });
  };

  const deleteItem = async (itemId: string) => {
    removeLibraryItemLocal(workspaceId, itemId);
    setLibraryItems(
      readOrgLibraryItems(workspaceId).map((item) =>
        normalizeLibraryItem(item, defaultTextStyle),
      ),
    );
    enqueueSyncOperation(workspaceId, "library", itemId, "delete", { id: itemId });
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
  };

  return {
    libraryItems,
    isLoading: false,
    filteredItems,
    selectedItem,
    selectedItemId,
    selectedCategoryId,
    searchQuery,
    searchMode,
    setSelectedItemId,
    setSelectedCategoryId,
    setSearchQuery,
    setSearchMode,
    createNewItem,
    createItemFromDraft,
    createComposedItem,
    updateExistingItem,
    saveExistingItem,
    reorderItemSlides,
    deleteItem,
  };
}
