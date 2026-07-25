import { Injectable, Logger } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage.service';
import { detectMedia } from '../../common/media-type';
import { TaskHandler, ok } from './handler.interface';

/** Refuse anything absurdly large — a carrier MMS is a few MB at most. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * INGEST_MEDIA (§7). Owner texted a photo/video → fetch the bytes, store them
 * in R2, link the stored key to the waiting post / shot_list_request, mark it
 * fulfilled.
 *
 * The fetch-and-store used to be a stub: the handler minted a storage key and
 * told the owner "added it to your post" without ever downloading the image.
 * The post then carried a `mediaRef` pointing at bytes that did not exist, and
 * published with a broken/empty picture — after promising the owner it was
 * handled. So the store now happens for real, and NOTHING is linked or claimed
 * unless the bytes actually landed.
 */
@Injectable()
export class IngestMediaHandler implements TaskHandler<'INGEST_MEDIA'> {
  readonly type = 'INGEST_MEDIA' as const;
  private readonly log = new Logger(IngestMediaHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async handle(task: Extract<Task, { type: 'INGEST_MEDIA' }>): Promise<Result> {
    const { content_type, post_id, shot_list_request_id, source_url } =
      task.payload;

    // Fetch the actual bytes before touching the database. If this fails there
    // is no photo, so we must not create a record that says there is one.
    let bytes: Buffer;
    try {
      bytes = await this.download(source_url);
    } catch (err) {
      this.log.warn(`INGEST_MEDIA fetch failed for ${task.customer_id}: ${String(err)}`);
      // Honest failure — the owner sent something and we could not take it, so
      // say so instead of a silent success that publishes an empty post.
      return ok(
        task.task_id,
        "Hmm, that photo didn't come through on my end — mind sending it once more?",
        'done',
        { media_asset_id: null },
      );
    }

    // Trust the bytes over the carrier's declared type: `content_type` is a
    // claim from the MMS envelope, and it is what `kind` hangs off of.
    const detected = detectMedia(bytes);
    const contentType = detected?.contentType ?? content_type;
    const kind = detected?.kind ?? (content_type.startsWith('video') ? 'video' : 'image');
    // Append the true extension so the local static server serves the right
    // Content-Type (it infers from the extension; a key with none serves
    // application/octet-stream).
    const ext = detected?.ext ? `.${detected.ext}` : '';
    const r2Key = `owner/${task.customer_id}/${task.task_id}${ext}`;

    try {
      await this.storage.put(r2Key, bytes, contentType);
    } catch (err) {
      // Storage (R2) rejected it. Don't record a mediaRef that resolves to
      // nothing — tell the owner honestly, same as a failed fetch.
      this.log.warn(`INGEST_MEDIA store failed for ${task.customer_id}: ${String(err)}`);
      return ok(
        task.task_id,
        "That photo didn't save on my end — mind sending it once more?",
        'done',
        { media_asset_id: null },
      );
    }

    const asset = await this.prisma.mediaAsset.create({
      data: {
        customerId: task.customer_id,
        postId: post_id ?? null,
        kind,
        source: 'owner_upload',
        r2Key,
        contentType,
      },
    });

    let fulfilledAsk = false;
    let attachedPost: { platform: string } | null = null;

    if (shot_list_request_id) {
      await this.prisma.shotListRequest.update({
        where: { id: shot_list_request_id },
        data: { status: 'fulfilled', fulfilledBy: asset.id, fulfilledAt: new Date() },
      });
      fulfilledAsk = true;
    }
    if (post_id) {
      const post = await this.prisma.post.findUnique({ where: { id: post_id } });
      if (post) {
        await this.prisma.post.update({
          where: { id: post_id },
          data: { mediaRefs: [...post.mediaRefs, r2Key] },
        });
        await this.prisma.mediaAsset.update({
          where: { id: asset.id },
          data: { postId: post.id },
        });
        attachedPost = { platform: post.platform };
      }
    }

    // Tell the owner where their photo actually went — "thanks" alone reads
    // like it fell into a void, and the void is why owners stop sending photos.
    const summary = attachedPost
      ? fulfilledAsk
        ? `Perfect — that's the shot I was waiting on. It's on your upcoming ${attachedPost.platform} post.`
        : `Love it — I've added it to your upcoming ${attachedPost.platform} post.`
      : 'Got it — saved to your photo library. I\'ll work it into an upcoming post.';

    return ok(task.task_id, summary, 'done', {
      media_asset_id: asset.id,
    });
  }

  /**
   * Pull the bytes from the message's media URL. Real carrier MMS is served by
   * Twilio behind basic auth (account SID + auth token); the dev SMS simulator
   * and any public URL are fetched plain. Anything non-OK or oversized throws,
   * so the caller records no phantom photo.
   */
  private async download(url: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (sid && token && /(?:^|\.)twilio\.com\//.test(url)) {
      headers.Authorization =
        'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching media`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error('empty media body');
    if (bytes.length > MAX_BYTES) throw new Error(`media too large: ${bytes.length} bytes`);
    return bytes;
  }
}
