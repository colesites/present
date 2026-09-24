import "server-only";

import { createPrivateKey, createPublicKey, type KeyObject } from "crypto";
import { calculateJwkThumbprint, exportJWK, SignJWT, type JWK } from "jose";

/**
 * The access token Present's desktop app presents to Convex, signed here.
 *
 * **Why this exists at all.** Signing in on the desktop opens a browser, as
 * Claude's and ProPresenter's do. What the desktop keeps afterwards used to be
 * tied to that browser session: every refresh asked Clerk whether the session
 * was still active, so when Clerk ended it — a lifetime, an inactivity timeout
 * — the desktop signed the operator out, sometimes on a Sunday morning. A
 * presentation app cannot do that.
 *
 * So the desktop keeps a credential of its own. This mints the short-lived
 * token Convex accepts, from the user's identity rather than from a live
 * browser session, and the user stays signed in until they sign that computer
 * out.
 *
 * **It is inert until configured.** Without `DESKTOP_JWT_PRIVATE_KEY` and an
 * issuer, nothing here signs anything and the refresh route keeps using
 * Clerk's session. Convex has to list this issuer as a provider first
 * (`packages/backend/convex/auth.config.ts`), or it would reject every token.
 */

/** An hour, as Clerk's own Convex tokens last. The desktop refreshes earlier. */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** What Convex's provider entry calls this application. */
export const CONVEX_AUDIENCE = "convex";

/** The identity a token speaks for. `userId` is the Clerk user id, which is
 * what every Convex function reads as `identity.subject`. */
export type DesktopIdentity = {
  userId: string;
  email?: string | null;
  name?: string | null;
  pictureUrl?: string | null;
};

const privateKeyPem = (): string | null => {
  const raw = process.env.DESKTOP_JWT_PRIVATE_KEY?.trim();
  if (!raw) {
    return null;
  }
  // Environment panels keep newlines as "\n".
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
};

/**
 * The issuer these tokens claim, which Convex must have as a provider domain
 * and which serves the discovery documents below.
 *
 * **The same URL in development as in production.** Convex fetches the key
 * from this address itself, over the internet, so `http://localhost:3000`
 * cannot be an issuer however the app is being run: Convex cannot reach it. A
 * development web app signs with the same key as the deployed one and claims
 * the deployed one's name, and the development Convex deployment trusts that
 * name — the tokens verify against the keys production publishes.
 */
export const desktopJwtIssuer = (): string | null => {
  const configured =
    process.env.DESKTOP_JWT_ISSUER?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.WEB_APP_URL?.trim();
  return configured ? configured.replace(/\/+$/, "") : null;
};

let hasSaidIssuerIsMissing = false;

/**
 * Whether this app can sign the desktop's tokens.
 *
 * A key with no issuer is the quiet failure worth shouting about: everything
 * carries on working, because the refresh route falls back to Clerk's session,
 * and the only sign that the credential is off is that computers start being
 * signed out weeks later. Development is where this happens, since
 * `WEB_APP_URL` is usually only set in production.
 */
export const isDesktopJwtConfigured = (): boolean => {
  const hasKey = Boolean(privateKeyPem());
  const issuer = desktopJwtIssuer();
  if (hasKey && !issuer && !hasSaidIssuerIsMissing) {
    hasSaidIssuerIsMissing = true;
    console.warn(
      "[Desktop Auth] a signing key is set but no issuer is, so the desktop " +
        "credential is off and Clerk's session is being used instead. Set " +
        "DESKTOP_JWT_ISSUER (or WEB_APP_URL) to this app's public URL — the " +
        "same one Convex has as DESKTOP_JWT_ISSUER_DOMAIN.",
    );
  }
  return hasKey && Boolean(issuer);
};

let cachedKey: { key: KeyObject; kid: string } | null = null;

const signingKey = async (): Promise<{ key: KeyObject; kid: string } | null> => {
  const pem = privateKeyPem();
  if (!pem) {
    return null;
  }
  if (cachedKey) {
    return cachedKey;
  }
  try {
    const key = createPrivateKey(pem);
    // The key's own thumbprint, so the id changes when the key does and a
    // rotated key never reuses an old one's name.
    const publicJwk = await exportJWK(createPublicKey(key));
    const kid = process.env.DESKTOP_JWT_KID?.trim() || (await calculateJwkThumbprint(publicJwk));
    cachedKey = { key, kid };
    return cachedKey;
  } catch (error) {
    console.error("[Desktop Auth] the desktop signing key could not be read", error);
    return null;
  }
};

/**
 * A token Convex will accept for this user, or `null` when this is not set up.
 *
 * The claims are the ones Convex maps onto `identity`: `sub` is the user id
 * every function reads, and the rest are what `users.ensureCurrent` stores.
 */
export const signConvexAccessToken = async (
  identity: DesktopIdentity,
): Promise<{ token: string; expiresAt: number } | null> => {
  const issuer = desktopJwtIssuer();
  const signing = await signingKey();
  if (!issuer || !signing || !identity.userId) {
    return null;
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ACCESS_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
    picture: identity.pictureUrl ?? undefined,
  })
    .setProtectedHeader({ alg: "RS256", kid: signing.kid, typ: "JWT" })
    .setIssuer(issuer)
    .setSubject(identity.userId)
    .setAudience(CONVEX_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(signing.key);

  return { token, expiresAt };
};

/** How long an answer from the issuer is believed, each way. A trusted key is
 * re-checked now and then; a refused one soon, so the moment production starts
 * publishing the key, development starts using it. */
const TRUSTED_FOR_MS = 10 * 60_000;
const REFUSED_FOR_MS = 60_000;

let trust: { trusted: boolean; until: number } | null = null;

/**
 * Whether Convex will accept what this app signs: the issuer it names
 * publishes this app's key.
 *
 * Configured is not enough. A development app signs with its own copy of the
 * key and claims the deployed site's name ([`desktopJwtIssuer`]), so its
 * tokens verify only if the deployed site publishes that same key. When it
 * does not — no key in production yet, or a different one — Convex refuses
 * every token, the desktop never learns who is signed in, and it sits on
 * "Loading…" for good. So the issuer's published keys are asked, and until
 * they include this one the refresh route uses Clerk's session, which always
 * verifies.
 */
export const isDesktopJwtTrusted = async (): Promise<boolean> => {
  if (!isDesktopJwtConfigured()) {
    return false;
  }
  const now = Date.now();
  if (trust && now < trust.until) {
    return trust.trusted;
  }

  const issuer = desktopJwtIssuer();
  const signing = await signingKey();
  let trusted = false;
  if (issuer && signing) {
    try {
      const ours = await exportJWK(createPublicKey(signing.key));
      const response = await fetch(`${issuer}/.well-known/jwks.json`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      });
      const published = response.ok
        ? ((await response.json()) as { keys?: Array<{ kid?: string; n?: string }> })
        : null;
      trusted = Boolean(
        published?.keys?.some((key) => key.kid === signing.kid && key.n === ours.n),
      );
    } catch {
      // Unreachable is not trusted: Convex could not reach it either.
      trusted = false;
    }
  }

  if (!trusted && trust?.trusted !== false) {
    console.warn(
      `[Desktop Auth] ${issuer}/.well-known/jwks.json does not publish this ` +
        "app's signing key, so Convex would refuse the tokens it signs. Using " +
        "Clerk's session instead. Give the deployed site the same " +
        "DESKTOP_JWT_PRIVATE_KEY and redeploy it to turn the desktop credential on.",
    );
  }
  trust = { trusted, until: now + (trusted ? TRUSTED_FOR_MS : REFUSED_FOR_MS) };
  return trusted;
};

/** The public half, for Convex to check signatures against. */
export const desktopJwks = async (): Promise<{ keys: JWK[] }> => {
  const signing = await signingKey();
  if (!signing) {
    return { keys: [] };
  }
  const jwk = await exportJWK(createPublicKey(signing.key));
  return {
    keys: [{ ...jwk, alg: "RS256", kid: signing.kid, use: "sig" }],
  };
};

/** What a provider fetches from `${issuer}/.well-known/openid-configuration`. */
export const openIdConfiguration = (): Record<string, unknown> | null => {
  const issuer = desktopJwtIssuer();
  if (!issuer) {
    return null;
  }
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    id_token_signing_alg_values_supported: ["RS256"],
    response_types_supported: ["id_token"],
    subject_types_supported: ["public"],
    // Nothing signs in here; the browser flow does that through Clerk. This
    // document exists so Convex can find the key.
    authorization_endpoint: `${issuer}/auth/desktop/callback`,
  };
};
