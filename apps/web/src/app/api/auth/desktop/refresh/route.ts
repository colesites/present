import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  decodeDesktopSessionToken,
  isDesktopSessionRevoked,
  issueDesktopSessionToken,
  verifyDesktopSessionToken,
} from "../../../../../lib/server/desktop-auth";
import {
  isDesktopJwtConfigured,
  signConvexAccessToken,
} from "../../../../../lib/server/desktop-jwt";

type RefreshRequestBody = {
  refreshToken?: string;
  sessionToken?: string;
};

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshRequestBody;
    const sessionToken =
      typeof body.sessionToken === "string"
        ? body.sessionToken
        : typeof body.refreshToken === "string"
          ? body.refreshToken
          : null;

    if (!sessionToken) {
      return NextResponse.json(
        { error: "Missing session token." },
        { headers: noStoreHeaders, status: 400 }
      );
    }

    const claims = verifyDesktopSessionToken(sessionToken);
    if (!claims) {
      return NextResponse.json(
        { error: "Invalid session token." },
        { headers: noStoreHeaders, status: 401 }
      );
    }

    const client = await clerkClient();

    // The desktop's own credential: signed here from the account, not from the
    // browser session that started it, so a computer stays signed in until it
    // is signed out (`lib/server/desktop-jwt.ts`). Until a signing key is
    // configured this is skipped and Clerk's session is used, as before.
    let accessToken: string | null = null;
    let accessTokenExpiresAt: number | null = null;

    if (isDesktopJwtConfigured()) {
      const user = await client.users.getUser(claims.userId).catch(() => null);
      if (!user || user.banned || user.locked) {
        return NextResponse.json(
          { error: "This account can no longer sign in." },
          { headers: noStoreHeaders, status: 401 }
        );
      }
      if (isDesktopSessionRevoked(claims.issuedAt, user.privateMetadata)) {
        return NextResponse.json(
          { error: "This computer was signed out." },
          { headers: noStoreHeaders, status: 401 }
        );
      }
      const signed = await signConvexAccessToken({
        email: user.primaryEmailAddress?.emailAddress ?? null,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
        pictureUrl: user.imageUrl ?? null,
        userId: claims.userId,
      });
      if (signed) {
        accessToken = signed.token;
        accessTokenExpiresAt = signed.expiresAt;
      }
    }

    if (!accessToken) {
      // Clerk's session, which ends on Clerk's own schedule.
      const session = await client.sessions.getSession(claims.sessionId);

      if (session.userId !== claims.userId || session.status !== "active") {
        return NextResponse.json(
          { error: "Session is no longer active." },
          { headers: noStoreHeaders, status: 401 }
        );
      }

      const token = await client.sessions.getToken(claims.sessionId, "convex");
      if (!token?.jwt || typeof token.jwt !== "string") {
        return NextResponse.json(
          { error: "Unable to mint access token for desktop session." },
          { headers: noStoreHeaders, status: 500 }
        );
      }
      accessToken = token.jwt;
      try {
        const payloadSegment = accessToken.split(".")[1];
        if (payloadSegment) {
          const decodedPayload = JSON.parse(
            Buffer.from(payloadSegment, "base64url").toString("utf8")
          ) as { exp?: unknown };
          if (typeof decodedPayload.exp === "number") {
            accessTokenExpiresAt = decodedPayload.exp;
          }
        }
      } catch {
        accessTokenExpiresAt = null;
      }
    }

    const nextSessionToken = issueDesktopSessionToken({
      sessionId: claims.sessionId,
      userId: claims.userId,
    });
    const nextSessionClaims = decodeDesktopSessionToken(nextSessionToken);

    return NextResponse.json(
      {
        accessToken,
        accessTokenExpiresAt,
        // Report the rotated token's expiry. Returning the old token's expiry
        // prevents the desktop's persisted session lifetime from extending.
        sessionExpiresAt: nextSessionClaims?.expiresAt ?? claims.expiresAt,
        sessionToken: nextSessionToken,
        // Compatibility for older desktop versions.
        refreshToken: nextSessionToken,
        token: accessToken,
      },
      { headers: noStoreHeaders }
    );
  } catch (error) {
    console.error("[Desktop Auth] failed to refresh desktop token", error);
    return NextResponse.json(
      { error: "Unable to refresh desktop session." },
      { headers: noStoreHeaders, status: 500 }
    );
  }
}
