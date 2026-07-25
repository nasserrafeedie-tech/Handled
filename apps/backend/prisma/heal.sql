-- One-off recovery: a failed deploy left the 20260724 migration marked FAILED
-- in _prisma_migrations, which makes `prisma migrate deploy` refuse to run
-- (P3009) and the service won't boot. Clear ONLY the failed record (finished_at
-- IS NULL) so deploy can proceed. Scoped to this one migration name and to
-- failed rows only, so it never touches a successfully-applied migration.
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260724_publishing_status_and_published_at'
  AND finished_at IS NULL;
