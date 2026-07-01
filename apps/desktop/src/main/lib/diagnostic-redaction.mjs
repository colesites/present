export function redactDiagnosticText(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/\b(sessionToken|accessToken|refreshToken|token)=([^\s&]+)/gi, "$1=[REDACTED]")
    .replace(/\b[A-Za-z0-9_-]{80,}\b/g, "[REDACTED_CREDENTIAL]")
    .slice(0, 20_000);
}
