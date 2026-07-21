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
import { detectMedia } from '../common/media-type';
import { StorageService } from '../common/storage.service';

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
    private readonly storage: StorageService,
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
      // Read the file rather than believing its declared type. Everything we
      // store — kind, extension, content type — comes from the bytes, so a
      // caller cannot choose what lands in a bucket we serve.
      const detected = detectMedia(f.buffer);
      if (!detected) {
        this.log.warn(
          `rejected upload from ${customerId}: declared ${f.mimetype}, bytes say otherwise`,
        );
        throw new BadRequestException(
          "That file doesn't look like a photo or video we can use — try a JPG, PNG, or MP4.",
        );
      }
      const r2Key = `${customerId}/uploads/${randomUUID()}.${detected.ext}`;
      await this.storage.put(r2Key, f.buffer, detected.contentType);
      await this.prisma.mediaAsset.create({
        data: {
          customerId,
          kind: detected.kind,
          source: 'owner_upload',
          r2Key,
          contentType: detected.contentType,
        },
      });
      kinds.push(detected.kind);
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
        { promptedByOwner: true },
      );
    } else {
      void this.concierge.notify(
        customerId,
        `Got ${files.length === 1 ? 'it' : `all ${files.length}`} — thank you! 📥`,
        { promptedByOwner: true },
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
      await this.concierge.notify(customerId, result.summary_for_owner, {
        promptedByOwner: true,
      });
    } catch (err) {
      this.log.error(`background reel failed for ${customerId}: ${String(err)}`);
      await this.concierge
        .notify(
          customerId,
          'I hit a snag cutting your reel — give me a bit and I\'ll try again.',
          { promptedByOwner: true },
        )
        .catch(() => undefined);
    }
  }
}
