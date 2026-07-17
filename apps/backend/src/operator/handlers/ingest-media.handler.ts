import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { TaskHandler, ok } from './handler.interface';

/**
 * INGEST_MEDIA (§7). Owner texted a photo/video → store in R2, link it to the
 * waiting post / shot_list_request, mark fulfilled. The R2 upload itself is a
 * seam; the DB linkage and fulfillment are implemented.
 */
@Injectable()
export class IngestMediaHandler implements TaskHandler<'INGEST_MEDIA'> {
  readonly type = 'INGEST_MEDIA' as const;

  constructor(private readonly prisma: PrismaService) {}

  async handle(task: Extract<Task, { type: 'INGEST_MEDIA' }>): Promise<Result> {
    const { content_type, post_id, shot_list_request_id } = task.payload;
    const kind = content_type.startsWith('video') ? 'video' : 'image';

    // Integration point: fetch task.payload.source_url (Twilio media URL, which
    // requires Twilio basic auth) and stream it into R2; use the returned key.
    const r2Key = `owner/${task.customer_id}/${task.task_id}`;

    const asset = await this.prisma.mediaAsset.create({
      data: {
        customerId: task.customer_id,
        postId: post_id ?? null,
        kind,
        source: 'owner_upload',
        r2Key,
        contentType: content_type,
      },
    });

    if (shot_list_request_id) {
      await this.prisma.shotListRequest.update({
        where: { id: shot_list_request_id },
        data: { status: 'fulfilled', fulfilledBy: asset.id, fulfilledAt: new Date() },
      });
    }
    if (post_id) {
      const post = await this.prisma.post.findUnique({ where: { id: post_id } });
      if (post) {
        await this.prisma.post.update({
          where: { id: post_id },
          data: { mediaRefs: [...post.mediaRefs, r2Key] },
        });
      }
    }

    return ok(task.task_id, 'Got the photo — thank you! I\'ll use it.', 'done', {
      media_asset_id: asset.id,
    });
  }
}
