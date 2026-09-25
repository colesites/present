import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";

/**
 * Invite someone to a workspace by email (`convex/invites.ts`).
 *
 * It used to add them outright if they already had an account, without
 * asking them. Now it sends an invitation they accept themselves, which also
 * works for someone who has no account yet.
 */
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

  const convex = new ConvexHttpClient(convexUrl, { auth: token });
  try {
    const invite = await convex.mutation(api.invites.create, {
      orgId: orgId as Id<"organizations">,
      email,
      role: body.role === "admin" ? "admin" : "user",
      userRole: body.userRole ?? undefined,
    });
    return Response.json({ ok: true, invited: email, url: invite.url });
  } catch (error) {
    const message = error instanceof ConvexError ? String(error.data) : "Could not send the invitation.";
    return new Response(message, { status: 400 });
  }
}
