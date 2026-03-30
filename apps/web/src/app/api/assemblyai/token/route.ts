import { auth, verifyToken } from "@clerk/nextjs/server";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://present-gha.vercel.app",
  "https://present.app",
  "app://app",
  "null",
]);

const readBearerToken = (authorizationHeader: string | null): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

const isAuthorizedRequest = async (request: Request): Promise<boolean> => {
  const bearerToken = readBearerToken(request.headers.get("authorization"));
  if (bearerToken) {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      return false;
    }

    try {
      await verifyToken(bearerToken, {
        secretKey: clerkSecretKey,
        audience: "convex",
      });
      return true;
    } catch {
      return false;
    }
  }

  const authState = await auth();
  return Boolean(authState.userId);
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

  if (!(await isAuthorizedRequest(request))) {
    return new Response("Not authenticated", {
      status: 401,
      headers,
    });
  }

  const assemblyAiApiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!assemblyAiApiKey) {
    return new Response("AssemblyAI is not configured", {
      status: 500,
      headers,
    });
  }

  const tokenUrl = new URL("https://streaming.assemblyai.com/v3/token");
  tokenUrl.searchParams.set("expires_in_seconds", "300");
  tokenUrl.searchParams.set("max_session_duration_seconds", "900");

  const response = await fetch(tokenUrl, {
    method: "GET",
    headers: {
      Authorization: assemblyAiApiKey,
    },
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null) as
    | { token?: string; expires_in_seconds?: number; error?: string; message?: string }
    | null;

  if (!response.ok || !payload?.token) {
    const message =
      payload?.error
      ?? payload?.message
      ?? "Failed to create AssemblyAI streaming token";
    return new Response(message, {
      status: response.ok ? 502 : response.status,
      headers,
    });
  }

  return Response.json({
    token: payload.token,
    expiresInSeconds: payload.expires_in_seconds ?? 300,
  }, {
    headers,
  });
}
