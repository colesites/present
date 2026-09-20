import { NextResponse } from "next/server";

import { openIdConfiguration } from "../../../../lib/server/desktop-jwt";

/**
 * Served at `/.well-known/openid-configuration` (see `next.config.ts`), which
 * is where Convex looks when it is told this site issues tokens
 * (`lib/server/desktop-jwt.ts`).
 */
export async function GET() {
  const document = openIdConfiguration();
  if (!document) {
    return NextResponse.json({ error: "Not configured." }, { status: 404 });
  }
  return NextResponse.json(document, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
