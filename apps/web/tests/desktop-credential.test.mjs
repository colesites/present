import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";

import { createLocalJWKSet, jwtVerify } from "jose";

// A key for these tests only; the real one lives in the environment.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.DESKTOP_JWT_PRIVATE_KEY = privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString();
process.env.DESKTOP_JWT_ISSUER = "https://present.multivrs.space/";

const { CONVEX_AUDIENCE, desktopJwks, desktopJwtIssuer, isDesktopJwtConfigured, openIdConfiguration, signConvexAccessToken } =
  await import("../src/lib/server/desktop-jwt.ts");
const { isDesktopSessionRevoked } = await import("../src/lib/server/desktop-auth.ts");

test("the desktop's token says who it is for, and Convex can check it", async () => {
  assert.equal(isDesktopJwtConfigured(), true);
  const signed = await signConvexAccessToken({
    email: "leader@church.example",
    name: "Sunday Operator",
    pictureUrl: "https://example.test/avatar.png",
    userId: "user_2abc",
  });
  assert.ok(signed, "a token was signed");

  // Verified the way Convex does: against the published keys.
  const keys = createLocalJWKSet(await desktopJwks());
  const { payload, protectedHeader } = await jwtVerify(signed.token, keys, {
    audience: CONVEX_AUDIENCE,
    issuer: "https://present.multivrs.space",
  });

  assert.equal(protectedHeader.alg, "RS256");
  // Every Convex function reads `identity.subject`; it has to be the Clerk id.
  assert.equal(payload.sub, "user_2abc");
  assert.equal(payload.email, "leader@church.example");
  assert.equal(payload.name, "Sunday Operator");
  assert.equal(payload.picture, "https://example.test/avatar.png");
  assert.equal(payload.exp, signed.expiresAt);
  // An hour, so a stolen one is short-lived even though signing in is not.
  assert.ok(payload.exp - payload.iat <= 60 * 60);
});

test("the key is published where a provider looks for it", async () => {
  assert.equal(desktopJwtIssuer(), "https://present.multivrs.space");
  const document = openIdConfiguration();
  assert.equal(document.issuer, "https://present.multivrs.space");
  assert.equal(document.jwks_uri, "https://present.multivrs.space/.well-known/jwks.json");

  const { keys } = await desktopJwks();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kty, "RSA");
  assert.equal(keys[0].use, "sig");
  assert.ok(keys[0].kid, "the key has a name");
  assert.equal(keys[0].d, undefined, "the private half is not published");
});

test("a token from another key is refused", async () => {
  const signed = await signConvexAccessToken({ userId: "user_2abc" });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const strangerKeys = createLocalJWKSet({
    keys: [
      {
        ...JSON.parse(
          Buffer.from(
            other.publicKey.export({ format: "jwk" }) instanceof Object
              ? JSON.stringify(other.publicKey.export({ format: "jwk" }))
              : "{}",
          ).toString(),
        ),
        alg: "RS256",
        kid: (await desktopJwks()).keys[0].kid,
        use: "sig",
      },
    ],
  });
  await assert.rejects(() =>
    jwtVerify(signed.token, strangerKeys, {
      audience: CONVEX_AUDIENCE,
      issuer: "https://present.multivrs.space",
    }),
  );
});

test("signing every computer out stops the tokens issued before it", () => {
  const issuedAt = Math.floor(Date.UTC(2026, 8, 1) / 1000);
  assert.equal(isDesktopSessionRevoked(issuedAt, null), false, "nothing revoked");
  assert.equal(isDesktopSessionRevoked(issuedAt, {}), false);
  assert.equal(
    isDesktopSessionRevoked(issuedAt, { desktopSessionsRevokedBefore: Date.UTC(2026, 8, 5) }),
    true,
    "signed out after this token was issued",
  );
  assert.equal(
    isDesktopSessionRevoked(issuedAt, { desktopSessionsRevokedBefore: Date.UTC(2026, 7, 20) }),
    false,
    "signed out before it, so this one still counts",
  );
  assert.equal(
    isDesktopSessionRevoked(issuedAt, { desktopSessionsRevokedBefore: "yesterday" }),
    false,
    "nonsense is not a revocation",
  );
});

test("nothing is signed until a key is configured", async () => {
  const key = process.env.DESKTOP_JWT_PRIVATE_KEY;
  delete process.env.DESKTOP_JWT_PRIVATE_KEY;
  const fresh = await import(`../src/lib/server/desktop-jwt.ts?no-key=${Date.now()}`);
  assert.equal(fresh.isDesktopJwtConfigured(), false);
  assert.equal(await fresh.signConvexAccessToken({ userId: "user_2abc" }), null);
  assert.deepEqual(await fresh.desktopJwks(), { keys: [] });
  process.env.DESKTOP_JWT_PRIVATE_KEY = key;
});
