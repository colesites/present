"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { authClient } from "../../../../packages/shared/src/auth";
import { useMutation, useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";

export function useOrganization() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = !!sessionData?.session;
  const activeAuthOrganizationId =
    typeof (sessionData as any)?.session?.activeOrganizationId === "string"
      ? ((sessionData as any).session.activeOrganizationId as string)
      : null;

  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const ensureForAuthOrganization = useMutation(api.organizations.ensureForAuthOrganization);
  const current = useQuery(api.users.getCurrentWithOrg);
  const currentUser = useQuery(api.users.getCurrent);
  const [ensuredOrgId, setEnsuredOrgId] = useState<Id<"organizations"> | null>(null);
  const lastEnsuredKeyRef = useRef<string | null>(null);

  // Initialize user on sign-in
  useEffect(() => {
    if (!isAuthenticated) {
      setEnsuredOrgId(null);
      lastEnsuredKeyRef.current = null;
      return;
    }

    const ensureKey = activeAuthOrganizationId ? `auth-org:${activeAuthOrganizationId}` : "personal";
    if (lastEnsuredKeyRef.current === ensureKey) {
      return;
    }
    lastEnsuredKeyRef.current = ensureKey;

    void (async () => {
      try {
        if (activeAuthOrganizationId) {
          // Map Better Auth organization → Convex organization.
          const orgId = await ensureForAuthOrganization({
            authOrganizationId: activeAuthOrganizationId,
          });
          setEnsuredOrgId(orgId);
          return;
        }

        // Personal space (no active organization selected)
        const result = await ensureCurrent({});
        const orgId = (result as { orgId?: Id<"organizations"> } | null)?.orgId;
        if (orgId) {
          setEnsuredOrgId(orgId);
        }
      } catch (error) {
        console.error("Failed to ensure org scope:", error);
      }
    })();
  }, [isAuthenticated, activeAuthOrganizationId, ensureCurrent, ensureForAuthOrganization]);

  // Derive orgId directly from query result — no local state needed
  const orgId = useMemo(
    () => current?.org?._id ?? ensuredOrgId ?? null,
    [current, ensuredOrgId],
  );
  const userId = useMemo(
    () => current?.user?._id ?? currentUser?._id ?? null,
    [current, currentUser],
  );

  return {
    isSignedIn: isAuthenticated,
    current,
    orgId,
    organization: current?.org ?? null,
    activeAuthOrganizationId,
    userId,
  };
}
