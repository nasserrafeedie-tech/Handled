/**
 * One-time (idempotent) import of `social-playbook.md` into the archetype
 * store — handoff task 10's "seed the archetype store".
 *
 * Run:
 *   npx tsx --tsconfig apps/backend/tsconfig.json apps/backend/scripts/seed-playbook.ts
 *
 * Re-running is safe: rows are upserted by slug, and research-enriched rows
 * keep their status/confidence/sources. Point PLAYBOOK_DOC_PATH at
 * ~/handled-hq/operations/social-playbook.md to import Nasser's edits instead
 * of the in-repo seed copy.
 */
import { PrismaClient } from '@prisma/client';
import { PlaybookService } from '../src/playbook/playbook.service';
import type { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaClient();
  const service = new PlaybookService(prisma as unknown as PrismaService);

  const path = process.env.PLAYBOOK_DOC_PATH;
  const { imported, slugs } = await service.importFromDoc(path);

  console.log(`Imported ${imported} archetypes:`);
  for (const slug of slugs) console.log(`  · ${slug}`);

  const rows = await prisma.playbookArchetype.findMany({
    select: { slug: true, status: true, confidence: true, usageCount: true },
    orderBy: { slug: 'asc' },
  });
  console.log(`\nStore now holds ${rows.length} archetypes:`);
  for (const r of rows) {
    console.log(
      `  ${r.slug.padEnd(44)} ${r.status.padEnd(12)} conf ${r.confidence.toFixed(2)}  used ${r.usageCount}`,
    );
  }
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
