"use client";

import { useEffect, useMemo } from "react";
import { useAuth } from "@clerk/clerk-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useOrganization() {
  const { isSignedIn } = useAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const current = useQuery(api.users.getCurrentWithOrg);

  // Initialize user on sign-in
  useEffect(() => {
    if (isSignedIn && !current) {
      void ensureCurrent();
    }
  }, [isSignedIn, current, ensureCurrent]);

  // Derive orgId directly from query result — no local state needed
  const orgId = useMemo(
    () => current?.org?._id ?? null,
    [current],
  );

  return {
    isSignedIn,
    current,
    orgId,
    organization: current?.org ?? null,
  };
}
