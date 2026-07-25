-- Boot-time self-heal for Prisma P3009/P3018: a migration that started but
-- never finished (and wasn't rolled back) is a FAILED migration, and it blocks
-- every subsequent `migrate deploy`. Clear those stuck records so a corrected
-- migration can re-apply. Safe: migrate deploy runs sequentially AFTER this, so
-- nothing is legitimately in-progress at this moment.
DELETE FROM "_prisma_migrations"
WHERE finished_at IS NULL
  AND rolled_back_at IS NULL;
