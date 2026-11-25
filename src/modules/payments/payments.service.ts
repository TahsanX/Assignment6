import crypto from "node:crypto";
import type { Payment, Prisma } from "@prisma/client";
import type { Request } from "express";
import { env } from "../../config/env";
import {
  type BkashPaymentResponse,
  createPayment,
  executePayment,
  queryPayment,
} from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../utils/ApiError";
import { buildMeta, getPagination } from "../../utils/pagination";
import { priceFor, transitionStatus } from "../assessments/assessments.service";
import { logAudit } from "../audit/audit.service";
import { notify } from "../notifications/notifications.service";

const MIN_CHARGE = 1; // BDT
const REUSE_WINDOW_MS = 10 * 60 * 1000; // an open bKash payment is reused for 10 minutes

const publicSelect = {
  id: true,
  assessmentId: true,
  amount: true,
  currency: true,
  status: true,
  invoiceNumber: true,
  trxId: true,
  statusMessage: true,
  paidAt: true,
  createdAt: true,
  assessment: { select: { id: true, title: true, status: true } },
} satisfies Prisma.PaymentSelect;

const invoiceNo = () =>
  `INV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const OPEN_STATES = ["INITIATED", "PENDING"] as const;

/* ------------------------------------------------------------------ */
/* Initiate                                                             */
/* ------------------------------------------------------------------ */

export const initiatePayment = async (companyId: string, assessmentId: string, req: Request) => {
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

  // Reuse a recent, still-open bKash payment instead of creating duplicates.
  const open = await prisma.payment.findFirst({
    where: { assessmentId, companyId, status: "PENDING", bkashPaymentId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    const bkashURL = (open.rawResponse as { bkashURL?: string } | null)?.bkashURL;
    if (bkashURL && Date.now() - open.createdAt.getTime() < REUSE_WINDOW_MS) {
      return {
        paymentId: open.id,
        checkoutUrl: bkashURL,
        amount,
        currency: env.PAYMENT_CURRENCY,
        reused: true,
      };
    }
    await prisma.payment.updateMany({
      where: { id: open.id, status: "PENDING" },
      data: { status: "CANCELLED", statusMessage: "Payment session expired" },
    });
  }

  const company = await prisma.user.findUniqueOrThrow({
    where: { id: companyId },
    select: { email: true },
  });
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
    const created = await createPayment({
      amount,
      invoiceNumber: payment.invoiceNumber,
      payerReference: company.email.slice(0, 50),
      callbackURL: `${env.APP_URL}/api/v1/payments/bkash/callback`,
    });
    if (created.statusCode !== "0000" || !created.paymentID || !created.bkashURL) {
      throw new ApiError(502, `bKash could not create the payment: ${created.statusMessage}`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          bkashPaymentId: created.paymentID,
          status: "PENDING",
          payerReference: company.email,
          rawResponse: { bkashURL: created.bkashURL, create: created } as any,
        },
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
      checkoutUrl: created.bkashURL,
      amount,
      currency: env.PAYMENT_CURRENCY,
      reused: false,
    };
  } catch (e) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", statusMessage: "Could not create bKash payment" },
    });
    throw e;
  }
};

/* ------------------------------------------------------------------ */
/* Settlement (shared by the bKash callback and manual refresh)         */
/* ------------------------------------------------------------------ */

const isCompleted = (r: BkashPaymentResponse) =>
  r.statusCode === "0000" && r.transactionStatus === "Completed" && !!r.trxID;

/**
 * Applies a verified bKash execute/query result to our records. Idempotent: the guarded
 * updateMany ensures a payment is completed (and the assessment published) only once, even
 * if the callback and a manual refresh arrive concurrently.
 */
const settle = async (payment: Payment, result: BkashPaymentResponse): Promise<Payment> => {
  if (payment.status === "COMPLETED") return payment;

  if (isCompleted(result)) {
    const amountOk = Number(result.amount) === Number(payment.amount);
    const invoiceOk = result.merchantInvoiceNumber === payment.invoiceNumber;
    if (!amountOk || !invoiceOk) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          statusMessage: "Amount or invoice mismatch",
          rawResponse: result as any,
        },
      });
      throw ApiError.conflict("Paid amount or invoice does not match this payment");
    }

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["INITIATED", "PENDING", "FAILED", "CANCELLED"] } },
        data: {
          status: "COMPLETED",
          paidAt: new Date(),
          trxId: result.trxID,
          payerReference: result.customerMsisdn ?? payment.payerReference,
          statusMessage: "Payment completed",
          rawResponse: result as any,
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
          after: { bkashPaymentId: payment.bkashPaymentId, trxId: result.trxID },
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
  } else if (
    result.transactionStatus === "Failed" ||
    (result.statusCode && result.statusCode !== "0000")
  ) {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [...OPEN_STATES] } },
      data: {
        status: "FAILED",
        statusMessage: result.statusMessage ?? "Payment failed",
        rawResponse: result as any,
      },
    });
  }
  return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
};

/**
 * bKash redirects the customer to callbackURL?paymentID=...&status=success|failure|cancel.
 * The query string is never trusted: on "success" we execute the payment with bKash and
 * verify amount, invoice and transaction status from the response.
 */
export const handleCallback = async (paymentID: string, status: string) => {
  const payment = await prisma.payment.findUnique({ where: { bkashPaymentId: paymentID } });
  if (!payment) throw ApiError.notFound("Payment not found");

  if (payment.status === "COMPLETED") {
    return view(payment, "Payment already completed");
  }

  if (status === "cancel") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [...OPEN_STATES] } },
      data: { status: "CANCELLED", statusMessage: "Cancelled by user" },
    });
    await logAudit({
      actorId: payment.companyId,
      action: "PAYMENT_CANCELLED",
      entity: "Payment",
      entityId: payment.id,
    });
    return view(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }));
  }

  if (status === "failure") {
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: [...OPEN_STATES] } },
      data: { status: "FAILED", statusMessage: "Payment failed at bKash" },
    });
    return view(await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } }));
  }

  // status === "success": execute, falling back to a status query if execute was already done
  let result = await executePayment(paymentID);
  if (!isCompleted(result)) {
    const queried = await queryPayment(paymentID);
    if (isCompleted(queried)) result = queried;
  }
  return view(await settle(payment, result));
};

const view = (payment: Payment, message?: string) => ({
  paymentId: payment.id,
  status: payment.status,
  invoiceNumber: payment.invoiceNumber,
  trxId: payment.trxId,
  assessmentId: payment.assessmentId,
  message:
    message ??
    (payment.status === "COMPLETED"
      ? "Payment successful"
      : `Payment ${payment.status.toLowerCase()}${payment.statusMessage ? `: ${payment.statusMessage}` : ""}`),
});

/* ------------------------------------------------------------------ */
/* Queries                                                              */
/* ------------------------------------------------------------------ */

export const getPayment = async (user: NonNullable<Request["user"]>, id: string) => {
  const payment = await prisma.payment.findFirst({
    where: { id, ...(user.role === "ADMIN" ? {} : { companyId: user.id }) },
    select: { ...publicSelect, bkashPaymentId: true, companyId: true },
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

/** Re-queries bKash for the payment's state (useful if the callback never reached us). */
export const refreshPayment = async (companyId: string, id: string) => {
  const payment = await prisma.payment.findFirst({ where: { id, companyId } });
  if (!payment) throw ApiError.notFound("Payment not found");
  if (!payment.bkashPaymentId) throw ApiError.conflict("Payment has no bKash payment id");
  if (payment.status !== "COMPLETED") {
    const result = await queryPayment(payment.bkashPaymentId);
    // Only act on a definite outcome; an unpaid payment must stay PENDING.
    if (isCompleted(result) || result.transactionStatus === "Failed") await settle(payment, result);
  }
  return prisma.payment.findUniqueOrThrow({ where: { id }, select: publicSelect });
};
