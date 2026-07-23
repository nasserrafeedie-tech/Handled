-- Marks an outbound text as hand-delivered, for the window where Handled can
-- compose messages but Twilio cannot yet send them to US numbers.
ALTER TABLE "messages" ADD COLUMN "relayedAt" TIMESTAMP(3);
