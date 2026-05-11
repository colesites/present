import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { resolveRequestAuthContext } from "@/lib/server/request-auth";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://present.c-technology-inc.com",
  "https://present.app",
  "app://app",
  "null",
]);

type AssemblyAiUsageBody = {
  sessionId?: string;
  endedAtMs?: number;
};

const isAllowedOrigin = (origin: string): boolean => {
  if (DEFAULT_ALLOWED_ORIGINS.has(origin)) {
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
  if (request.headers.get("origin") && !headers.has("Access-Control-Allow-Origin")) {
    return new Response("Origin not allowed", {
      status: 403,
      headers,
    });
  }

  try {
    const { convexToken } = await resolveRequestAuthContext(request);
    const body = (await request.json().catch(() => ({}))) as AssemblyAiUsageBody;
    if (!body.sessionId) {
      return new Response("Missing session ID", {
        status: 400,
        headers,
      });
    }

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      return new Response("Missing Convex URL", {
        status: 500,
        headers,
      });
    }

    const convex = new ConvexHttpClient(convexUrl, { auth: convexToken });
    const result = await convex.mutation(api.billing.completeSpeechUsageSession, {
      sessionId: body.sessionId as any,
      endedAtMs: body.endedAtMs,
    });

    return Response.json(result, { headers });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to record speech usage.";

    return new Response(message, {
      status: 401,
      headers,
    });
  }
}
