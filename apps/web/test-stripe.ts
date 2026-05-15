import { Stripe } from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
stripe.prices.list({ limit: 1 }).then(prices => console.log(prices.data[0]));
