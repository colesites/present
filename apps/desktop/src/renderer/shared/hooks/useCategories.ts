"use client";

import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";

export function useCategories(input: {
  orgId: Id<"organizations"> | null;
  userId: string | null;
}) {
  const { orgId, userId } = input;
  // Use plain Convex query - no caching to avoid data conflicts
  const categories = useQuery(
    orgId ? api.categories.listByOrg : api.personalCategories.listByUser,
    orgId ? { orgId } : userId ? { userId: userId as any } : "skip",
  );
  const ensureDefaultCategories = useMutation(
    orgId ? api.categories.ensureDefaults : api.personalCategories.ensureDefaults,
  );
  const createCategory = useMutation(orgId ? api.categories.create : api.personalCategories.create);
  const ensureCurrentUser = useMutation(api.users.ensureCurrent);
  const removeCategory = useMutation(orgId ? api.categories.remove : api.personalCategories.remove);
  const renameCategory = useMutation(orgId ? api.categories.update : api.personalCategories.update);

  const ensuredScopeRef = useRef<string | null>(null);

  // Ensure default library categories exist for each org once per app session.
  useEffect(() => {
    const scopeKey = (orgId ?? userId) as unknown as string | null;
    if (!scopeKey || categories === undefined) {
      return;
    }

    if (ensuredScopeRef.current === scopeKey) {
      return;
    }

    ensuredScopeRef.current = scopeKey;
    void (orgId
      ? ensureDefaultCategories({ orgId } as any)
      : ensureDefaultCategories({ userId } as any));
  }, [orgId, userId, categories, ensureDefaultCategories]);

  const createNewCategory = async (name: string) => {
    if (!name.trim()) return null;
    if (orgId) {
      const id = await createCategory({ orgId, name: name.trim() } as any);
      return id;
    }
    let effectiveUserId = userId;
    if (!effectiveUserId) {
      const ensured = await ensureCurrentUser({});
      effectiveUserId = (ensured as { userId?: string } | null)?.userId ?? null;
    }
    if (!effectiveUserId) {
      throw new Error("Account not ready yet. Please wait a moment and try again.");
    }
    return await createCategory({ userId: effectiveUserId, name: name.trim() } as any);
  };

  const renameExistingCategory = async (
    categoryId: any,
    name: string,
  ) => {
    await renameCategory({ categoryId, name } as any);
  };

  const deleteCategory = async (categoryId: Id<"categories">) => {
    await removeCategory({ categoryId } as any);
  };

  return {
    categories: (categories ?? []) as any,
    createNewCategory,
    renameExistingCategory,
    deleteCategory,
  };
}
