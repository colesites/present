import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

const DESKTOP_SESSION_TOKEN_VERSION = 1;
const DESKTOP_SESSION_TOKEN_TYPE = "present-desktop-session";

/**
 * What a computer keeps after it has signed in, and it keeps it.
 *
 * There is no expiry. Signing in on the desktop opens a browser, as Claude's,
 * ChatGPT's and ProPresenter's do, and like them what is kept afterwards lasts
 * until it is given up: a church that signed in in March is signed in in
 * December, and a machine that spends a year in a cupboard comes back signed
 * in. The old 180-day life was a countdown to an unattended sign-out, and an
 * operator who is asked to sign in on a Sunday morning has no way to answer.
 *
 * What still ends a session: signing this computer out, which is one timestamp
 * on the account (`isDesktopSessionRevoked`), and the account itself being
 * banned, locked or deleted. Tokens are checked against those on every
 * refresh, so revoking one takes effect within the hour.
 *
 * `iat` therefore matters (it is what revocation compares against), and older
 * tokens that still carry an `exp` are honoured rather than expired, so
 * nobody is signed out by this change.
 */
type DesktopSessionTokenClaims = {
  /** Only on tokens issued before sessions stopped expiring. */
  exp?: number;
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
  /** `null` unless the token predates sessions that do not expire. */
  expiresAt: number | null;
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
    typeof payload.iat !== "number"
  ) {
    return null;
  }

  // A past `exp` on an older token is not a reason to refuse it: the computer
  // it came from was signed in, and nothing has signed it out.
  return {
    expiresAt: typeof payload.exp === "number" ? payload.exp : null,
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
): { expiresAt: number | null; sessionId: string; userId: string } | null => {
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
    typeof payload.sub !== "string"
  ) {
    return null;
  }

  return {
    expiresAt: typeof payload.exp === "number" ? payload.exp : null,
    sessionId: payload.sid,
    userId: payload.sub,
  };
};

// Backward compatibility aliases. Existing callers can migrate incrementally.
export const issueDesktopRefreshToken = issueDesktopSessionToken;
export const verifyDesktopRefreshToken = verifyDesktopSessionToken;
