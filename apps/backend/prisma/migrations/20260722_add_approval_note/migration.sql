-- Records how an approval was obtained when it did not come in by text.
-- Nullable and additive: existing rows keep their history, and the normal SMS
-- path leaves it null because the owner's real reply already lives on the
-- conversation.
ALTER TABLE "posts" ADD COLUMN "approvalNote" TEXT;
