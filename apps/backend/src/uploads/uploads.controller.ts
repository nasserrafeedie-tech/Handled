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
import { diskStorage } from 'multer';
import { closeSync, openSync, readFileSync, readSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConciergeService } from '../concierge/concierge.service';
import { detectMedia } from '../common/media-type';
import { StorageService } from '../common/storage.service';
import { ReelQueueService } from '../scheduler/reel-queue.service';
import { extractBrandColors, MIN_LOGO_SIDE } from '../operator/graphics/logo-colors';
import { tierHas } from '../operator/tier-entitlements';

interface UploadedFileShape {
  originalname: string;
  mimetype: string;
  size: number;
  /** Set by multer disk storage — the temp file we stream from, then delete. */
  path?: string;
  /** Set only in tests / memory storage. Prod uploads arrive on disk (path). */
  buffer?: Buffer;
}

/** The magic bytes we sniff live in the first few bytes; 4KB is ample. */
function readHeader(file: UploadedFileShape): Buffer {
  if (file.buffer) return file.buffer;
  const fd = openSync(file.path!, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
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
    private readonly concierge: ConciergeService,
    private readonly storage: StorageService,
    private readonly reelQueue: ReelQueueService,
  ) {}

  @Post()
  @UseInterceptors(
    AnyFilesInterceptor({
      // Disk storage, NOT the default in-memory buffer: a phone video is
      // 100MB+, and holding several in RAM strains the 512MB web box (the class
      // of failure that took the service down). multer streams each upload to a
      // temp file; we stream that to R2 and delete it — the box never holds a
      // whole clip in memory.
      storage: diskStorage({
        destination: (_req, _file, cb) => cb(null, tmpdir()),
        filename: (_req, _file, cb) => cb(null, randomUUID()),
      }),
      limits: { fileSize: 100 * 1024 * 1024, files: 6 },
    }),
  )
  async upload(
    @Query('customer') customerId: string | undefined,
    @UploadedFiles() files: UploadedFileShape[],
    @Query('kind') kind?: string,
  ): Promise<{ stored: number; kinds: string[] }> {
    if (!customerId) throw new BadRequestException('missing customer');
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('unknown customer');
    if (!files?.length) throw new BadRequestException('no files');

    try {
      if (kind === 'logo') return await this.handleLogo(customerId, files[0]);

      const kinds: string[] = [];

      for (const f of files) {
        // Identify from the bytes, not the declared type — kind, extension and
        // content type all come from what the file actually is, so a caller
        // can't choose what lands in a bucket we serve. We read only the header,
        // never the whole clip, so a 100MB video never enters memory.
        const detected = detectMedia(readHeader(f));
        if (!detected) {
          this.log.warn(
            `rejected upload from ${customerId}: declared ${f.mimetype}, bytes say otherwise`,
          );
          throw new BadRequestException(
            "That file doesn't look like a photo or video we can use — try a JPG, PNG, or MP4.",
          );
        }
        const r2Key = `${customerId}/uploads/${randomUUID()}.${detected.ext}`;
        // Stream the temp file straight to storage — no full read into memory.
        await this.storage.putStream(r2Key, f.path!, detected.contentType, f.size);
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
    } finally {
      // Always delete the temp files multer wrote to disk — on success, on a
      // rejected file, or on any error mid-loop.
      for (const f of files) {
        if (f?.path) {
          try {
            unlinkSync(f.path);
          } catch {
            /* already gone */
          }
        }
      }
    }
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
    // A logo is small, so reading it fully is fine — unlike the video path, we
    // need the whole image for colour extraction and compositing. Support both
    // disk storage (prod: file.path) and an in-memory buffer (tests).
    const bytes = file.buffer ?? readFileSync(file.path!);
    const detected = detectMedia(bytes);
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
    const colors = await extractBrandColors(bytes);
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
      await this.storage.put(r2Key, bytes, detected.contentType);
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
      // Hand the heavy render to the worker queue instead of doing ffmpeg here
      // on the web instance — a 4K/HDR reel needs far more memory than serving a
      // text, and running it in-process is what took the whole service down. The
      // worker texts the finished reel; here we just acknowledge and get out.
      await this.reelQueue.enqueue({ customerId, platform: 'instagram' });
      await this.concierge.notify(
        customerId,
        "Got your clips 🎬 I'm cutting your reel now — I'll send it over in a few minutes.",
        { promptedByOwner: true },
      );
    } catch (err) {
      this.log.error(`could not queue reel for ${customerId}: ${String(err)}`);
      await this.concierge
        .notify(
          customerId,
          'I hit a snag lining up your reel — give me a bit and I\'ll try again.',
          { promptedByOwner: true },
        )
        .catch(() => undefined);
    }
  }
}
