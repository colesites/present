import { revalidatePath } from "next/cache";
import { fetchAuthMutation } from "@/lib/auth-server";
import { api } from "../../../../../../packages/backend/convex/_generated/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      logo?: string;
      clearLogo?: boolean;
    };

    if (!body.name?.trim()) {
      return Response.json(
        { error: "Organization name is required." },
        { status: 400 },
      );
    }

    await fetchAuthMutation(api.orgScopes.updateCurrent, {
      name: body.name.trim(),
      ...(body.logo ? { logo: body.logo } : {}),
      ...(body.clearLogo ? { clearLogo: true } : {}),
    });

    revalidatePath("/dashboard");
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update organization";

    return Response.json({ error: message }, { status: 500 });
  }
}
