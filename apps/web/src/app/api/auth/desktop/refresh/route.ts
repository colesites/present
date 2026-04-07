import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  issueDesktopSessionToken,
  verifyDesktopSessionToken,
} from "../../../../../lib/server/desktop-auth";

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
    const nextSessionToken = issueDesktopSessionToken({
      sessionId: claims.sessionId,
      userId: claims.userId,
    });
    const accessToken = token.jwt;
    let accessTokenExpiresAt: number | null = null;
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

    return NextResponse.json(
      {
        accessToken,
        accessTokenExpiresAt,
        sessionExpiresAt: claims.expiresAt,
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
