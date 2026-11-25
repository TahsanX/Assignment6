import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";

/**
 * Minimal bKash Tokenized Checkout client (sandbox or production, chosen by BKASH_BASE_URL).
 * Flow: grant token -> create payment (returns bkashURL) -> customer pays -> callback -> execute.
 */

export type BkashCreateResponse = {
  paymentID?: string;
  bkashURL?: string;
  statusCode: string;
  statusMessage: string;
  merchantInvoiceNumber?: string;
  amount?: string;
};

export type BkashPaymentResponse = {
  paymentID?: string;
  trxID?: string;
  transactionStatus?: string; // Initiated | Completed | Failed ...
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  payerReference?: string;
  customerMsisdn?: string;
  statusCode: string;
  statusMessage: string;
};

let cached: { token: string; expiresAt: number } | null = null;

const assertConfigured = () => {
  if (!env.BKASH_APP_KEY || !env.BKASH_APP_SECRET || !env.BKASH_USERNAME || !env.BKASH_PASSWORD) {
    throw new ApiError(503, "Payment gateway is not configured");
  }
};

const post = async <T>(path: string, body: unknown, headers: Record<string, string>) => {
  let res: Response;
  try {
    res = await fetch(`${env.BKASH_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(502, "Could not reach the payment gateway");
  }
  const json = (await res.json().catch(() => null)) as T | null;
  if (!json) throw new ApiError(502, "Payment gateway returned an invalid response");
  return json;
};

/** id_token is valid for about an hour; it is cached in memory with a safety margin. */
export const grantToken = async (): Promise<string> => {
  assertConfigured();
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await post<{
    id_token?: string;
    expires_in?: number;
    statusCode?: string;
    statusMessage?: string;
  }>(
    "/tokenized/checkout/token/grant",
    { app_key: env.BKASH_APP_KEY, app_secret: env.BKASH_APP_SECRET },
    { username: env.BKASH_USERNAME, password: env.BKASH_PASSWORD },
  );
  if (!res.id_token) {
    throw new ApiError(502, `bKash authentication failed: ${res.statusMessage ?? "unknown error"}`);
  }
  cached = { token: res.id_token, expiresAt: Date.now() + ((res.expires_in ?? 3600) - 300) * 1000 };
  return res.id_token;
};

const authed = async () => ({
  authorization: await grantToken(),
  "x-app-key": env.BKASH_APP_KEY,
});

export const createPayment = async (params: {
  amount: number;
  invoiceNumber: string;
  payerReference: string;
  callbackURL: string;
}) =>
  post<BkashCreateResponse>(
    "/tokenized/checkout/create",
    {
      mode: "0011",
      payerReference: params.payerReference,
      callbackURL: params.callbackURL,
      amount: params.amount.toFixed(2),
      currency: env.PAYMENT_CURRENCY,
      intent: "sale",
      merchantInvoiceNumber: params.invoiceNumber,
    },
    await authed(),
  );

export const executePayment = async (paymentID: string) =>
  post<BkashPaymentResponse>("/tokenized/checkout/execute", { paymentID }, await authed());

export const queryPayment = async (paymentID: string) =>
  post<BkashPaymentResponse>("/tokenized/checkout/payment/status", { paymentID }, await authed());
