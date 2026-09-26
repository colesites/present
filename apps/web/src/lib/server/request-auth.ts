import "server-only";

import { clerkClient, verifyToken } from "@clerk/nextjs/server";
import { isDesktopSessionRevoked, verifyDesktopSessionToken } from "./desktop-auth";
import { isDesktopJwtConfigured, signConvexAccessToken } from "./desktop-jwt";

const readBearerToken = (authorizationHeader: string | null): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const getClerkUserEmail = (user: {
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  emailAddresses?: Array<{ emailAddress?: string | null }>;
}): string | null =>
  user.primaryEmailAddress?.emailAddress ??
  user.emailAddresses?.find((email) => email.emailAddress)?.emailAddress ??
  null;

const getTokenEmail = (payload: unknown): string | null => {
  const record = payload as
    | {
        email?: unknown;
        emailAddress?: unknown;
        email_address?: unknown;
      }
    | null
    | undefined;

  const candidate =
    record?.email ?? record?.emailAddress ?? record?.email_address;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
};

export const resolveRequestAuthContext = async (request: Request): Promise<{
  userId: string;
  convexToken: string;
  email: string | null;
}> => {
  const bearerToken = readBearerToken(request.headers.get("authorization"));
  if (!bearerToken) {
    throw new Error("Missing bearer token");
  }

  const desktopSession = verifyDesktopSessionToken(bearerToken);
  if (desktopSession) {
    const client = await clerkClient();
    const user = await client.users.getUser(desktopSession.userId);

    // The account, not the browser session that started it: the same rule the
    // refresh route follows, so these routes keep working for a computer that
    // has been signed in for a year (`lib/server/desktop-jwt.ts`).
    if (isDesktopJwtConfigured()) {
      if (user.banned || user.locked) {
        throw new Error("This account can no longer sign in");
      }
      if (isDesktopSessionRevoked(desktopSession.issuedAt, user.privateMetadata)) {
        throw new Error("This computer was signed out");
      }
      const signed = await signConvexAccessToken({
        email: getClerkUserEmail(user),
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
        pictureUrl: user.imageUrl ?? null,
        userId: desktopSession.userId,
      });
      if (signed) {
        return {
          userId: desktopSession.userId,
          convexToken: signed.token,
          email: getClerkUserEmail(user),
        };
      }
    }

    // Until a signing key is configured: Clerk's session, as before.
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
      email: getClerkUserEmail(user),
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
  const client = await clerkClient();
  const user = await client.users.getUser(userId).catch(() => null);

  return {
    userId,
    convexToken: bearerToken,
    email: getTokenEmail(payload) ?? (user ? getClerkUserEmail(user) : null),
  };
};
