import { NextResponse } from "next/server";

import { desktopJwks } from "../../../../lib/server/desktop-jwt";

/**
 * The public keys the desktop's access tokens are signed with, served at
 * `/.well-known/jwks.json`. Empty until a signing key is configured.
 */
export async function GET() {
  return NextResponse.json(await desktopJwks(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
