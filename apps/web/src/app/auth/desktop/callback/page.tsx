import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { redirect } from "next/navigation";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import { issueDesktopRefreshToken } from "../../../../lib/server/desktop-auth";

export default async function DesktopCallbackPage() {
  const nextPath = "/auth/desktop/callback";
  const authState = await auth();
  const sessionId =
    typeof authState.sessionId === "string" ? authState.sessionId : null;
  const userId = typeof authState.userId === "string" ? authState.userId : null;
  const sessionToken = await authState.getToken({
    template: "convex",
  });

  if (!sessionToken || !sessionId || !userId) {
    await authState.redirectToSignIn({
      returnBackUrl: nextPath,
    });
    return;
  }

  const refreshToken = issueDesktopRefreshToken({
    sessionId,
    userId,
  });

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    redirect("/dashboard/organization/setup?source=desktop");
  }

  const convex = new ConvexHttpClient(convexUrl, { auth: sessionToken });
  const organizations = await convex.query(api.users.listMyOrganizations, {});
  if (!organizations || organizations.length === 0) {
    redirect(
      `/dashboard/organization/setup?source=desktop&token=${encodeURIComponent(
        sessionToken
      )}&refreshToken=${encodeURIComponent(refreshToken)}`
    );
  }

  redirect(
    `/auth/desktop/launch?token=${encodeURIComponent(
      sessionToken
    )}&refreshToken=${encodeURIComponent(refreshToken)}`
  );
}
