import assert from "node:assert/strict";
import test from "node:test";
import {
  expiredSessionAction,
  getRefreshRetryDelayMs,
  isAuthFailureStatus,
  isTransientRefreshStatus,
  shouldKeepCachedIdentity,
  shouldRetryRefresh,
  TOKEN_REFRESH_RETRY_DELAYS_MS,
} from "../src/renderer/shared/lib/auth-refresh-policy.mjs";

test("only 401 and 403 definitively invalidate credentials", () => {
  assert.equal(isAuthFailureStatus(401), true);
  assert.equal(isAuthFailureStatus(403), true);
  assert.equal(isAuthFailureStatus(400), false);
  assert.equal(isAuthFailureStatus(429), false);
  assert.equal(isAuthFailureStatus(500), false);
  assert.equal(isAuthFailureStatus(0), false);
});

test("network, timeout, rate-limit, and server failures are transient", () => {
  for (const status of [0, 408, 429, 500, 502, 503, 599]) {
    assert.equal(isTransientRefreshStatus(status), true, String(status));
  }

  for (const status of [400, 401, 403, 404, 600]) {
    assert.equal(isTransientRefreshStatus(status), false, String(status));
  }
});

test("transient refresh retries are bounded and require connectivity", () => {
  assert.deepEqual(TOKEN_REFRESH_RETRY_DELAYS_MS, [250, 750, 1_500]);

  for (let attempt = 0; attempt < TOKEN_REFRESH_RETRY_DELAYS_MS.length; attempt += 1) {
    assert.equal(
      shouldRetryRefresh({ attempt, online: true, status: 503 }),
      true,
    );
    assert.equal(
      getRefreshRetryDelayMs(attempt),
      TOKEN_REFRESH_RETRY_DELAYS_MS[attempt],
    );
  }

  assert.equal(
    shouldRetryRefresh({ attempt: 3, online: true, status: 503 }),
    false,
  );
  assert.equal(
    shouldRetryRefresh({ attempt: 0, online: false, status: 503 }),
    false,
  );
  assert.equal(
    shouldRetryRefresh({ attempt: 0, online: true, status: 401 }),
    false,
  );
  assert.equal(getRefreshRetryDelayMs(3), null);
});

test("cached identity survives every non-auth refresh failure", () => {
  for (const status of [0, 400, 408, 429, 500, 503]) {
    assert.equal(
      shouldKeepCachedIdentity({ hasUser: true, status }),
      true,
      String(status),
    );
  }

  assert.equal(shouldKeepCachedIdentity({ hasUser: true, status: 401 }), false);
  assert.equal(shouldKeepCachedIdentity({ hasUser: true, status: 403 }), false);
  assert.equal(shouldKeepCachedIdentity({ hasUser: false, status: 503 }), false);
});

test("an expired session never stops a service that is offline", () => {
  // Sunday morning, no internet, the token ran out overnight: the operator
  // keeps presenting on what is already on the machine.
  assert.equal(
    expiredSessionAction({ online: false, hasUser: true }),
    "keep-presenting",
  );
  // Offline and nothing cached: there is nobody to present as yet.
  assert.equal(
    expiredSessionAction({ online: false, hasUser: false }),
    "wait-for-network",
  );
  // Online, the local clock is not the judge: the server is asked, and only
  // its 401 or 403 signs anybody out.
  assert.equal(
    expiredSessionAction({ online: true, hasUser: true }),
    "ask-the-server",
  );
});
