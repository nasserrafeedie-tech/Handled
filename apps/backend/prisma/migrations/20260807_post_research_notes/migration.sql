-- The web-researched fact block a post was written from — reused by the
-- carousel builder and auditable when a claim is questioned.
ALTER TABLE "posts" ADD COLUMN "researchNotes" TEXT;
