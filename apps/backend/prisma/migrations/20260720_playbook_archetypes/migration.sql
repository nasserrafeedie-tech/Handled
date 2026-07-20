-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "archetypeConfidence" DOUBLE PRECISION,
ADD COLUMN     "archetypeSlug" TEXT;

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "playbookSlug" TEXT;

-- CreateTable
CREATE TABLE "playbook_archetypes" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mapsFrom" TEXT[],
    "platforms" JSONB NOT NULL,
    "pillars" JSONB NOT NULL,
    "topFormats" JSONB NOT NULL,
    "cadence" JSONB NOT NULL,
    "reels" JSONB NOT NULL,
    "photoStyle" TEXT NOT NULL,
    "captionHooks" JSONB NOT NULL,
    "discovery" JSONB NOT NULL,
    "offers" JSONB NOT NULL,
    "seasonal" JSONB NOT NULL,
    "mistakes" JSONB NOT NULL,
    "revenueMetric" TEXT NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'seed',
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "playbook_archetypes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "playbook_archetypes_slug_key" ON "playbook_archetypes"("slug");

-- CreateIndex
CREATE INDEX "playbook_archetypes_status_idx" ON "playbook_archetypes"("status");

