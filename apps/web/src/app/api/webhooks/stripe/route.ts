import { getStripe } from "@/lib/server/stripe";
import { syncUserBillingToConvexFromWebhook } from "@/lib/server/billing-sync";
import type Stripe from "stripe";

const RELEVANT_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[Stripe Webhook] Missing STRIPE_WEBHOOK_SECRET");
    return new Response("Webhook not configured", { status: 500 });
  }

  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("[Stripe Webhook] Signature verification failed:", error);
    return new Response("Webhook signature verification failed", {
      status: 400,
    });
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return Response.json({ ok: true, ignored: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const stripe = getStripe();
          const subscription = await stripe.subscriptions.retrieve(
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id,
            { expand: ["items.data.price"] },
          );

          const userId =
            session.metadata?.userId ??
            subscription.metadata?.userId ??
            null;

          if (!userId) {
            console.error(
              "[Stripe Webhook] No userId in checkout session metadata",
            );
            return Response.json(
              { error: "Missing userId metadata" },
              { status: 400 },
            );
          }

          const lookupKey =
            subscription.items.data[0]?.price?.lookup_key ?? null;

          await syncUserBillingToConvexFromWebhook({
            userId,
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : session.customer?.id ?? "",
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            planLookupKey: lookupKey,
            periodStartMs: (subscription.items.data[0]?.current_period_start ?? 0) * 1000,
            periodEndMs: (subscription.items.data[0]?.current_period_end ?? 0) * 1000,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const userId = subscription.metadata?.userId ?? null;

        if (!userId) {
          console.error(
            "[Stripe Webhook] No userId in subscription metadata",
          );
          return Response.json(
            { error: "Missing userId metadata" },
            { status: 400 },
          );
        }

        const lookupKey =
          subscription.items.data[0]?.price?.lookup_key ?? null;

        await syncUserBillingToConvexFromWebhook({
          userId,
          stripeCustomerId:
            typeof subscription.customer === "string"
              ? subscription.customer
              : subscription.customer?.id ?? "",
          stripeSubscriptionId: subscription.id,
          status: subscription.status,
          planLookupKey: lookupKey,
          periodStartMs: (subscription.items.data[0]?.current_period_start ?? 0) * 1000,
          periodEndMs: (subscription.items.data[0]?.current_period_end ?? 0) * 1000,
        });
        break;
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("[Stripe Webhook] Processing failed:", error);
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 400 },
    );
  }
}
