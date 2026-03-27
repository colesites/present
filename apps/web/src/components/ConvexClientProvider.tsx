"use client";

import { ReactNode, useMemo } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";

export default function ConvexClientProvider({ children }: { children: ReactNode }) {
  // Create a new client instance on each mount to avoid stale token issues
  const convex = useMemo(
    () => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!),
    []
  );

  return (
    <ConvexAuthProvider client={convex} storageNamespace="convex-auth-v2">
      {children}
    </ConvexAuthProvider>
  );
}
