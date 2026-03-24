"use client";

import { type ReactNode } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useBetterAuthConvex } from "../../../../packages/shared/src/auth";

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error("CONVEX_URL is not set");
}

const convex = new ConvexReactClient(convexUrl);

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useBetterAuthConvex}>
      {children}
    </ConvexProviderWithAuth>
  );
}
