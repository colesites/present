"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import { useDesktopSessionStore } from "../store/desktopSession";

export function useOrganization() {
  const { isAuthenticated } = useConvexAuth();
  const cachedUser = useDesktopSessionStore((state) => state.user);
  const cachedOrgId = useDesktopSessionStore((state) => state.orgId);
  const cachedOrganizations = useDesktopSessionStore(
    (state) => state.organizations,
  );
  
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const current = useQuery(
    api.users.getCurrentWithOrg,
    isAuthenticated ? {} : "skip",
  );
  const currentUser = useQuery(
    api.users.getCurrent,
    isAuthenticated ? {} : "skip",
  );
  const [ensuredOrgId, setEnsuredOrgId] = useState<Id<"organizations"> | null>(null);
  const [ensuredUserId, setEnsuredUserId] = useState<string | null>(null);
  const lastEnsuredRef = useRef<boolean>(false);

  // Initialize user on sign-in
  useEffect(() => {
    if (!isAuthenticated) {
      lastEnsuredRef.current = false;
      return;
    }

    if (lastEnsuredRef.current) {
      return;
    }
    lastEnsuredRef.current = true;

    void (async () => {
      try {
        const result = await ensureCurrent({});
        const userId = (result as { userId?: string } | null)?.userId;
        const orgId = (result as { orgId?: Id<"organizations"> } | null)?.orgId;
        if (userId) {
          setEnsuredUserId(userId);
        }
        if (orgId) {
          setEnsuredOrgId(orgId);
        }
      } catch (error) {
        console.error("Failed to ensure org scope:", error);
      }
    })();
  }, [isAuthenticated, ensureCurrent]);

  const cachedValidOrgId = useMemo(() => {
    if (!cachedOrgId || cachedOrgId === "personal") {
      return null;
    }

    return cachedOrganizations.some(
      (organization) =>
        organization.type === "organization" &&
        organization.id === cachedOrgId,
    )
      ? (cachedOrgId as Id<"organizations">)
      : null;
  }, [cachedOrgId, cachedOrganizations]);

  const canUseCachedIdentity = isAuthenticated || Boolean(cachedUser);

  // Prefer live Convex identity, but keep cached desktop identity usable while
  // the app is offline or reconnecting.
  const orgId = useMemo(
    () =>
      canUseCachedIdentity
        ? current?.org?._id ?? ensuredOrgId ?? cachedValidOrgId
        : null,
    [cachedValidOrgId, canUseCachedIdentity, current, ensuredOrgId],
  );
  const userId = useMemo(
    () =>
      canUseCachedIdentity
        ? current?.user?._id ??
          currentUser?._id ??
          ensuredUserId ??
          cachedUser?.id ??
          null
        : null,
    [cachedUser?.id, canUseCachedIdentity, current, currentUser, ensuredUserId],
  );

  return {
    isSignedIn: canUseCachedIdentity,
    current,
    orgId,
    organization: current?.org ?? null,
    userId,
  };
}
