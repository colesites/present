import { auth, clerkClient } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../../../packages/backend/convex/_generated/dataModel";

/**
 * A workspace's members, with the names and photos Clerk holds for them.
 * Convex knows who is in a workspace; only Clerk knows what they are called.
 * Only a member of the workspace may ask (`users.listOrganizationMembers`).
 */
export async function GET(request: Request) {
  const authState = await auth();
  if (!authState.userId) return new Response("Not authenticated", { status: 401 });
  const token = await authState.getToken({ template: "convex" });
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!token || !convexUrl) return new Response("Not configured", { status: 500 });

  const orgId = new URL(request.url).searchParams.get("orgId")?.trim();
  if (!orgId) return new Response("orgId is required", { status: 400 });

  const convex = new ConvexHttpClient(convexUrl, { auth: token });
  let profiles: Array<{ userId: string; role: string; userRole?: string; joinedAt: number }>;
  try {
    profiles = await convex.query(api.users.listOrganizationMembers, {
      orgId: orgId as Id<"organizations">,
    });
  } catch {
    return new Response("Not a member of this workspace", { status: 403 });
  }

  const clerk = await clerkClient();
  const users = profiles.length
    ? (await clerk.users.getUserList({ userId: profiles.map((profile) => profile.userId), limit: 100 })).data
    : [];
  const byId = new Map(users.map((user) => [user.id, user]));

  return Response.json(
    {
      members: profiles.map((profile) => {
        const user = byId.get(profile.userId);
        const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
        return {
          userId: profile.userId,
          name: name || user?.username || null,
          email: user?.primaryEmailAddress?.emailAddress ?? null,
          imageUrl: user?.imageUrl ?? null,
          role: profile.role,
          userRole: profile.userRole ?? null,
          joinedAt: profile.joinedAt,
          isYou: profile.userId === authState.userId,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
