-- Email as a second channel alongside SMS.
-- Phone becomes nullable (an email-first customer has no number); email is a
-- unique optional identifier; preferredChannel routes outbound sends.
ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "email" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "preferredChannel" TEXT NOT NULL DEFAULT 'sms';
CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_key" ON "customers"("email");
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'sms';
