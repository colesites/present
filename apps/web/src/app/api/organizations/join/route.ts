import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";

const joinOrganizationById =
  "users:joinOrganizationById" as unknown as FunctionReference<"mutation">;

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
    userRole?: string;
  };

  const orgId = body.orgId?.trim();
  if (!orgId) {
    return new Response("Organization ID is required", { status: 400 });
  }

  const convex = new ConvexHttpClient(convexUrl, { auth: token });
  const result = await convex.mutation(joinOrganizationById, {
    orgId,
    userRole: body.userRole ?? undefined,
  });

  return Response.json(result);
}
