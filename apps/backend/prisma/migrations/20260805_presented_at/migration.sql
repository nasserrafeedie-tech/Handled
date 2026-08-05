-- Draft-presentation durability: when a pending_approval post was last texted
-- to the owner. Null = drafted but never shown; the cron sweep presents those.
ALTER TABLE "posts" ADD COLUMN "presentedAt" TIMESTAMP(3);

-- Backfill old pending drafts as presented so the sweep's first run doesn't
-- blast months-old test drafts at every customer at once. Recent ones (the
-- last few hours) stay null on purpose — those are exactly the strands this
-- sweep exists to rescue.
UPDATE "posts" SET "presentedAt" = "createdAt"
WHERE "status" = 'pending_approval' AND "createdAt" < NOW() - INTERVAL '6 hours';
