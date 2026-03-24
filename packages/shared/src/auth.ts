import { createAuthClient } from "better-auth/react";
import { oneTimeTokenClient, organizationClient } from "better-auth/client/plugins";

const defaultBaseURL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://present.app";

export const authClient = createAuthClient({
  baseURL: process.env.BETTER_AUTH_URL || process.env.CONVEX_SITE_URL || defaultBaseURL,
  plugins: [
    organizationClient(),
    oneTimeTokenClient(),
  ]
});

export function useBetterAuthConvex() {
  const { data: session, isPending } = authClient.useSession();

  return {
    isLoading: isPending,
    isAuthenticated: !!session,
    fetchAccessToken: async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      // BetterAuth v1 stores the token in session.session.token (or you can use the session id)
      // For Convex integration, we usually pass the session token.
      return (session as any)?.session?.token ?? null;
    },
  };
}
