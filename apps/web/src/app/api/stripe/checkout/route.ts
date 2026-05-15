import { auth } from "@clerk/nextjs/server";
import { getStripe } from "@/lib/server/stripe";

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = (await request.json()) as {
      lookupKey: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!body.lookupKey) {
      return new Response("Missing lookupKey", { status: 400 });
    }

    const stripe = getStripe();

    // Resolve the price from the lookup key
    const prices = await stripe.prices.list({
      lookup_keys: [body.lookupKey],
      limit: 1,
    });

    if (prices.data.length === 0) {
      return new Response(`No price found for lookup key: ${body.lookupKey}`, {
        status: 404,
      });
    }

    const priceId = prices.data[0].id;

    // Find or create a Stripe customer for this user
    const existingCustomers = await stripe.customers.search({
      limit: 1,
      query: `metadata["userId"]:"${userId}"`,
    });

    let customerId: string;

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        metadata: { userId },
      });
      customerId = customer.id;
    }

    const webAppUrl =
      process.env.WEB_APP_URL ?? "http://localhost:3001";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url:
        body.successUrl ?? `${webAppUrl}/pricing?checkout=success`,
      cancel_url:
        body.cancelUrl ?? `${webAppUrl}/pricing?checkout=cancel`,
      subscription_data: {
        metadata: { userId },
      },
      metadata: { userId },
    });

    return Response.json({ url: session.url });
  } catch (error) {
    console.error("[Stripe Checkout] Error:", error);
    return new Response(
      error instanceof Error ? error.message : "Checkout failed",
      { status: 500 },
    );
  }
}
