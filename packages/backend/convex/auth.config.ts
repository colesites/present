declare const process: {
  env: Record<string, string | undefined>;
};

import { AuthConfig } from "convex/server";

const providers = [
  {
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
    applicationID: "convex",
  },
];

// The desktop app's own issuer, so a signed-in computer keeps working after
// the browser session that started it has ended (apps/web
// `lib/server/desktop-jwt.ts`). Absent until the web app is deployed with a
// signing key, so nothing changes until then.
if (process.env.DESKTOP_JWT_ISSUER_DOMAIN) {
  providers.push({
    domain: process.env.DESKTOP_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  });
}

export default { providers } satisfies AuthConfig;
