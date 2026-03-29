import { clerkClient, verifyToken } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../../packages/backend/convex/_generated/api";

type OrganizationRecord = {
  id: string;
  name: string;
  type: "personal" | "organization";
};

const readBearerToken = (authorizationHeader: string | null): string | null => {
  if (!authorizationHeader) {
    return null;
  }
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
};

export async function GET(request: Request) {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return new Response("Missing bearer token", { status: 401 });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!convexUrl || !clerkSecretKey) {
    return new Response("Server auth is not configured", { status: 500 });
  }

  let payload: Awaited<ReturnType<typeof verifyToken>>;
  try {
    payload = await verifyToken(token, {
      secretKey: clerkSecretKey,
      audience: "convex",
    });
  } catch {
    return new Response("Invalid token", { status: 401 });
  }

  const userId = payload.sub;
  if (!userId) {
    return new Response("Token has no subject", { status: 401 });
  }

  const clerk = await clerkClient();
  const user = await clerk.users.getUser(userId);
  const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || "Account";
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    "";

  const convex = new ConvexHttpClient(convexUrl, { auth: token });
  const organizations = (await convex.query(api.users.listMyOrganizations, {})) as Array<{
    id: string;
    name: string;
  }>;

  const organizationRecords: OrganizationRecord[] = [
    { id: "personal", name: "Personal", type: "personal" },
    ...organizations.map((org) => ({
      id: org.id,
      name: org.name,
      type: "organization" as const,
    })),
  ];

  const requestedOrgId = request.headers.get("x-org-id");
  const allowedIds = new Set(organizationRecords.map((org) => org.id));
  if (requestedOrgId && !allowedIds.has(requestedOrgId)) {
    return new Response("You do not have access to the requested organization", { status: 403 });
  }

  const currentOrgId =
    requestedOrgId ??
    organizationRecords[0]?.id ??
    "personal";

  return Response.json({
    user: {
      id: user.id,
      name: fullName,
      email,
    },
    organizations: organizationRecords,
    currentOrgId,
  });
}
