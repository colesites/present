"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { Category } from "../../../shared/types";
import {
  createLocalCategory,
  readOrgCategories,
  removeCategoryLocal,
  replaceOrgCategories,
  upsertCategory,
} from "../offline/localData";

const DEFAULT_CATEGORY_NAMES = ["Songs", "Flows", "Hymns", "Notes"];

const normalizeCategoryName = (name: string) => name.trim().toLowerCase();

export function useCategories(input: {
  orgId: Id<"organizations"> | null;
  userId: string | null;
}) {
  const { orgId, userId } = input;
  const workspaceId = (orgId as string | null) ?? "personal";
  const [localCategories, setLocalCategories] = useState<Category[]>(() =>
    readOrgCategories(workspaceId),
  );
  // Use plain Convex query - no caching to avoid data conflicts
  const remoteCategories = useQuery(
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

  const refreshLocalCategories = () => {
    setLocalCategories(readOrgCategories(workspaceId));
  };

  useEffect(() => {
    refreshLocalCategories();
  }, [workspaceId]);

  useEffect(() => {
    if (remoteCategories === undefined) {
      return;
    }

    replaceOrgCategories(workspaceId, remoteCategories as Category[]);
    refreshLocalCategories();
  }, [remoteCategories, workspaceId]);

  // Ensure default library categories exist for each org once per app session.
  useEffect(() => {
    const scopeKey = (orgId ?? userId) as unknown as string | null;
    if (!scopeKey || remoteCategories === undefined) {
      return;
    }

    if (ensuredScopeRef.current === scopeKey) {
      return;
    }

    ensuredScopeRef.current = scopeKey;
    void (orgId
      ? ensureDefaultCategories({ orgId } as any)
      : ensureDefaultCategories({ userId } as any));
  }, [orgId, userId, remoteCategories, ensureDefaultCategories]);

  useEffect(() => {
    const existingByName = new Set(
      readOrgCategories(workspaceId).map((category) =>
        normalizeCategoryName(category.name),
      ),
    );

    let didCreateDefault = false;
    for (const [index, name] of DEFAULT_CATEGORY_NAMES.entries()) {
      if (existingByName.has(normalizeCategoryName(name))) {
        continue;
      }
      createLocalCategory(workspaceId, {
        name,
        isDefault: true,
        order: index,
      });
      didCreateDefault = true;
    }

    if (didCreateDefault) {
      refreshLocalCategories();
    }
  }, [workspaceId]);

  const categories = useMemo(() => localCategories, [localCategories]);

  const createNewCategory = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;

    const existing = readOrgCategories(workspaceId).find(
      (category) =>
        normalizeCategoryName(category.name) === normalizeCategoryName(trimmedName),
    );
    if (existing) {
      return String(existing._id);
    }

    if (orgId) {
      try {
        const id = await createCategory({ orgId, name: trimmedName } as any);
        const nextCategory = upsertCategory(workspaceId, {
          _id: id as Category["_id"],
          _creationTime: Date.now(),
          orgId: workspaceId as Category["orgId"],
          name: trimmedName,
          isDefault: false,
          order: readOrgCategories(workspaceId).length,
          createdAt: Date.now(),
        });
        refreshLocalCategories();
        return String(nextCategory._id);
      } catch (error) {
        if (typeof navigator !== "undefined" && navigator.onLine) {
          throw error;
        }
        const localCategory = createLocalCategory(workspaceId, { name: trimmedName });
        refreshLocalCategories();
        return String(localCategory._id);
      }
    }

    let effectiveUserId = userId;
    if (!effectiveUserId) {
      try {
        const ensured = await ensureCurrentUser({});
        effectiveUserId = (ensured as { userId?: string } | null)?.userId ?? null;
      } catch (error) {
        if (typeof navigator !== "undefined" && navigator.onLine) {
          throw error;
        }
      }
    }
    if (!effectiveUserId) {
      const localCategory = createLocalCategory(workspaceId, { name: trimmedName });
      refreshLocalCategories();
      return String(localCategory._id);
    }

    try {
      const id = await createCategory({ userId: effectiveUserId, name: trimmedName } as any);
      const nextCategory = upsertCategory(workspaceId, {
        _id: id as Category["_id"],
        _creationTime: Date.now(),
        orgId: workspaceId as Category["orgId"],
        name: trimmedName,
        isDefault: false,
        order: readOrgCategories(workspaceId).length,
        createdAt: Date.now(),
      });
      refreshLocalCategories();
      return String(nextCategory._id);
    } catch (error) {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        throw error;
      }
      const localCategory = createLocalCategory(workspaceId, { name: trimmedName });
      refreshLocalCategories();
      return String(localCategory._id);
    }
  };

  const renameExistingCategory = async (
    categoryId: any,
    name: string,
  ) => {
    await renameCategory({ categoryId, name } as any);
    const existing = readOrgCategories(workspaceId).find(
      (category) => String(category._id) === String(categoryId),
    );
    if (existing) {
      upsertCategory(workspaceId, { ...existing, name });
      refreshLocalCategories();
    }
  };

  const deleteCategory = async (categoryId: Id<"categories">) => {
    await removeCategory({ categoryId } as any);
    removeCategoryLocal(workspaceId, String(categoryId));
    refreshLocalCategories();
  };

  return {
    categories: categories as any,
    createNewCategory,
    renameExistingCategory,
    deleteCategory,
  };
}
