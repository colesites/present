"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth } from "convex/react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";

export function useOrganization() {
  const { isAuthenticated } = useConvexAuth();
  
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const current = useQuery(api.users.getCurrentWithOrg);
  const currentUser = useQuery(api.users.getCurrent);
  const [ensuredOrgId, setEnsuredOrgId] = useState<Id<"organizations"> | null>(null);
  const [ensuredUserId, setEnsuredUserId] = useState<Id<"users"> | null>(null);
  const lastEnsuredRef = useRef<boolean>(false);

  // Initialize user on sign-in
  useEffect(() => {
    if (!isAuthenticated) {
      setEnsuredOrgId(null);
      setEnsuredUserId(null);
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
        const userId = (result as { userId?: Id<"users"> } | null)?.userId;
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

  // Derive orgId directly from query result
  const orgId = useMemo(
    () => current?.org?._id ?? ensuredOrgId ?? null,
    [current, ensuredOrgId],
  );
  const userId = useMemo(
    () => current?.user?._id ?? currentUser?._id ?? ensuredUserId ?? null,
    [current, currentUser, ensuredUserId],
  );

  return {
    isSignedIn: isAuthenticated,
    current,
    orgId,
    organization: current?.org ?? null,
    userId,
  };
}
