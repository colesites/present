import { getStripe } from "@/lib/server/stripe";
import {
  BillingError,
  billingErrorResponse,
  currentSubscription,
  ensureCustomer,
  isPurchasable,
  priceFor,
  publishableKey,
  requireUser,
  siteOrigin,
} from "@/lib/server/present-billing";

/**
 * Start paying, on Present's own checkout page.
 *
 * `{ lookupKey }` buys a plan; `{ mode: "setup" }` saves a new card for the
 * plan already running. Either way the answer is a Checkout Session with
 * `ui_mode: "elements"`: its client secret drives Stripe's Payment Element
 * inside our page, and Stripe brings the customer back to `return_url`.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { lookupKey?: unknown; mode?: unknown };
    const stripe = getStripe();
    const customer = await ensureCustomer(stripe, userId);
    const origin = siteOrigin(request);

    if (body.mode === "setup") {
      const session = await stripe.checkout.sessions.create({
        ui_mode: "elements",
        mode: "setup",
        currency: "usd",
        customer: customer.id,
        return_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
        setup_intent_data: { metadata: { userId } },
        metadata: { userId, purpose: "payment-method" },
      });
      return Response.json({ clientSecret: session.client_secret, publishableKey: publishableKey() });
    }

    if (!isPurchasable(body.lookupKey)) {
      throw new BillingError("Choose Pro or Power, monthly or yearly.");
    }
    // Someone already paying changes their plan from the Billing page, where
    // the difference is prorated, rather than starting a second subscription.
    if (await currentSubscription(stripe, customer.id)) {
      return Response.json({ alreadySubscribed: true }, { status: 409 });
    }

    const price = await priceFor(stripe, body.lookupKey);
    const session = await stripe.checkout.sessions.create({
      ui_mode: "elements",
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      return_url: `${origin}/checkout/complete?session_id={CHECKOUT_SESSION_ID}`,
      subscription_data: { metadata: { userId } },
      metadata: { userId, lookupKey: body.lookupKey },
    });
    return Response.json({ clientSecret: session.client_secret, publishableKey: publishableKey() });
  } catch (error) {
    return billingErrorResponse(error, "checkout failed to start");
  }
}
