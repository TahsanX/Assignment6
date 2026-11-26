import crypto from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import type { Request } from "express";
import type Stripe from "stripe";
import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getStripe } from "../../lib/stripe";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { priceFor, transitionStatus } from "../assessments/assessments.service";
import { logAudit } from "../audit/audit.service";
import { notify } from "../notifications/notifications.service";

const MIN_CHARGE = 0.5; // Stripe minimum for USD

const publicSelect = {
  id: true,
  assessmentId: true,
  amount: true,
  currency: true,
  status: true,
  invoiceNumber: true,
  statusMessage: true,
  paidAt: true,
  createdAt: true,
  assessment: { select: { id: true, title: true, status: true } },
} satisfies Prisma.PaymentSelect;

const invoiceNo = () =>
  `INV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

/* ------------------------------------------------------------------ */
/* Initiate                                                             */
/* ------------------------------------------------------------------ */

export const initiatePayment = async (
  companyId: string,
  assessmentId: string,
  req: Request,
  toClient = false,
) => {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, companyId, deletedAt: null },
    select: { id: true, title: true, status: true, candidateSlots: true },
  });
  if (!assessment) throw ApiError.notFound("Assessment not found");
  if (assessment.status !== "PENDING_PAYMENT") {
    throw ApiError.conflict(
      assessment.status === "DRAFT"
        ? "Request publishing first (POST /assessments/:id/publish-request)"
        : `Assessment is ${assessment.status}; no payment is due`,
    );
  }

  const amount = priceFor(assessment.candidateSlots);
  if (amount < MIN_CHARGE) throw ApiError.badRequest(`Minimum chargeable amount is ${MIN_CHARGE}`);
  const stripe = getStripe();

  // Reuse a still-open checkout session instead of creating duplicates.
  const open = await prisma.payment.findFirst({
    where: { assessmentId, companyId, status: "PENDING", stripeSessionId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (open?.stripeSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(open.stripeSessionId);
    if (existing.status === "open" && existing.url) {
      return {
        paymentId: open.id,
        checkoutUrl: existing.url,
        amount,
        currency: env.PAYMENT_CURRENCY,
        reused: true,
      };
    }
    await prisma.payment.updateMany({
      where: { id: open.id, status: "PENDING" },
      data: { status: "CANCELLED", statusMessage: "Checkout session expired" },
    });
  }

  const payment = await prisma.payment.create({
    data: {
      companyId,
      assessmentId,
      amount,
      currency: env.PAYMENT_CURRENCY,
      invoiceNumber: invoiceNo(),
      status: "INITIATED",
    },
  });

  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: payment.id,
        metadata: { paymentId: payment.id, assessmentId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: env.PAYMENT_CURRENCY,
              unit_amount: Math.round(amount * 100),
              product_data: {
                name: `Publish assessment: ${assessment.title}`,
                description: `${assessment.candidateSlots} candidate slot(s)`,
              },
            },
          },
        ],
        success_url: toClient
          ? `${env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`
          : `${env.APP_URL}/api/v1/payments/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: toClient
          ? `${env.CLIENT_URL}/payment/cancel?payment_id=${payment.id}`
          : `${env.APP_URL}/api/v1/payments/cancel?payment_id=${payment.id}`,
      },
      { idempotencyKey: `checkout-${payment.id}` },
    );

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { stripeSessionId: session.id, status: "PENDING" },
      });
      await logAudit(
        {
          actorId: companyId,
          action: "PAYMENT_INITIATED",
          entity: "Payment",
          entityId: payment.id,
          after: { amount, assessmentId },
          req,
        },
        tx,
      );
    });
    return {
      paymentId: payment.id,
      checkoutUrl: session.url,
      amount,
      currency: env.PAYMENT_CURRENCY,
      reused: false,
    };
  } catch (e) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", statusMessage: "Could not create checkout session" },
    });
    throw e;
  }
};

/* ------------------------------------------------------------------ */
/* Settlement (shared by webhook, success redirect and manual refresh)   */
/* ------------------------------------------------------------------ */

/**
 * Applies a Stripe Checkout Session's state to our records. Idempotent: the guarded
 * updateMany ensures a payment is only completed (and the assessment published) once,
 * even if the webhook and the success redirect arrive concurrently.
 */
export const settleSession = async (session: Stripe.Checkout.Session): Promise<Payment | null> => {
  const payment = await prisma.payment.findUnique({ where: { stripeSessionId: session.id } });
  if (!payment) return null;
  if (payment.status === "COMPLETED") return payment;

  const paid = session.payment_status === "paid";
  const expired = session.status === "expired";

  if (paid) {
    const expectedCents = Math.round(Number(payment.amount) * 100);
    if (session.amount_total !== expectedCents) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "FAILED", statusMessage: "Amount mismatch", rawResponse: session as any },
      });
      throw ApiError.conflict("Paid amount does not match the invoice");
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["INITIATED", "PENDING", "FAILED", "CANCELLED"] } },
        data: {
          status: "COMPLETED",
          paidAt: new Date(),
          paymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id,
          payerReference: session.customer_details?.email ?? null,
          statusMessage: "Payment completed",
          rawResponse: {
            id: session.id,
            amount_total: session.amount_total,
            currency: session.currency,
          } as any,
        },
      });
      if (claimed.count === 0) return; // someone else already settled it

      const assessment = await tx.assessment.findUniqueOrThrow({
        where: { id: payment.assessmentId },
        select: { status: true, title: true },
      });
      if (assessment.status === "PENDING_PAYMENT") {
        await transitionStatus(tx, payment.assessmentId, "PUBLISHED", payment.companyId);
      }
      await logAudit(
        {
          actorId: payment.companyId,
          action: "PAYMENT_COMPLETED",
          entity: "Payment",
          entityId: payment.id,
          after: { sessionId: session.id },
        },
        tx,
      );
      await notify(
        payment.companyId,
        "Payment received",
        `"${assessment.title}" is now published (invoice ${payment.invoiceNumber})`,
        "PAYMENT",
        tx,
      );
    });
  } else if (expired) {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: ["INITIATED", "PENDING"] } },
      data: { status: "CANCELLED", statusMessage: "Checkout session expired" },
    });
  }
  return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
};

/** Success redirect target: verifies the session with Stripe rather than trusting the URL. */
export const handleSuccessRedirect = async (sessionId: string) => {
  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  const payment = await settleSession(session);
  if (!payment) throw ApiError.notFound("Payment not found for this session");
  return {
    paymentId: payment.id,
    status: payment.status,
    invoiceNumber: payment.invoiceNumber,
    assessmentId: payment.assessmentId,
    message: payment.status === "COMPLETED" ? "Payment successful" : "Payment not completed yet",
  };
};

export const handleCancelRedirect = async (paymentId: string) => {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw ApiError.notFound("Payment not found");
  if (payment.status === "PENDING" || payment.status === "INITIATED") {
    await prisma.payment.update({
      where: { id: paymentId },
      data: { status: "CANCELLED", statusMessage: "Cancelled by user" },
    });
    await logAudit({
      actorId: payment.companyId,
      action: "PAYMENT_CANCELLED",
      entity: "Payment",
      entityId: paymentId,
    });
  }
  return { paymentId, status: payment.status === "COMPLETED" ? "COMPLETED" : "CANCELLED" };
};

export const handleWebhook = async (rawBody: Buffer | undefined, signature: string | undefined) => {
  if (!env.STRIPE_WEBHOOK_SECRET) throw ApiError.badRequest("Webhook secret not configured");
  if (!rawBody || !signature) throw ApiError.badRequest("Missing webhook payload or signature");

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw ApiError.badRequest("Invalid webhook signature");
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.expired":
      await settleSession(event.data.object as Stripe.Checkout.Session);
      break;
    case "checkout.session.async_payment_failed": {
      const s = event.data.object as Stripe.Checkout.Session;
      await prisma.payment.updateMany({
        where: { stripeSessionId: s.id, status: { not: "COMPLETED" } },
        data: { status: "FAILED", statusMessage: "Asynchronous payment failed" },
      });
      break;
    }
    default:
      break;
  }
  return { received: true, type: event.type };
};

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

export const getPayment = async (user: NonNullable<Request["user"]>, id: string) => {
  const payment = await prisma.payment.findFirst({
    where: { id, ...(user.role === "ADMIN" ? {} : { companyId: user.id }) },
    select: { ...publicSelect, stripeSessionId: true, paymentIntentId: true, companyId: true },
  });
  if (!payment) throw ApiError.notFound("Payment not found");
  return payment;
};

export const listPayments = async (companyId: string, q: any) => {
  const { page, limit, skip, take } = getPagination(q);
  const where: Prisma.PaymentWhereInput = {
    companyId,
    ...(q.status && { status: q.status }),
    ...(q.assessmentId && { assessmentId: q.assessmentId }),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      select: publicSelect,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    prisma.payment.count({ where }),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
};

export const refreshPayment = async (companyId: string, id: string) => {
  const payment = await prisma.payment.findFirst({ where: { id, companyId } });
  if (!payment) throw ApiError.notFound("Payment not found");
  if (!payment.stripeSessionId) throw ApiError.conflict("Payment has no checkout session");
  const session = await getStripe().checkout.sessions.retrieve(payment.stripeSessionId);
  await settleSession(session);
  return prisma.payment.findUniqueOrThrow({ where: { id }, select: publicSelect });
};
