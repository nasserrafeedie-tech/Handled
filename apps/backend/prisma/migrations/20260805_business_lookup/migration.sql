-- "Look you up" onboarding: the owner's link, the distilled web research on
-- their business, and the bespoke follow-up question queue.
ALTER TABLE "brand_profiles" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "brand_profiles" ADD COLUMN "businessResearch" TEXT;
ALTER TABLE "brand_profiles" ADD COLUMN "followUps" JSONB;
