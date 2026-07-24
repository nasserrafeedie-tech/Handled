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
import { extractBrandColors, MIN_LOGO_SIDE } from '../operator/graphics/logo-colors';
import { tierHas } from '../operator/tier-entitlements';

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
    @Query('kind') kind?: string,
  ): Promise<{ stored: number; kinds: string[] }> {
    if (!customerId) throw new BadRequestException('missing customer');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('unknown customer');
    if (!files?.length) throw new BadRequestException('no files');

    if (kind === 'logo') return this.handleLogo(customerId, files[0]);

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
    if (bankedVideos >= 2 && tierHas(customer.planTier, 'reel')) {
      void this.assembleAndNotify(customerId);
    } else if (kinds.includes('video') && !tierHas(customer.planTier, 'reel')) {
      void this.concierge.notify(
        customerId,
        'Got your videos! Quick note — reels are part of the Pro plan. Reply UPGRADE and I\'ll send the details, or I\'ll keep them on file.',
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

  /**
   * A logo is not a post photo. It is stored ONLY as brandProfile.logoRef — never
   * as a MediaAsset — because a MediaAsset with source owner_upload would get
   * picked up as a banked photo and land on an actual post. From the logo we pull
   * the brand colours (best source we have) and confirm back so the owner can
   * correct us; a wrong colour on every post is worse than asking.
   */
  private async handleLogo(
    customerId: string,
    file: UploadedFileShape,
  ): Promise<{ stored: number; kinds: string[] }> {
    const detected = detectMedia(file.buffer);
    if (!detected || detected.kind !== 'image') {
      throw new BadRequestException(
        'That doesn\'t look like a logo image — send a PNG or JPG of your logo.',
      );
    }
    // Extract colours (and measure the logo) before writing. Colours survive any
    // resolution — a tiny logo still gives the right hues — so we take them from
    // any logo. But we only STAMP the logo onto posts when it's sharp enough:
    // scaling a low-res mark up into the badge looks blurry, and a clean text
    // name beats a fuzzy logo on every post.
    const colors = await extractBrandColors(file.buffer);
    const existing = await this.prisma.brandProfile.findUnique({
      where: { customerId },
      select: { brandColors: true },
    });
    const extracted = [colors.primary, colors.secondary].filter(
      (c): c is string => Boolean(c),
    );
    const longSide = Math.max(colors.width ?? 0, colors.height ?? 0);
    const sharpEnough = longSide >= MIN_LOGO_SIDE;

    // Store the file and set logoRef ONLY when it's worth compositing — a logo
    // we won't stamp is not worth keeping, and an unset logoRef is exactly what
    // makes the renderer skip the badge and keep the text footer.
    let r2Key: string | undefined;
    if (sharpEnough) {
      r2Key = `${customerId}/logo.${detected.ext}`;
      await this.storage.put(r2Key, file.buffer, detected.contentType);
    }
    // Fill brand colours from the logo only when we don't already have the
    // owner's own words — an explicit "we're teal" is more intentional.
    const takeColors = extracted.length > 0 && !(existing?.brandColors?.length);

    if (r2Key || takeColors) {
      await this.prisma.brandProfile.update({
        where: { customerId },
        data: {
          ...(r2Key ? { logoRef: r2Key } : {}),
          ...(takeColors ? { brandColors: extracted } : {}),
        },
      });
    }

    const colourLine = takeColors
      ? 'I pulled your brand colours from it'
      : extracted.length > 0
        ? 'I\'ll keep the colours you already gave me'
        : 'I couldn\'t read clear colours from it — tell me your colours (like "we\'re teal and gold") and I\'ll use those';
    const msg = sharpEnough
      ? `Got your logo — ${colourLine}, and it'll go on your posts. 🎨`
      : `Got your logo — ${colourLine}. Heads up: it's a bit low-res to put on ` +
        `your posts crisply, so if you have a larger version, send it over and ` +
        `I'll add it. Otherwise your colours are set. 👍`;
    void this.concierge.notify(customerId, msg, { promptedByOwner: true });

    this.log.log(
      `logo for ${customerId}: ${longSide}px longSide, ` +
        `${sharpEnough ? 'composited' : 'too low-res, colours only'}, ` +
        `colours ${takeColors ? extracted.join('+') : 'not taken'}`,
    );
    return { stored: 1, kinds: ['logo'] };
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
