import { createAuthClient } from "better-auth/react";
import { oneTimeTokenClient, organizationClient } from "better-auth/client/plugins";

const isDevelopment = process.env.NODE_ENV === "development";
const defaultBaseURL = isDevelopment ? "http://localhost:3001" : "https://present.app";
const resolvedBaseURL = isDevelopment
  ? process.env.BETTER_AUTH_URL || defaultBaseURL
  : process.env.BETTER_AUTH_URL || process.env.CONVEX_SITE_URL || defaultBaseURL;

export const authClient = createAuthClient({
  baseURL: resolvedBaseURL,
  plugins: [
    organizationClient(),
    oneTimeTokenClient(),
  ]
});

export function useBetterAuthConvex() {
  const { data: session, isPending } = authClient.useSession();
  const isSignedIn = !!(session as any)?.session;

  return {
    isLoading: isPending,
    isAuthenticated: isSignedIn,
    fetchAccessToken: async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      // BetterAuth v1 stores the token in session.session.token (or you can use the session id)
      // For Convex integration, we usually pass the session token.
      void forceRefreshToken;
      return (session as any)?.session?.token ?? null;
    },
  };
}
