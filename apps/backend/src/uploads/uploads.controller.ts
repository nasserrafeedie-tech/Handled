import {
  Controller,
  NotFoundException,
  BadRequestException,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
  Logger,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Task } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { ConciergeService } from '../concierge/concierge.service';

interface UploadedFileShape {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Clip/photo upload endpoint behind the link we text owners. MMS caps around
 * 5MB, which no real phone video fits under — so video arrives through a
 * one-tap browser upload instead. Same trust model as /connect: the link
 * carries the customer's unguessable id.
 *
 * When enough video lands and the plan allows it, a reel assembles itself in
 * the background and the owner gets a text when it's ready — the upload page
 * never makes them wait on an encode.
 */
@Controller('uploads')
export class UploadsController {
  private readonly log = new Logger(UploadsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: TaskBus,
    private readonly concierge: ConciergeService,
  ) {}

  @Post()
  @UseInterceptors(AnyFilesInterceptor({ limits: { fileSize: 100 * 1024 * 1024, files: 6 } }))
  async upload(
    @Query('customer') customerId: string | undefined,
    @UploadedFiles() files: UploadedFileShape[],
  ): Promise<{ stored: number; kinds: string[] }> {
    if (!customerId) throw new BadRequestException('missing customer');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('unknown customer');
    if (!files?.length) throw new BadRequestException('no files');

    const mediaDir = process.env.MEDIA_DIR ?? join(__dirname, '..', '..', 'media');
    const kinds: string[] = [];

    for (const f of files) {
      const kind = f.mimetype.startsWith('video') ? 'video' : 'image';
      if (!/^(video|image)\//.test(f.mimetype)) {
        throw new BadRequestException(`unsupported type ${f.mimetype}`);
      }
      const ext = f.mimetype.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
      const r2Key = `${customerId}/uploads/${randomUUID()}.${ext}`;
      mkdirSync(join(mediaDir, customerId, 'uploads'), { recursive: true });
      writeFileSync(join(mediaDir, r2Key), f.buffer);
      await this.prisma.mediaAsset.create({
        data: {
          customerId,
          kind,
          source: 'owner_upload',
          r2Key,
          contentType: f.mimetype,
        },
      });
      kinds.push(kind);
    }

    // Enough banked video → cut the reel in the background; text when done.
    const bankedVideos = await this.prisma.mediaAsset.count({
      where: { customerId, kind: 'video', source: 'owner_upload', postId: null },
    });
    if (bankedVideos >= 2 && customer.planTier !== 'starter') {
      void this.assembleAndNotify(customerId);
    } else if (kinds.includes('video') && customer.planTier === 'starter') {
      void this.concierge.notify(
        customerId,
        'Got your videos! Quick note — reels are part of the Growth plan. Reply UPGRADE and I\'ll send the details, or I\'ll keep them on file.',
      );
    } else {
      void this.concierge.notify(
        customerId,
        `Got ${files.length === 1 ? 'it' : `all ${files.length}`} — thank you! 📥`,
      );
    }

    return { stored: files.length, kinds };
  }

  private async assembleAndNotify(customerId: string): Promise<void> {
    try {
      const task: Task = {
        task_id: randomUUID(),
        customer_id: customerId,
        type: 'ASSEMBLE_REEL',
        payload: { platform: 'instagram' },
        requires_approval: false,
        created_by: 'concierge',
        created_at: new Date().toISOString(),
      } as Task;
      const result = await this.bus.emit(task);
      await this.concierge.notify(customerId, result.summary_for_owner);
    } catch (err) {
      this.log.error(`background reel failed for ${customerId}: ${String(err)}`);
      await this.concierge
        .notify(customerId, 'I hit a snag cutting your reel — give me a bit and I\'ll try again.')
        .catch(() => undefined);
    }
  }
}
