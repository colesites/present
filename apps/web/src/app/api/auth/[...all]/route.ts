import { handler } from "@/lib/auth-server";

const staticAllowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "app://app",
  "https://present-gha.vercel.app",
  "https://present.app",
]);

const normalizeOrigin = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const envAllowedOrigins = [
  normalizeOrigin(process.env.BETTER_AUTH_URL),
  normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL),
].filter((origin): origin is string => Boolean(origin));

const isAllowedOrigin = (origin: string | null) => {
  if (!origin) {
    return false;
  }

  if (
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  ) {
    return true;
  }

  return staticAllowedOrigins.has(origin) || envAllowedOrigins.includes(origin);
};

const appendVaryHeader = (headers: Headers, value: string) => {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }

  if (!current.split(",").map((item) => item.trim()).includes(value)) {
    headers.set("Vary", `${current}, ${value}`);
  }
};

const withCors = (request: Request, response: Response) => {
  const origin = request.headers.get("origin");
  if (!isAllowedOrigin(origin)) {
    return response;
  }

  const applyCorsHeaders = (headers: Headers) => {
    headers.set("Access-Control-Allow-Origin", origin!);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );
    appendVaryHeader(headers, "Origin");
  };

  try {
    // Preserve native auth response headers (especially Set-Cookie)
    // by mutating the original response whenever possible.
    applyCorsHeaders(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    applyCorsHeaders(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
};

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  const headers = new Headers();

  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin!);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Vary", "Origin");
  }

  return new Response(null, { status: 204, headers });
}

export async function GET(request: Request, context: unknown) {
  const response = await (handler.GET as (req: Request, ctx: unknown) => Promise<Response>)(
    request,
    context,
  );
  return withCors(request, response);
}

export async function POST(request: Request, context: unknown) {
  const response = await (handler.POST as (req: Request, ctx: unknown) => Promise<Response>)(
    request,
    context,
  );
  return withCors(request, response);
}
