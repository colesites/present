import type Stripe from "stripe";
import { getStripe } from "@/lib/server/stripe";
import { planKeyOfPrice } from "@/lib/server/stripe-plan";
import {
  BillingError,
  billingErrorResponse,
  planLabelOf,
  requireUser,
  syncNow,
} from "@/lib/server/present-billing";

/**
 * How a checkout ended, for the page Stripe returns to.
 *
 * Only the person who started a session can read it. A finished purchase is
 * synced to Convex here, so the new plan is in place before the page says so;
 * a new card is made the one the subscription charges.
 */
export async function GET(request: Request) {
  try {
    const { userId, getToken } = await requireUser();
    const sessionId = new URL(request.url).searchParams.get("session_id");
    if (!sessionId?.startsWith("cs_")) throw new BillingError("That checkout link is incomplete.");

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription.items.data.price.product", "setup_intent"],
    });
    if (session.metadata?.userId !== userId) throw new BillingError("That checkout isn't yours.", 403);

    if (session.mode === "setup") {
      const setupIntent = session.setup_intent as Stripe.SetupIntent | null;
      const paymentMethod =
        typeof setupIntent?.payment_method === "string" ? setupIntent.payment_method : setupIntent?.payment_method?.id;
      if (session.status === "complete" && paymentMethod && typeof session.customer === "string") {
        await stripe.customers.update(session.customer, {
          invoice_settings: { default_payment_method: paymentMethod },
        });
        const subscriptions = await stripe.subscriptions.list({ customer: session.customer, status: "active", limit: 10 });
        await Promise.all(
          subscriptions.data.map((subscription) =>
            stripe.subscriptions.update(subscription.id, { default_payment_method: paymentMethod }),
          ),
        );
      }
      return Response.json({ kind: "payment-method", status: session.status });
    }

    const subscription = session.subscription as Stripe.Subscription | null;
    const item = subscription?.items.data[0];
    const planKey = await planKeyOfPrice(stripe, item?.price);
    if (session.status === "complete") await syncNow(userId, getToken);
    return Response.json({
      kind: "subscription",
      status: session.status,
      paymentStatus: session.payment_status,
      subscriptionStatus: subscription?.status ?? null,
      planLabel: planLabelOf(planKey),
      interval: item?.price.recurring?.interval ?? null,
      amountTotal: session.amount_total,
      currency: session.currency,
    });
  } catch (error) {
    return billingErrorResponse(error, "checkout status failed");
  }
}
