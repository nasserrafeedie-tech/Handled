-- Publish integrity without any enum change (the ALTER TYPE ADD VALUE approach
-- caused a P3009 lock). Two nullable columns only — always transaction-safe:
--   publishedAt      : when the post actually went live (recap counts key off it)
--   publishStartedAt : the atomic publish claim (stamped before the platform call)
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "publishStartedAt" TIMESTAMP(3);
