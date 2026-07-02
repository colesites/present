const DEFAULT_WEB_PROD_URL = "https://present.c-technology-inc.com";
const DEFAULT_WEB_PUBLIC_URL = "https://present.app";
const DEFAULT_CLERK_PROD_URL = "https://clerk.present.c-technology-inc.com";
const DEFAULT_CONVEX_DEV_URL = "https://wary-badger-863.convex.cloud";
const DEFAULT_CONVEX_PROD_URL = "https://wary-iguana-735.convex.cloud";

const toOrigin = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const toWebSocketOrigin = (value?: string | null): string | null => {
  const origin = toOrigin(value);
  if (!origin) {
    return null;
  }

  const url = new URL(origin);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
    return url.origin;
  }

  if (url.protocol === "http:") {
    url.protocol = "ws:";
    return url.origin;
  }

  return null;
};

const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

const joinDirective = (name: string, values: string[]): string =>
  `${name} ${values.join(" ")};`;

const getConfiguredWebOrigin = (): string =>
  toOrigin(process.env.WEB_APP_URL)
  ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001" : DEFAULT_WEB_PROD_URL);

const getConfiguredConvexOrigin = (): string =>
  toOrigin(process.env.CONVEX_URL)
  ?? (process.env.NODE_ENV === "development" ? DEFAULT_CONVEX_DEV_URL : DEFAULT_CONVEX_PROD_URL);

export const buildDesktopContentSecurityPolicy = (): string => {
  const webOrigin = getConfiguredWebOrigin();
  const convexOrigin = getConfiguredConvexOrigin();
  const convexWebSocketOrigin = toWebSocketOrigin(convexOrigin);

  return [
    joinDirective("default-src", ["'self'", "'unsafe-inline'", "data:", "local-media:", "app:"]),
    joinDirective("script-src", [
      "'self'",
      "'unsafe-eval'",
      "'unsafe-inline'",
      "https://*.clerk.accounts.dev",
      "https://certain-goat-83.clerk.accounts.dev",
      DEFAULT_CLERK_PROD_URL,
    ]),
    joinDirective("worker-src", ["'self'", "blob:"]),
    joinDirective("connect-src", unique([
      "'self'",
      "http://localhost:*",
      "http://127.0.0.1:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*",
      "wss://localhost:*",
      "wss://127.0.0.1:*",
      webOrigin,
      DEFAULT_WEB_PROD_URL,
      DEFAULT_WEB_PUBLIC_URL,
      convexOrigin,
      convexWebSocketOrigin,
      "https://*.convex.cloud",
      "https://*.convex.site",
      "wss://*.convex.cloud",
      "wss://*.convex.site",
      "https://*.clerk.accounts.dev",
      "https://certain-goat-83.clerk.accounts.dev",
      "https://clerk.certain-goat-83.accounts.dev",
      DEFAULT_CLERK_PROD_URL,
      "https://clerk-telemetry.com",
      "wss://streaming.assemblyai.com",
      "wss://streaming.eu.assemblyai.com",
    ])),
    joinDirective("img-src", [
      "'self'",
      "data:",
      "local-media:",
      "ndi-frame:",
      "https://*.convex.cloud",
      "https://*.convex.site",
      "https://*.gravatar.com",
      "https://*.wp.com",
      "https://lh3.googleusercontent.com",
      "https://*.googleusercontent.com",
      "https://img.clerk.com",
    ]),
    joinDirective("media-src", ["'self'", "local-media:"]),
    joinDirective("font-src", ["'self'", "data:", "app:", "https:"]),
    joinDirective("frame-src", [
      "https://*.clerk.accounts.dev",
      "https://certain-goat-83.clerk.accounts.dev",
      "https://clerk.certain-goat-83.accounts.dev",
      DEFAULT_CLERK_PROD_URL,
      "https://www.youtube.com",
      "https://www.youtube-nocookie.com",
    ]),
  ].join(" ");
};
