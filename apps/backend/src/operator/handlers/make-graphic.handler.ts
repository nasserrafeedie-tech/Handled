import { Injectable } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type Task, type Result, type MakeGraphicResult } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GraphicsService } from '../graphics/graphics.service';
import { CANVAS, type BrandTheme, type SlideSpec } from '../graphics/slide-templates';
import { TaskHandler, ok, fail } from './handler.interface';

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
  ) {}

  async handle(task: Extract<Task, { type: 'MAKE_GRAPHIC' }>): Promise<Result> {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId: task.customer_id },
    });

    const theme: BrandTheme = {
      primary: profile?.brandColors?.[0] ?? '#0F172A',
      secondary: profile?.brandColors?.[1],
      brandName: profile?.businessType ?? undefined,
    };

    const specs: SlideSpec[] = task.payload.slides.map((s) => ({
      kind: s.kind,
      headline: s.headline,
      body: s.body,
      footer: s.footer,
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
      const filePath = join(mediaDir, r2Key);
      writeFileSync(filePath, pngs[i]);
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
