"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useCachedConvexQuery } from "./useConvexCache";

export function useCategories(orgId: Id<"organizations"> | null) {
  // Use cached query for offline support
  const categories = useCachedConvexQuery(
    api.categories.listByOrg,
    orgId ? { orgId } : "skip",
    "categories",
  );
  const ensureDefaultCategories = useMutation(api.categories.ensureDefaults);
  const createCategory = useMutation(api.categories.create);
  const removeCategory = useMutation(api.categories.remove);
  const renameCategory = useMutation(api.categories.update);

  // Ensure default categories exist
  useEffect(() => {
    if (orgId && categories && categories.length === 0) {
      void ensureDefaultCategories({ orgId });
    }
  }, [orgId, categories, ensureDefaultCategories]);

  const createNewCategory = async (name: string) => {
    if (!orgId || !name.trim()) return null;
    const id = await createCategory({ orgId, name: name.trim() });
    return id;
  };

  const renameExistingCategory = async (
    categoryId: Id<"categories">,
    name: string,
  ) => {
    await renameCategory({ categoryId, name });
  };

  const deleteCategory = async (categoryId: Id<"categories">) => {
    await removeCategory({ categoryId });
  };

  return {
    categories: categories ?? [],
    createNewCategory,
    renameExistingCategory,
    deleteCategory,
  };
}
