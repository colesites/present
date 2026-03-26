import { createAuthClient } from "better-auth/react";
import { oneTimeTokenClient, organizationClient } from "better-auth/client/plugins";
import { convexClient } from "@convex-dev/better-auth/client/plugins";

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
    convexClient(),
  ]
});

export function useBetterAuthConvex() {
  const { data: session, isPending } = authClient.useSession();
  const isSignedIn = !!(session as any)?.session;

  return {
    isLoading: isPending,
    isAuthenticated: isSignedIn,
    fetchAccessToken: async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      // Use the convexClient plugin to securely get a JWT formatted for Convex.
      try {
        const token = await (authClient as any).getConvexToken();
        return token;
      } catch (err) {
        console.error("Failed to retrieve Convex token from BetterAuth:", err);
        return null;
      }
    },
  };
}
