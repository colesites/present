import { fetchAuthMutation } from "@/lib/auth-server";
import { api } from "../../../../../../../packages/backend/convex/_generated/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      orgName?: string;
      logo?: string;
      authOrganizationId?: string;
    };


    if (body.authOrganizationId) {
      await fetchAuthMutation(api.users.createOrganization, {
        orgName: body.orgName || "Untitled Organization",
        logo: body.logo,
        authOrganizationId: body.authOrganizationId,
      });
    } else {
      await fetchAuthMutation(api.users.ensureCurrent, {
        ...(body.orgName ? { orgName: body.orgName } : {}),
        ...(body.logo ? { logo: body.logo } : {}),
      });
    }


    console.log("Onboarding sync successful", { 
      orgName: body.orgName, 
      authOrgId: body.authOrganizationId 
    });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Onboarding sync failed:", error);
    const message =
      error instanceof Error ? error.message : "Unable to complete onboarding";

    return Response.json({ error: message }, { status: 500 });
  }
}

