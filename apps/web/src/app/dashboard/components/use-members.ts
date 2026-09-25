"use client";

import { useCallback, useEffect, useState } from "react";

export type WorkspaceMember = {
  userId: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  role: string;
  userRole: string | null;
  joinedAt: number;
  isYou: boolean;
};

/**
 * A workspace's members with their names and photos, which only Clerk has
 * (`/api/organizations/members`). `null` while they load.
 */
export function useMembers(orgId: string | null | undefined) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      const response = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      setMembers(((await response.json()) as { members: WorkspaceMember[] }).members);
    } catch {
      setError("Couldn't load the members. Refresh to try again.");
    }
  }, [orgId]);

  useEffect(() => {
    setMembers(null);
    void reload();
  }, [reload]);

  return { members, error, reload };
}
