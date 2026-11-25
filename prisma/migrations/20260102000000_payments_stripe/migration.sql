-- Payment gateway is Stripe Checkout: rename gateway columns and default currency.
ALTER TABLE "Payment" RENAME COLUMN "bkashPaymentId" TO "stripeSessionId";
ALTER TABLE "Payment" RENAME COLUMN "trxId" TO "paymentIntentId";
ALTER INDEX "Payment_bkashPaymentId_key" RENAME TO "Payment_stripeSessionId_key";
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'usd';
