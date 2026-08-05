-- Text-to-join paywall: one free drafted caption per customer, ever.
-- Null = unused. Stamped when the free draft is delivered; never reset.
ALTER TABLE "customers" ADD COLUMN "freeDraftUsedAt" TIMESTAMP(3);
