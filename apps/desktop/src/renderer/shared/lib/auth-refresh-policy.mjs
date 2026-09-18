export const TOKEN_REFRESH_RETRY_DELAYS_MS = Object.freeze([250, 750, 1_500]);

export function isAuthFailureStatus(status) {
  return status === 401 || status === 403;
}

export function isTransientRefreshStatus(status) {
  return (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (status >= 500 && status < 600)
  );
}

export function shouldRetryRefresh({ attempt, online, status }) {
  return (
    online &&
    isTransientRefreshStatus(status) &&
    attempt >= 0 &&
    attempt < TOKEN_REFRESH_RETRY_DELAYS_MS.length
  );
}

export function getRefreshRetryDelayMs(attempt) {
  return TOKEN_REFRESH_RETRY_DELAYS_MS[attempt] ?? null;
}

export function shouldKeepCachedIdentity({ hasUser, status }) {
  return hasUser && !isAuthFailureStatus(status);
}

/**
 * What to do when the stored session's own clock says it has expired.
 *
 * **A service must never stop because a token did.** With no network there is
 * no way to renew one and no way to know it was really revoked, so the cached
 * identity stays and the operator keeps presenting; the app says to reconnect
 * rather than asking them to sign in during a service. Online, an expired
 * session is a fact and signing in again is possible, so it is asked for.
 */
export function expiredSessionAction({ online, hasUser }) {
  if (!online) {
    return hasUser ? "keep-presenting" : "wait-for-network";
  }
  return "sign-in-again";
}
