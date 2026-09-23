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
 * **A service must never stop because a token did**, and the desktop does not
 * sign anybody out on its own say-so. The clock is a hint: with no network the
 * cached identity stays and the operator keeps presenting; online, the server
 * is asked, and only its definitive 401 or 403 signs anybody out — the same
 * rule every other refresh follows (`shouldKeepCachedIdentity`).
 */
export function expiredSessionAction({ online, hasUser }) {
  if (!online) {
    return hasUser ? "keep-presenting" : "wait-for-network";
  }
  return "ask-the-server";
}
