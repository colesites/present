import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";

export async function POST(request: Request) {
  const authState = await auth();
  if (!authState.userId) {
    return new Response("Not authenticated", { status: 401 });
  }

  const token = await authState.getToken({ template: "convex" });
  if (!token) {
    return new Response("Missing convex token", { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return new Response("Convex URL is not configured", { status: 500 });
  }

  const body = (await request.json()) as {
    orgId?: string;
    email?: string;
    role?: string;
    userRole?: string;
  };

  const orgId = body.orgId?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!orgId || !email) {
    return new Response("Organization and email are required", { status: 400 });
  }

  const clerk = await clerkClient();
  const users = await clerk.users.getUserList({
    emailAddress: [email],
    limit: 1,
  });
  const targetUser = users.data[0];
  if (!targetUser) {
    return new Response("No account found for that email", { status: 404 });
  }

  const convex = new ConvexHttpClient(convexUrl, { auth: token });
  await convex.mutation(api.users.addUserToOrganization, {
    orgId: orgId as Id<"organizations">,
    userId: targetUser.id,
    role: body.role ?? "user",
    userRole: body.userRole ?? undefined,
  });

  return Response.json({ ok: true, userId: targetUser.id });
}
