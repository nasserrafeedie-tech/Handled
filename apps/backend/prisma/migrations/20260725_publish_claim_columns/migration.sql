-- Publish integrity without any enum change (an ALTER TYPE ADD VALUE caused a
-- P3009 lock). Two nullable columns only — always transaction-safe. NB: the
-- Post model maps to table "posts" (@@map), so ALTER the real table name.
--   publishedAt      : when the post actually went live (recap counts key off it)
--   publishStartedAt : the atomic publish claim (stamped before the platform call)
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "publishStartedAt" TIMESTAMP(3);
