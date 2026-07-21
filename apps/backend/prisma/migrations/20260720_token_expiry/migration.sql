-- Track when a platform connection lapses, so owners can be asked to reconnect
-- before posting stops rather than after. Meta Business tokens last ~59 days
-- and cannot be refreshed without the owner present.
ALTER TABLE "connected_accounts"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "reauthAskedAt" TIMESTAMP(3);

-- The daily sweep filters on expiry.
CREATE INDEX "connected_accounts_expiresAt_idx"
  ON "connected_accounts" ("expiresAt");
