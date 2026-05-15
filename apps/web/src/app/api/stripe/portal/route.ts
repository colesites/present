import { auth } from "@clerk/nextjs/server";
import { getStripe } from "@/lib/server/stripe";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      returnUrl?: string;
    };

    const stripe = getStripe();

    // Find the Stripe customer
    const customers = await stripe.customers.search({
      limit: 1,
      query: `metadata["userId"]:"${userId}"`,
    });

    if (customers.data.length === 0) {
      return new Response("No billing account found", { status: 404 });
    }

    const webAppUrl =
      process.env.WEB_APP_URL ?? "http://localhost:3001";

    const session = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: body.returnUrl ?? `${webAppUrl}/pricing`,
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("[Stripe Portal] Error:", error);
    return new Response(
      error instanceof Error ? error.message : "Portal session failed",
      { status: 500 },
    );
  }
}
