import type Stripe from "stripe";
import { getStripe } from "@/lib/server/stripe";
import { planKeyOfPrice } from "@/lib/server/stripe-plan";
import {
  BillingError,
  billingErrorResponse,
  currentSubscription,
  findCustomer,
  isPurchasable,
  planLabelOf,
  priceFor,
  requireUser,
  syncNow,
} from "@/lib/server/present-billing";

/**
 * The plan someone pays for, and changing it, for the Billing page.
 *
 * GET: the subscription, its card, what is due next and past invoices.
 * POST `{ action }`:
 * - `preview` `{ lookupKey }`: what switching would cost today.
 * - `change` `{ lookupKey }`: switch, prorated. Moving up is charged now;
 *   moving down is credited against the next bills.
 * - `cancel`: stop at the end of the period already paid for.
 * - `resume`: undo a cancellation that hasn't happened yet.
 */

const cardOf = (method: Stripe.PaymentMethod | string | null | undefined) => {
  if (!method || typeof method === "string" || !method.card) return null;
  return {
    brand: method.card.brand,
    last4: method.card.last4,
    expMonth: method.card.exp_month,
    expYear: method.card.exp_year,
  };
};

export async function GET() {
  try {
    const { userId } = await requireUser();
    const stripe = getStripe();
    const customer = await findCustomer(stripe, userId);
    if (!customer) return Response.json({ subscription: null, invoices: [], card: null });

    const [current, invoices, fullCustomer] = await Promise.all([
      currentSubscription(stripe, customer.id),
      stripe.invoices.list({ customer: customer.id, limit: 12 }),
      stripe.customers.retrieve(customer.id, { expand: ["invoice_settings.default_payment_method"] }),
    ]);

    const customerCard =
      !("deleted" in fullCustomer) || !fullCustomer.deleted
        ? cardOf((fullCustomer as Stripe.Customer).invoice_settings?.default_payment_method as Stripe.PaymentMethod | null)
        : null;

    let upcoming: { amountDue: number; currency: string; date: number | null } | null = null;
    if (current && !current.subscription.cancel_at_period_end && current.subscription.status !== "incomplete") {
      const preview = await stripe.invoices
        .createPreview({ customer: customer.id, subscription: current.subscription.id })
        .catch(() => null);
      if (preview) {
        upcoming = {
          amountDue: preview.amount_due,
          currency: preview.currency,
          date: (preview.next_payment_attempt ?? current.item.current_period_end) * 1000,
        };
      }
    }

    return Response.json({
      subscription: current
        ? {
            id: current.subscription.id,
            planKey: current.planKey,
            planLabel: planLabelOf(current.planKey),
            lookupKey: current.item.price.lookup_key,
            interval: current.item.price.recurring?.interval ?? "month",
            amount: current.item.price.unit_amount ?? 0,
            currency: current.item.price.currency,
            status: current.subscription.status,
            currentPeriodEnd: current.item.current_period_end * 1000,
            cancelAtPeriodEnd: current.subscription.cancel_at_period_end,
            cancelAt: current.subscription.cancel_at ? current.subscription.cancel_at * 1000 : null,
          }
        : null,
      card: cardOf(current?.subscription.default_payment_method as Stripe.PaymentMethod | null) ?? customerCard,
      upcoming,
      invoices: invoices.data
        .filter((invoice) => invoice.status !== "draft")
        .map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          date: invoice.created * 1000,
          amount: invoice.total,
          currency: invoice.currency,
          status: invoice.status,
          url: invoice.hosted_invoice_url,
          pdf: invoice.invoice_pdf,
        })),
    });
  } catch (error) {
    return billingErrorResponse(error, "reading the subscription failed");
  }
}

export async function POST(request: Request) {
  try {
    const { userId, getToken } = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { action?: unknown; lookupKey?: unknown };
    const stripe = getStripe();
    const customer = await findCustomer(stripe, userId);
    const current = customer ? await currentSubscription(stripe, customer.id) : null;
    if (!customer || !current) throw new BillingError("You don't have a paid plan to change.", 404);
    const { subscription, item } = current;

    if (body.action === "cancel" || body.action === "resume") {
      await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: body.action === "cancel" });
      await syncNow(userId, getToken);
      return Response.json({ ok: true });
    }

    if (body.action !== "preview" && body.action !== "change") throw new BillingError("Unknown billing action.");
    if (!isPurchasable(body.lookupKey)) throw new BillingError("Choose Pro or Power, monthly or yearly.");
    const price = await priceFor(stripe, body.lookupKey);
    if (price.id === item.price.id) throw new BillingError("You're already on that plan.");

    // Up is anything that costs more a year: charged the difference now.
    // Down is credited, and the credit comes off the next bills.
    const yearly = (value: Stripe.Price) =>
      (value.unit_amount ?? 0) * (value.recurring?.interval === "year" ? 1 : 12);
    const isUpgrade = yearly(price) > yearly(item.price);
    const prorationBehavior = isUpgrade ? "always_invoice" : "create_prorations";

    if (body.action === "preview") {
      const preview = await stripe.invoices.createPreview({
        customer: customer.id,
        subscription: subscription.id,
        subscription_details: {
          items: [{ id: item.id, price: price.id }],
          proration_behavior: prorationBehavior,
        },
      });
      const nextPlanKey = await planKeyOfPrice(stripe, price);
      return Response.json({
        isUpgrade,
        planLabel: planLabelOf(nextPlanKey),
        interval: price.recurring?.interval ?? "month",
        amount: price.unit_amount ?? 0,
        currency: price.currency,
        // What they pay today when moving up; what the next bill comes to otherwise.
        dueNow: isUpgrade ? preview.amount_due : 0,
        nextAmount: isUpgrade ? null : preview.amount_due,
      });
    }

    // Choosing a plan is choosing to stay: a cancellation waiting at the end
    // of the period is undone first, since a pending update can't carry it.
    if (subscription.cancel_at_period_end) {
      await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: false });
    }
    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: price.id }],
      proration_behavior: prorationBehavior,
      // A declined card leaves the plan as it was rather than half-changed.
      payment_behavior: isUpgrade ? "pending_if_incomplete" : "allow_incomplete",
    });
    await syncNow(userId, getToken);
    const pending = Boolean(updated.pending_update);
    return Response.json({
      ok: !pending,
      message: pending ? "Your card was declined, so the plan didn't change. Update your card and try again." : null,
    });
  } catch (error) {
    return billingErrorResponse(error, "changing the subscription failed");
  }
}
