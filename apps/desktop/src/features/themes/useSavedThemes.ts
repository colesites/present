"use client";

import { useEffect, useMemo, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Doc, Id } from "@present/backend/convex/_generated/dataModel";
import {
  getPresentPlanDefinition,
  resolvePresentPlanKey,
  type PresentThemeTier,
} from "@present/shared";
import { offlineList, offlineReplace } from "../../renderer/tauri/offline";
import { useDesktopSessionStore } from "../../renderer/shared/store/desktopSession";
import {
  isUntouchedOldSeed,
  lookFromStoredTheme,
  styleForText,
  type ThemeLook,
} from "./theme-look.mjs";

export type SavedTheme = {
  id: string;
  name: string;
  look: ThemeLook;
  order: number;
};

type ThemeRow = Doc<"themes">;

const hasStore = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Convex takes no `undefined` inside a saved object. */
const withoutUndefined = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;

const TIERS: PresentThemeTier[] = ["basic", "custom", "advanced"];
const tierKey = (workspace: string) => `present-theme-tier:${workspace}`;

const readCachedTier = (workspace: string): PresentThemeTier | null => {
  try {
    const value = window.localStorage.getItem(tierKey(workspace));
    return TIERS.includes(value as PresentThemeTier) ? (value as PresentThemeTier) : null;
  } catch {
    return null;
  }
};

/**
 * A workspace's saved themes, and which themes its people can use.
 *
 * Convex answers while online; each answer is kept in the offline store, so
 * the themes are there on a Sunday without a network. Saving needs the
 * network (`canSave`), as it needs the server to check the plan.
 */
export function useSavedThemes({
  workspaceId,
  enabled,
}: {
  /** The organization, or `null` for the personal workspace. */
  workspaceId: string | null;
  enabled: boolean;
}) {
  const { isAuthenticated } = useConvexAuth();
  const userId = useDesktopSessionStore((state) => state.user?.id ?? null);
  const planKey = useDesktopSessionStore((state) => state.user?.billing?.planKey ?? null);
  const workspaceKey = workspaceId ?? (userId ? `personal:${userId}` : null);

  const answer = useQuery(
    api.themes.list,
    enabled && isAuthenticated && userId ? { workspaceId } : "skip",
  );
  const [cached, setCached] = useState<{ key: string; rows: ThemeRow[] } | null>(null);

  useEffect(() => {
    if (!answer || !workspaceKey) return;
    try {
      window.localStorage.setItem(tierKey(workspaceKey), answer.tier);
    } catch {
      // A private window: the tier is worked out from the plan instead.
    }
    if (!hasStore()) return;
    void offlineReplace(
      workspaceKey,
      "theme",
      answer.themes.map((row) => [String(row._id), row] as [string, ThemeRow]),
    ).catch((): void => undefined);
  }, [answer, workspaceKey]);

  useEffect(() => {
    if (!enabled || answer || !workspaceKey || !hasStore()) return;
    let cancelled = false;
    void offlineList<ThemeRow>(workspaceKey, "theme")
      .then((documents) => {
        if (!cancelled) setCached({ key: workspaceKey, rows: documents.map((document) => document.body) });
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
    };
  }, [answer, enabled, workspaceKey]);

  const rows = answer?.themes ?? (cached && cached.key === workspaceKey ? cached.rows : null);
  const themes = useMemo<SavedTheme[] | null>(
    () =>
      rows
        ? rows
            .filter((row) => !isUntouchedOldSeed(row))
            .sort((left, right) => left.order - right.order)
            .map((row) => ({
              id: String(row._id),
              name: row.name,
              look: lookFromStoredTheme(row),
              order: row.order,
            }))
        : null,
    [rows],
  );

  const tier = useMemo<PresentThemeTier>(
    () =>
      answer?.tier ??
      (workspaceKey ? readCachedTier(workspaceKey) : null) ??
      getPresentPlanDefinition(resolvePresentPlanKey(planKey)).themes,
    [answer?.tier, planKey, workspaceKey],
  );

  const createTheme = useMutation(api.themes.create);
  const updateTheme = useMutation(api.themes.update);
  const removeTheme = useMutation(api.themes.remove);

  // Older versions of the app read `style` and `backgroundColor`, so a theme
  // saved here still shows and applies there.
  const legacyFields = (look: ThemeLook) => ({
    style: withoutUndefined(styleForText(look.text)),
    ...(look.background ? { backgroundColor: look.background } : {}),
    previewColor: look.background ?? "#000000",
  });

  return {
    themes,
    tier,
    signedIn: Boolean(userId),
    canSave: Boolean(answer),
    create: (name: string, look: ThemeLook) =>
      createTheme({ workspaceId, name, look, ...legacyFields(look) }),
    update: (id: string, patch: { name?: string; look?: ThemeLook }) =>
      updateTheme({
        themeId: id as Id<"themes">,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.look ? { look: patch.look, ...legacyFields(patch.look) } : {}),
      }),
    remove: (id: string) => removeTheme({ themeId: id as Id<"themes"> }),
  };
}
