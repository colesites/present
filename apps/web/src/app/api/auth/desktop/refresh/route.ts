import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  issueDesktopRefreshToken,
  verifyDesktopRefreshToken,
} from "../../../../../lib/server/desktop-auth";

type RefreshRequestBody = {
  refreshToken?: string;
};

const noStoreHeaders = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RefreshRequestBody;
    const refreshToken =
      typeof body.refreshToken === "string" ? body.refreshToken : null;

    if (!refreshToken) {
      return NextResponse.json(
        { error: "Missing refresh token." },
        { headers: noStoreHeaders, status: 400 }
      );
    }

    const claims = verifyDesktopRefreshToken(refreshToken);
    if (!claims) {
      return NextResponse.json(
        { error: "Invalid refresh token." },
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
    const nextRefreshToken = issueDesktopRefreshToken({
      sessionId: claims.sessionId,
      userId: claims.userId,
    });

    return NextResponse.json(
      {
        refreshToken: nextRefreshToken,
        token: token.jwt,
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
