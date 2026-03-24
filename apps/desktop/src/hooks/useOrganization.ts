"use client";

import { useEffect, useMemo } from "react";
import { authClient } from "../../../../packages/shared/src/auth";
import { useMutation, useQuery } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";

export function useOrganization() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = !!sessionData?.session;
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const current = useQuery(api.users.getCurrentWithOrg);

  // Initialize user on sign-in
  useEffect(() => {
    if (isAuthenticated && !current) {
      void ensureCurrent({});
    }
  }, [isAuthenticated, current, ensureCurrent]);

  // Derive orgId directly from query result — no local state needed
  const orgId = useMemo(
    () => current?.org?._id ?? null,
    [current],
  );

  return {
    isSignedIn: isAuthenticated,
    current,
    orgId,
    organization: current?.org ?? null,
  };
}
