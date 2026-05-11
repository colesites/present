import "server-only";

import { clerkClient, verifyToken } from "@clerk/nextjs/server";
import { verifyDesktopSessionToken } from "./desktop-auth";

const readBearerToken = (authorizationHeader: string | null): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

export const resolveRequestAuthContext = async (request: Request): Promise<{
  userId: string;
  convexToken: string;
}> => {
  const bearerToken = readBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    throw new Error("Missing bearer token");
  }

  const desktopSession = verifyDesktopSessionToken(bearerToken);
  if (desktopSession) {
    const client = await clerkClient();
    const session = await client.sessions.getSession(desktopSession.sessionId);

    if (
      session.userId !== desktopSession.userId ||
      session.status !== "active"
    ) {
      throw new Error("Desktop session is no longer active");
    }

    const token = await client.sessions.getToken(desktopSession.sessionId, "convex");
    if (!token?.jwt) {
      throw new Error("Unable to mint Convex token");
    }

    return {
      userId: desktopSession.userId,
      convexToken: token.jwt,
    };
  }

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    throw new Error("Missing Clerk secret key");
  }

  const payload = await verifyToken(bearerToken, {
    secretKey: clerkSecretKey,
    audience: "convex",
  });
  const userId = payload.sub;
  if (!userId) {
    throw new Error("Token has no subject");
  }

  return {
    userId,
    convexToken: bearerToken,
  };
};
