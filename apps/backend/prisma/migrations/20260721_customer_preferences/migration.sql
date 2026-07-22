-- The per-customer context engine: what we've learned about how one business
-- likes its posts, beyond the profile it gave at signup. Standing preferences
-- only ("keep them short", "I don't like that color"), never one-off edits,
-- each with a count so a throwaway comment can't rewrite every future post.
CREATE TABLE "customer_preferences" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID         NOT NULL,
  "text"       TEXT         NOT NULL,
  "kind"       TEXT         NOT NULL DEFAULT 'rule',
  "timesSeen"  INTEGER      NOT NULL DEFAULT 1,
  "source"     TEXT         NOT NULL DEFAULT 'conversation',
  "active"     BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_preferences_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "customer_preferences_customerId_active_idx"
  ON "customer_preferences" ("customerId", "active");
