-- Generated photography for owners who don't have time to shoot their own.
--
-- Opt-in is separate from the plan tier: the tier decides who *can* use it,
-- this decides who *chose* to. Posting model-made imagery changes how a
-- business represents itself, so it is never on by default.
ALTER TABLE "customers"
  ADD COLUMN "aiImagesOptIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiImagesOptInAt" TIMESTAMP(3);

-- Carried on the post itself rather than joined from media_assets, because it
-- has to reach the platform: Instagram and TikTok both require AI-generated
-- content to be declared at publish time.
ALTER TABLE "posts"
  ADD COLUMN "aiGeneratedMedia" BOOLEAN NOT NULL DEFAULT false;
