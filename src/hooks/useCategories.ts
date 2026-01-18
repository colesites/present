"use client";

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

export function useCategories(orgId: Id<"organizations"> | null) {
  // Use plain Convex query - no caching to avoid data conflicts
  const categories = useQuery(
    api.categories.listByOrg,
    orgId ? { orgId } : "skip",
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
