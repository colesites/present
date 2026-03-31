import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

const DESKTOP_REFRESH_TOKEN_VERSION = 1;
const DESKTOP_REFRESH_TOKEN_TYPE = "present-desktop-refresh";
const DESKTOP_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180;

type DesktopRefreshTokenClaims = {
  exp: number;
  iat: number;
  sid: string;
  sub: string;
  typ: typeof DESKTOP_REFRESH_TOKEN_TYPE;
  v: typeof DESKTOP_REFRESH_TOKEN_VERSION;
};

const encodeBase64UrlJson = (value: DesktopRefreshTokenClaims): string => {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
};

const decodeBase64UrlJson = (value: string): DesktopRefreshTokenClaims | null => {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return JSON.parse(decoded) as DesktopRefreshTokenClaims;
  } catch {
    return null;
  }
};

const getDesktopRefreshSecret = (): string => {
  const explicitSecret = process.env.DESKTOP_AUTH_REFRESH_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  const clerkSecret = process.env.CLERK_SECRET_KEY?.trim();
  if (clerkSecret) {
    return `${clerkSecret}:desktop-refresh:${DESKTOP_REFRESH_TOKEN_VERSION}`;
  }

  throw new Error("Missing desktop auth refresh secret");
};

const signDesktopRefreshPayload = (payloadBase64: string): string => {
  return createHmac("sha256", getDesktopRefreshSecret())
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

export const issueDesktopRefreshToken = (input: {
  sessionId: string;
  userId: string;
}): string => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: DesktopRefreshTokenClaims = {
    exp: nowSeconds + DESKTOP_REFRESH_TOKEN_TTL_SECONDS,
    iat: nowSeconds,
    sid: input.sessionId,
    sub: input.userId,
    typ: DESKTOP_REFRESH_TOKEN_TYPE,
    v: DESKTOP_REFRESH_TOKEN_VERSION,
  };
  const encodedPayload = encodeBase64UrlJson(payload);
  const signature = signDesktopRefreshPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
};

export const verifyDesktopRefreshToken = (
  token: string
): { sessionId: string; userId: string } | null => {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signDesktopRefreshPayload(encodedPayload);
  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }

  const payload = decodeBase64UrlJson(encodedPayload);
  if (!payload) {
    return null;
  }

  if (
    payload.typ !== DESKTOP_REFRESH_TOKEN_TYPE ||
    payload.v !== DESKTOP_REFRESH_TOKEN_VERSION ||
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
    sessionId: payload.sid,
    userId: payload.sub,
  };
};
