import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { resolveRequestAuthContext } from "@/lib/server/request-auth";
import { syncUserBillingToConvex } from "@/lib/server/billing-sync";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "https://present.c-technology-inc.com",
  "https://present.app",
  "app://app",
  "null",
]);

type AssemblyAiTokenRequestBody = {
  source?: "bible" | "library";
};

const SPEECH_QUOTA_EXHAUSTED_MESSAGE =
  "You've used all of your speech-to-search time for this billing period. Upgrade your plan or wait for the next billing period to continue using voice search.";

const isSpeechQuotaExhaustedError = (message: string): boolean =>
  /speech-to-search quota exhausted|quota exhausted/i.test(message);

const isAllowedOrigin = (origin: string): boolean => {
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) {
    return true;
  }

  // Allow subdomains of the production domain
  if (origin.endsWith(".present.c-technology-inc.com")) {
    return true;
  }

  const configuredWebAppUrl = process.env.WEB_APP_URL;
  if (configuredWebAppUrl) {
    try {
      if (new URL(configuredWebAppUrl).origin === origin) {
        return true;
      }
    } catch {
      // Ignore invalid configured URL values.
    }
  }

  return false;
};

const buildCorsHeaders = (request: Request): Headers => {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });

  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
};

export async function OPTIONS(request: Request) {
  const headers = buildCorsHeaders(request);
  if (request.headers.get("origin") && !headers.has("Access-Control-Allow-Origin")) {
    return new Response("Origin not allowed", {
      status: 403,
      headers,
    });
  }

  return new Response(null, {
    status: 204,
    headers,
  });
}

export async function POST(request: Request) {
  const headers = buildCorsHeaders(request);

  // Debug: log what the route handler actually receives
  const incomingOrigin = request.headers.get("origin");
  const incomingAuth = request.headers.get("authorization");
  console.log("[AssemblyAI Token Route] incoming origin:", incomingOrigin);
  console.log("[AssemblyAI Token Route] has authorization:", Boolean(incomingAuth), incomingAuth?.substring(0, 20));

  // Skip origin gate for requests with a Bearer token (desktop IPC / programmatic).
  // CORS origin enforcement only matters for browser-tab requests.
  const hasBearerAuth = /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
  if (!hasBearerAuth && request.headers.get("origin") && !headers.has("Access-Control-Allow-Origin")) {
    console.log("[AssemblyAI Token Route] BLOCKED: origin not in allowed list and no bearer token");
    return new Response("Origin not allowed", {
      status: 403,
      headers,
    });
  }

  try {
    const { userId, convexToken } = await resolveRequestAuthContext(request);
    await syncUserBillingToConvex({ userId, convexToken });

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!convexUrl || !assemblyAiApiKey) {
      return new Response("AssemblyAI is not configured", {
        status: 500,
        headers,
      });
    }

    const body = (await request.json().catch(() => ({}))) as AssemblyAiTokenRequestBody;
    const source = body.source === "library" ? "library" : "bible";

    const convex = new ConvexHttpClient(convexUrl, { auth: convexToken });
    const speechSession = await convex.mutation(api.billing.startSpeechUsageSession, {
      source,
      requestedMaxDurationSeconds: 15 * 60,
    });

    const tokenUrl = new URL("https://streaming.assemblyai.com/v3/token");
    tokenUrl.searchParams.set("expires_in_seconds", "300");
    tokenUrl.searchParams.set(
      "max_session_duration_seconds",
      String(speechSession.allowedDurationSeconds),
    );

    const response = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        Authorization: assemblyAiApiKey,
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as
      | { token?: string; expires_in_seconds?: number; error?: string; message?: string }
      | null;

    if (!response.ok || !payload?.token) {
      const message =
        payload?.error ??
        payload?.message ??
        "Failed to create AssemblyAI streaming token";
      return new Response(message, {
        status: response.ok ? 502 : response.status,
        headers,
      });
    }

    return Response.json(
      {
        token: payload.token,
        expiresInSeconds: payload.expires_in_seconds ?? 300,
        sessionId: speechSession.sessionId,
        allowedDurationSeconds: speechSession.allowedDurationSeconds,
        billing: speechSession.billing,
      },
      { headers },
    );
  } catch (error) {
    console.error("[AssemblyAI Token Route] Error:", error);
    const message =
      error instanceof Error ? error.message : "Live transcription could not start.";
    const isQuotaError = isSpeechQuotaExhaustedError(message);
    const status = isQuotaError ? 402 : 401;

    if (isQuotaError) {
      return Response.json(
        {
          error: "speech_quota_exhausted",
          message: SPEECH_QUOTA_EXHAUSTED_MESSAGE,
        },
        { status, headers },
      );
    }

    return new Response(message, { status, headers });
  }
}
