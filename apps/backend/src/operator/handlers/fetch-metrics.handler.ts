import { Injectable, Logger } from '@nestjs/common';
import {
  type Task,
  type Result,
  type FetchMetricsResult,
  type PostMetrics,
} from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { PostForMeService } from '../publishing/post-for-me.service';
import { TaskHandler, ok } from './handler.interface';

/**
 * FETCH_METRICS (§7, cron). Pull per-post performance → metrics table. This
 * feeds the next PLAN_WEEK so the system improves over time.
 */
@Injectable()
export class FetchMetricsHandler implements TaskHandler<'FETCH_METRICS'> {
  readonly type = 'FETCH_METRICS' as const;
  private readonly log = new Logger(FetchMetricsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly postForMe: PostForMeService,
  ) {}

  async handle(task: Extract<Task, { type: 'FETCH_METRICS' }>): Promise<Result> {
    const posts = await this.prisma.post.findMany({
      where: {
        customerId: task.customer_id,
        status: 'published',
        externalPostId: { not: null },
        ...(task.payload.post_ids ? { id: { in: task.payload.post_ids } } : {}),
      },
    });

    const collected: PostMetrics[] = [];
    for (const post of posts) {
      try {
        const m = await this.postForMe.fetchMetrics(post.externalPostId!);
        const row = await this.prisma.metric.create({
          data: {
            postId: post.id,
            customerId: task.customer_id,
            externalPostId: post.externalPostId,
            impressions: m.impressions,
            likes: m.likes,
            comments: m.comments,
            shares: m.shares,
            saves: m.saves,
          },
        });
        collected.push({
          post_id: post.id,
          external_post_id: post.externalPostId,
          impressions: m.impressions,
          likes: m.likes,
          comments: m.comments,
          shares: m.shares,
          saves: m.saves,
          fetched_at: row.fetchedAt.toISOString(),
        });
      } catch (err) {
        this.log.warn(`metrics fetch failed for ${post.id}: ${String(err)}`);
      }
    }

    const data: FetchMetricsResult = { metrics: collected };
    return ok(task.task_id, `Pulled performance for ${collected.length} posts.`, 'done', data);
  }
}
