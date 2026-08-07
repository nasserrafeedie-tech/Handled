-- What the picture is OF (photo-walk shot key or free text), so the drafter
-- can pick the right banked photo for a post instead of the most recent one.
ALTER TABLE "media_assets" ADD COLUMN "subject" TEXT;
