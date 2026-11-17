-- Posts the owner asked for by text, carried into the next week's plan.
ALTER TABLE "brand_profiles" ADD COLUMN "postRequests" TEXT[] DEFAULT ARRAY[]::TEXT[];
