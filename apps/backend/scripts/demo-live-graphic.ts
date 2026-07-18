/**
 * LIVE end-to-end demo against the real DB (Neon). Uses the ACTUAL production
 * code paths — the free-text→slides heuristic from the Concierge and the real
 * MakeGraphicHandler — wired by hand (tsx can't run Nest's DI container).
 *
 *   npx tsx --tsconfig apps/backend/tsconfig.json apps/backend/scripts/demo-live-graphic.ts
 *
 * Produces: real media_asset rows in Neon + PNG files under apps/backend/media/.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { parseTask } from '@smm/contracts';
import { PrismaService } from '../src/prisma/prisma.service';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import { MakeGraphicHandler } from '../src/operator/handlers/make-graphic.handler';
import { buildSlidesFromText } from '../src/concierge/concierge.service';

const PHONE = '+15550000001';

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const handler = new MakeGraphicHandler(prisma, new GraphicsService());

  // 1. Seed / reuse a demo customer who has finished onboarding.
  let customer = await prisma.customer.findUnique({ where: { phone: PHONE } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone: PHONE,
        businessName: "Rosa's Coffee",
        status: 'active',
        brandProfile: {
          create: {
            businessType: 'a cozy neighborhood coffee shop',
            voiceTone: 'warm, friendly, a little playful',
            targetCustomer: 'local regulars and morning commuters',
            offers: ['lattes', 'fresh pastries'],
            postingFrequency: 4,
            brandColors: ['#0F172A', '#38BDF8'],
          },
        },
        conversation: { create: {} },
      },
    });
    console.log(`seeded customer ${customer.id} (${PHONE})`);
  } else {
    console.log(`using existing customer ${customer.id} (${PHONE})`);
  }

  // 2. The owner's text → the same heuristic the Concierge uses.
  const text = 'make a promo graphic for 50% off all lattes this Friday';
  console.log(`\n📲 owner texts: "${text}"`);
  const slides = buildSlidesFromText(text);
  console.log(`   → interpreted as ${slides.length} slide(s): ${slides.map((s) => `${s.kind}/"${s.headline}"`).join(', ')}`);

  // 3. The real Task, validated by the §4 contract, run by the real handler.
  const task = parseTask({
    task_id: randomUUID(),
    customer_id: customer.id,
    type: 'MAKE_GRAPHIC',
    payload: { slides },
    requires_approval: false,
    created_by: 'concierge',
    created_at: new Date().toISOString(),
  });
  const result = await handler.handle(task as never);
  console.log(`\n💬 result for owner: "${result.summary_for_owner}" (status=${result.status})`);

  // 4. Show the real media rows the handler wrote to Neon.
  const assets = await prisma.mediaAsset.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  console.log(`\n🖼  media_asset rows in the database: ${assets.length}`);
  for (const a of assets) {
    console.log(`   • ${a.r2Key}  (${a.kind}/${a.source}, ${a.width}x${a.height})`);
  }

  const mediaDir = process.env.MEDIA_DIR ?? `${process.cwd()}/apps/backend/media`;
  if (assets[0]) console.log(`\nOpen it:\n   open "${mediaDir}/${assets[0].r2Key}"`);

  await prisma.$disconnect();
  console.log('\nLIVE DEMO COMPLETE ✓');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
