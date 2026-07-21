-- Flow 4: what actually worked, as opposed to what the research predicted.
--
-- Pooled across every customer on the same archetype so the tenth coffee shop
-- plans from nine shops' real results. Aggregate only — no captions, no
-- customer ids, nothing that identifies one business to another.
CREATE TABLE "archetype_performance" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "archetypeSlug" TEXT         NOT NULL,
  "postArchetype" TEXT         NOT NULL,
  "platform"      TEXT         NOT NULL,
  -- Sums, not averages: a stored average cannot absorb a late metric without
  -- keeping the sample anyway, and rates derived from totals stay correct.
  "samples"       INTEGER      NOT NULL DEFAULT 0,
  "impressions"   BIGINT       NOT NULL DEFAULT 0,
  "engagements"   BIGINT       NOT NULL DEFAULT 0,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archetype_performance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archetype_performance_slug_format_platform_key"
  ON "archetype_performance" ("archetypeSlug", "postArchetype", "platform");

CREATE INDEX "archetype_performance_archetypeSlug_idx"
  ON "archetype_performance" ("archetypeSlug");
