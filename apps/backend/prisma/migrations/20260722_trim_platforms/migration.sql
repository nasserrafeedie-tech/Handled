-- Drop X, LinkedIn and YouTube from the Platform enum.
--
-- They are a poor fit for the local businesses this is built for, and every
-- platform kept is another set of limits, failure modes and token refreshes to
-- maintain. TikTok stays: its Photo Mode publishes 2–35 image carousels, so the
-- flagship carousel format works there natively without any video support.
--
-- Postgres cannot remove a value from an enum in place, so the type is rebuilt
-- and the two referencing columns are re-pointed at it. Safe to run: this was
-- authored while both tables were empty, and it fails loudly rather than
-- silently dropping rows if any row still holds a removed value.
BEGIN;

CREATE TYPE "Platform_new" AS ENUM ('instagram', 'facebook', 'tiktok', 'threads');

ALTER TABLE "connected_accounts"
  ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");
ALTER TABLE "posts"
  ALTER COLUMN "platform" TYPE "Platform_new" USING ("platform"::text::"Platform_new");

ALTER TYPE "Platform" RENAME TO "Platform_old";
ALTER TYPE "Platform_new" RENAME TO "Platform";
DROP TYPE "Platform_old";

COMMIT;
