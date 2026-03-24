import { createClient } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import type { GenericCtx } from "@convex-dev/better-auth/utils";
import { betterAuth } from "better-auth";
import { oneTimeToken, organization } from "better-auth/plugins";
import { components } from "./_generated/api";
import authConfig from "./auth.config";
import authSchema from "./betterAuth/schema";

export const authComponent = createClient<any, typeof authSchema>(
  components.auth as any, 
  {
    local: {
      schema: authSchema,
    },
    verbose: true,
  }
);

export const createAuthOptions = (ctx: GenericCtx) => {
  const trustedOrigins = [
    process.env.BETTER_AUTH_URL,
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "app://app",
  ].filter((origin): origin is string => Boolean(origin));

  return {
    database: authComponent.adapter(ctx),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: async (request?: Request) => {
      const origin = request?.headers.get("origin");
      if (
        origin &&
        (origin.startsWith("http://localhost:") ||
          origin.startsWith("http://127.0.0.1:") ||
          origin === "app://app")
      ) {
        return [...trustedOrigins, origin];
      }

      return trustedOrigins;
    },
    plugins: [
      convex({
        authConfig,
      }),
      organization(),
      oneTimeToken(),
    ],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    },
  };
};

export const createAuth = (ctx: GenericCtx) => {
  return betterAuth(createAuthOptions(ctx));
};
