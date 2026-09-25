import "server-only";

import type Stripe from "stripe";
import {
  resolvePresentPlanKey,
  type PresentPlanKey,
} from "../../../../../packages/shared/src/billing";

/**
 * Which Present plan a Stripe price belongs to.
 *
 * The product's `plan` metadata first (`free`, `pro`, `power`), because it
 * stays with the product whatever happens to its prices; then the price's
 * lookup key; then the product's name. A subscription used to be read by
 * lookup key alone, so moving a key to a new price would have dropped
 * everybody still on the old one to Free.
 */
export const planKeyOfPrice = async (
  stripe: Stripe,
  price: Stripe.Price | null | undefined,
): Promise<PresentPlanKey> => {
  if (!price) return "free";
  const product =
    typeof price.product === "string"
      ? await stripe.products.retrieve(price.product).catch(() => null)
      : price.product;
  const live = product && !("deleted" in product && product.deleted) ? (product as Stripe.Product) : null;
  return resolvePresentPlanKey(
    live?.metadata?.plan || price.metadata?.plan || price.lookup_key || live?.name,
  );
};
