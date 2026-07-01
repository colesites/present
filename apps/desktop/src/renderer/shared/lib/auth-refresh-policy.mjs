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
