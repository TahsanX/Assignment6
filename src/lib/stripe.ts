import Stripe from "stripe";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

let client: Stripe | null = null;

/** Lazily created so the API can boot (and non-payment routes work) without Stripe keys. */
export const getStripe = (): Stripe => {
  if (!env.STRIPE_SECRET_KEY) throw new ApiError(503, "Payment gateway is not configured");
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY);
  return client;
};
