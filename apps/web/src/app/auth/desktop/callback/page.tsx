import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { redirect } from "next/navigation";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";

// Force dynamic rendering for this page
export const dynamic = 'force-dynamic';

export default async function DesktopCallbackPage() {
  const nextPath = "/auth/desktop/callback";
  const authState = await auth();
  const sessionToken = await authState.getToken({
    template: "convex",
  });

  if (!sessionToken) {
    await authState.redirectToSignIn({
      returnBackUrl: nextPath,
    });
    return;
  }

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
      )}`
    );
  }

  redirect(`/auth/desktop/launch?token=${encodeURIComponent(sessionToken)}`);
}
