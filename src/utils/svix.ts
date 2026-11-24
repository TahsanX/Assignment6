import crypto from "node:crypto";

/**
 * Verifies a Svix-signed webhook (the scheme Clerk uses) without the ESM-only svix package.
 * Returns the parsed JSON payload, or throws if the signature/timestamp is invalid.
 */
export const verifySvixWebhook = (
  secret: string,
  rawBody: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  toleranceSeconds = 300,
) => {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw new Error("Missing svix headers");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) throw new Error("Timestamp out of range");

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  const valid = signature.split(" ").some((part) => {
    const [, sig] = part.split(",");
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!valid) throw new Error("Invalid signature");

  return JSON.parse(rawBody) as { type: string; data: any };
};
