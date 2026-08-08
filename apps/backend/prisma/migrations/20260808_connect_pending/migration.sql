-- The in-flight OAuth connect: on mobile the return often lands in a
-- different browser context than the one that started it, so the server
-- keeps the association instead of the browser.
ALTER TABLE "customers" ADD COLUMN "connectPendingPlatform" TEXT;
ALTER TABLE "customers" ADD COLUMN "connectPendingAt" TIMESTAMP(3);
