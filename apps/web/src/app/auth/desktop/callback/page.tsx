import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { redirect } from "next/navigation";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { issueDesktopSessionToken } from "../../../../lib/server/desktop-auth";

/**
 * Where the desktop asked to be handed the session.
 *
 * Only a loopback address, and only the path the desktop listens on. This is
 * a session token: anything else here would be somewhere to send it.
 *
 * Only in development, too. A packaged desktop signs in through its
 * `present://` link and never asks for this, so a deployed site honouring the
 * request would be offering somewhere to send a session for nobody's benefit.
 */
function loopbackRedirect(value: string | undefined): string | null {
  if (!value || process.env.NODE_ENV === "production") return null;
  try {
    const url = new URL(value);
    const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (url.protocol !== "http:" || !isLoopback || url.pathname !== "/auth") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Organisation setup, for an account with none yet — carrying the loopback
 * address with it. Without it a development desktop that sent someone through
 * setup was handed the session by `present://`, which is the installed app's,
 * and never signed in.
 */
function setupPath(sessionToken: string, comeBackTo: string | null): string {
  const setup = new URLSearchParams({ source: "desktop", sessionToken });
  if (comeBackTo) {
    setup.set("redirect", comeBackTo);
  }
  return `/dashboard/organization/setup?${setup.toString()}`;
}

export default async function DesktopCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const comeBackTo = loopbackRedirect((await searchParams).redirect);
  const nextPath = comeBackTo
    ? `/auth/desktop/callback?redirect=${encodeURIComponent(comeBackTo)}`
    : "/auth/desktop/callback";
  const authState = await auth();
  const sessionId =
    typeof authState.sessionId === "string" ? authState.sessionId : null;
  const userId = typeof authState.userId === "string" ? authState.userId : null;
  const clerkConvexToken = await authState.getToken({
    template: "convex",
  });

  if (!clerkConvexToken || !sessionId || !userId) {
    await authState.redirectToSignIn({
      returnBackUrl: nextPath,
    });
    return;
  }

  const sessionToken = issueDesktopSessionToken({
    sessionId,
    userId,
  });

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    redirect(setupPath(sessionToken, comeBackTo));
  }

  const convex = new ConvexHttpClient(convexUrl, { auth: clerkConvexToken });
  const organizations = await convex.query(api.users.listMyOrganizations, {});
  if (!organizations || organizations.length === 0) {
    redirect(setupPath(sessionToken, comeBackTo));
  }

  const launch = new URLSearchParams({ sessionToken });
  if (comeBackTo) {
    launch.set("redirect", comeBackTo);
  }
  redirect(`/auth/desktop/launch?${launch.toString()}`);
}
