import { verifyWebhook } from "@clerk/backend/webhooks";
import { syncUserBillingToConvexFromWebhook } from "@/lib/server/billing-sync";

type ClerkWebhookPayload = {
  type?: string;
  data?: {
    payerId?: string;
    payer_id?: string;
    payer?: {
      id?: string;
      type?: string;
    };
    forPayerType?: string;
    for_payer_type?: string;
  };
};

const BILLING_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.active",
  "subscription.pastDue",
  "subscriptionItem.updated",
  "subscriptionItem.active",
  "subscriptionItem.canceled",
  "subscriptionItem.upcoming",
  "subscriptionItem.ended",
  "subscriptionItem.abandoned",
  "subscriptionItem.incomplete",
  "subscriptionItem.pastDue",
  "subscriptionItem.freeTrialEnding",
]);

export async function POST(request: Request) {
  try {
    const event = (await verifyWebhook(request)) as ClerkWebhookPayload;
    if (!event.type || !BILLING_EVENTS.has(event.type)) {
      return Response.json({ ok: true, ignored: true });
    }

    const payerType =
      event.data?.forPayerType ??
      event.data?.for_payer_type ??
      event.data?.payer?.type ??
      "user";

    if (payerType !== "user") {
      return Response.json({ ok: true, ignored: true, payerType });
    }

    const payerId =
      event.data?.payerId ??
      event.data?.payer_id ??
      event.data?.payer?.id;

    if (!payerId) {
      return Response.json(
        { error: "Webhook payload had no payer ID" },
        { status: 400 },
      );
    }

    await syncUserBillingToConvexFromWebhook({ userId: payerId });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[Clerk Billing Webhook] failed to sync billing", error);
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 400 },
    );
  }
}
