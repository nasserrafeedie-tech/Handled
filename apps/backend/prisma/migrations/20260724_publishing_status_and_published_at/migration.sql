-- Add a 'publishing' claim state so concurrent publishers can't double-post.
ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'publishing';

-- A real publish timestamp, independent of updatedAt.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);
