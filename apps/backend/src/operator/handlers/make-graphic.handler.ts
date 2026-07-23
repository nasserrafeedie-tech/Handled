import { Injectable } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Task, type Result, type MakeGraphicResult } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphicsService } from '../graphics/graphics.service';
import { CANVAS, stableSeed, type BrandTheme, type SlideSpec } from '../graphics/slide-templates';
import { TaskHandler, ok, fail } from './handler.interface';
import { StorageService } from '../../common/storage.service';
import { toSvgColors } from '../graphics/color.util';

/**
 * MAKE_GRAPHIC (§7). Render text slides / carousels to crisp PNGs (SVG→PNG, no
 * AI image model — the text is always spelled correctly). Files are written to a
 * local media dir in offline mode; the R2 upload is a one-line swap.
 */
@Injectable()
export class MakeGraphicHandler implements TaskHandler<'MAKE_GRAPHIC'> {
  readonly type = 'MAKE_GRAPHIC' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphics: GraphicsService,
    private readonly storage: StorageService,
  ) {}

  async handle(task: Extract<Task, { type: 'MAKE_GRAPHIC' }>): Promise<Result> {
    const [profile, customer] = await Promise.all([
      this.prisma.brandProfile.findUnique({
        where: { customerId: task.customer_id },
      }),
      this.prisma.customer.findUnique({
        where: { id: task.customer_id },
        select: { businessName: true },
      }),
    ]);

    const theme: BrandTheme = {
      primary: toSvgColors(profile?.brandColors ?? [])[0] ?? '#2C3E50',
      secondary: toSvgColors(profile?.brandColors ?? [])[1],
      // The trading name, not the rambling sentence the owner typed at signup.
      brandName: customer?.businessName ?? undefined,
      style: (profile?.visualStyle as BrandTheme['style']) ?? undefined,
    };

    // One seed for the whole set, rotated per post so this brand's own feed has
    // rhythm while each individual carousel stays cohesive — every slide shares
    // a surface and palette, and only the decoration shifts between them.
    // Seeded off the post count, not randomness, so a re-render of the same
    // post is identical — regenerating a caption shouldn't reshuffle the art.
    const made = await this.prisma.post.count({
      where: { customerId: task.customer_id },
    });
    // Mix in a stable per-brand offset so two businesses don't share a look at
    // the same post number — the same fingerprint fix as the carousel handler.
    const brandOffset = stableSeed(task.customer_id);
    const specs: SlideSpec[] = task.payload.slides.map((s, i) => ({
      kind: s.kind,
      headline: s.headline,
      body: s.body,
      footer: s.footer,
      seed: made + brandOffset,
      variant: i,
    }));

    let pngs: Buffer[];
    try {
      pngs = this.graphics.renderCarousel(specs, theme);
    } catch (err) {
      return fail(
        task.task_id,
        "I couldn't build that graphic — let me try a simpler layout.",
        'render_failed',
        err instanceof Error ? err.message : String(err),
        true,
      );
    }

    // Offline media store: write files locally. Swap for R2 upload in prod.
    // Anchored to this file's location (…/apps/backend) so it doesn't depend on
    // the process working directory. __dirname = …/apps/backend/{src|dist}/operator/handlers.
    const mediaDir =
      process.env.MEDIA_DIR ?? join(__dirname, '..', '..', '..', 'media');
    const batch = randomUUID();
    const dir = join(mediaDir, task.customer_id, batch);
    mkdirSync(dir, { recursive: true });

    const slides: MakeGraphicResult['slides'] = [];
    const refs: string[] = [];
    for (let i = 0; i < pngs.length; i++) {
      const r2Key = `${task.customer_id}/${batch}/slide-${i + 1}.png`;
      await this.storage.put(r2Key, pngs[i], 'image/png');
      await this.prisma.mediaAsset.create({
        data: {
          customerId: task.customer_id,
          postId: task.payload.post_id ?? null,
          kind: 'image',
          source: 'assembled',
          r2Key,
          contentType: 'image/png',
          width: CANVAS,
          height: CANVAS,
        },
      });
      refs.push(r2Key);
      slides.push({
        index: i,
        media_ref: r2Key,
        width: CANVAS,
        height: CANVAS,
        bytes: pngs[i].length,
      });
    }

    if (task.payload.post_id) {
      await this.prisma.post
        .update({
          where: { id: task.payload.post_id },
          data: { mediaRefs: refs },
        })
        .catch(() => undefined);
    }

    const data: MakeGraphicResult = { slides };
    const n = slides.length;
    return ok(
      task.task_id,
      `Made your ${n === 1 ? 'graphic' : `${n}-slide carousel`} — ready to review.`,
      'done',
      data,
    );
  }
}
