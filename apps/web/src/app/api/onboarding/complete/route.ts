import { fetchAuthMutation } from "@/lib/auth-server";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      orgName?: string;
      logo?: string;
      authOrganizationId?: string;
    };


    await fetchAuthMutation(api.users.ensureCurrent, {
      ...(body.orgName ? { orgName: body.orgName } : {}),
      ...(body.logo ? { logo: body.logo } : {}),
      ...(body.authOrganizationId ? { authOrganizationId: body.authOrganizationId } : {}),
    });


    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to complete onboarding";

    return Response.json({ error: message }, { status: 500 });
  }
}
