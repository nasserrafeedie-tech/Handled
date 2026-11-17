-- Automatic referral credit: one row per referred customer, applied as a
-- negative Stripe customer balance on the referrer. The unique key on the
-- referred customer is the guarantee that a referral pays out once.
CREATE TABLE "referral_credits" (
    "id" UUID NOT NULL,
    "referrerId" UUID NOT NULL,
    "referredCustomerId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "stripeBalanceTxnId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "referral_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "referral_credits_referredCustomerId_key" ON "referral_credits"("referredCustomerId");
CREATE INDEX "referral_credits_status_idx" ON "referral_credits"("status");
CREATE INDEX "referral_credits_referrerId_idx" ON "referral_credits"("referrerId");
