import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

const DESKTOP_SESSION_TOKEN_VERSION = 1;
const DESKTOP_SESSION_TOKEN_TYPE = "present-desktop-session";
const DESKTOP_SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;

type DesktopSessionTokenClaims = {
  exp: number;
  iat: number;
  sid: string;
  sub: string;
  typ: typeof DESKTOP_SESSION_TOKEN_TYPE;
  v: typeof DESKTOP_SESSION_TOKEN_VERSION;
};

const encodeBase64UrlJson = (value: DesktopSessionTokenClaims): string => {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
};

const decodeBase64UrlJson = (value: string): DesktopSessionTokenClaims | null => {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(decoded) as DesktopSessionTokenClaims;
  } catch {
    return null;
  }
};

const getDesktopSessionSecret = (): string => {
  const explicitSecret = process.env.DESKTOP_AUTH_SESSION_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const legacyExplicitSecret = process.env.DESKTOP_AUTH_REFRESH_SECRET?.trim();
  if (legacyExplicitSecret) {
    return legacyExplicitSecret;
  }

  const clerkSecret = process.env.CLERK_SECRET_KEY?.trim();
  if (clerkSecret) {
    return `${clerkSecret}:desktop-session:${DESKTOP_SESSION_TOKEN_VERSION}`;
  }

  throw new Error("Missing desktop auth session secret");
};

const signDesktopSessionPayload = (payloadBase64: string): string => {
  return createHmac("sha256", getDesktopSessionSecret())
    .update(payloadBase64)
    .digest("base64url");
};

const signaturesMatch = (received: string, expected: string): boolean => {
  const receivedBuffer = Buffer.from(received, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(receivedBuffer, expectedBuffer);
};

export const issueDesktopSessionToken = (input: {
  sessionId: string;
  userId: string;
}): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: DesktopSessionTokenClaims = {
    exp: nowSeconds + DESKTOP_SESSION_TOKEN_TTL_SECONDS,
    iat: nowSeconds,
    sid: input.sessionId,
    sub: input.userId,
    typ: DESKTOP_SESSION_TOKEN_TYPE,
    v: DESKTOP_SESSION_TOKEN_VERSION,
  };
  const encodedPayload = encodeBase64UrlJson(payload);
  const signature = signDesktopSessionPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const verifyDesktopSessionToken = (
  token: string
): {
  expiresAt: number;
  issuedAt: number;
  sessionId: string;
  userId: string;
} | null => {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signDesktopSessionPayload(encodedPayload);
  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }

  const payload = decodeBase64UrlJson(encodedPayload);
  if (!payload) {
    return null;
  }

  if (
    payload.typ !== DESKTOP_SESSION_TOKEN_TYPE ||
    payload.v !== DESKTOP_SESSION_TOKEN_VERSION ||
    typeof payload.sid !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSeconds) {
    return null;
  }

  return {
    expiresAt: payload.exp,
    issuedAt: payload.iat,
    sessionId: payload.sid,
    userId: payload.sub,
  };
};

/**
 * Whether a desktop token issued at `issuedAtSeconds` was cut off by the user
 * signing their computers out.
 *
 * Signing out every computer is one timestamp on the account
 * (`desktopSessionsRevokedBefore`, milliseconds): tokens older than it stop
 * being renewed, and a desktop that cannot renew signs out. Nothing else
 * expires a signed-in computer.
 */
export const isDesktopSessionRevoked = (
  issuedAtSeconds: number,
  privateMetadata: unknown
): boolean => {
  const revokedBefore = (privateMetadata as { desktopSessionsRevokedBefore?: unknown } | null)
    ?.desktopSessionsRevokedBefore;
  if (typeof revokedBefore !== "number" || !Number.isFinite(revokedBefore)) {
    return false;
  }
  return issuedAtSeconds * 1000 < revokedBefore;
};

export const decodeDesktopSessionToken = (
  token: string
): { expiresAt: number; sessionId: string; userId: string } | null => {
  const [encodedPayload] = token.split(".");
  if (!encodedPayload) {
    return null;
  }

  const payload = decodeBase64UrlJson(encodedPayload);
  if (!payload) {
    return null;
  }

  if (
    payload.typ !== DESKTOP_SESSION_TOKEN_TYPE ||
    payload.v !== DESKTOP_SESSION_TOKEN_VERSION ||
    typeof payload.sid !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }

  return {
    expiresAt: payload.exp,
    sessionId: payload.sid,
    userId: payload.sub,
  };
};

// Backward compatibility aliases. Existing callers can migrate incrementally.
export const issueDesktopRefreshToken = issueDesktopSessionToken;
export const verifyDesktopRefreshToken = verifyDesktopSessionToken;

export const getDesktopSessionTokenTtlSeconds = (): number =>
  DESKTOP_SESSION_TOKEN_TTL_SECONDS;
