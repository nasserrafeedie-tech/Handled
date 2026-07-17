import { Injectable } from '@nestjs/common';
import type { Platform } from '@smm/contracts';

export interface PublishRequest {
  platform: Platform;
  postForMeRef: string;
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
}

export interface PublishOutcome {
  externalPostId: string;
}

export interface PlatformMetrics {
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

/**
 * Post for Me (§2/§13) — the unified posting + aggregation layer. All platform
 * quirks (no native scheduling on IG/TikTok/X/LinkedIn/Threads; Meta Graph
 * deprecations) live behind here, not in our code. Both methods are seams until
 * POST_FOR_ME_API_KEY is wired.
 */
@Injectable()
export class PostForMeService {
  private base = process.env.POST_FOR_ME_BASE_URL ?? 'https://api.postforme.dev';

  async publish(_req: PublishRequest): Promise<PublishOutcome> {
    this.assertConfigured();
    // Integration point: POST ${base}/v1/posts with the connected-account ref.
    throw new Error('Post for Me publish not yet implemented — wire the API.');
  }

  async fetchMetrics(_externalPostId: string): Promise<PlatformMetrics> {
    this.assertConfigured();
    // Integration point: GET ${base}/v1/posts/{id}/insights.
    throw new Error('Post for Me metrics not yet implemented — wire the API.');
  }

  private assertConfigured(): void {
    if (!process.env.POST_FOR_ME_API_KEY) {
      throw new Error('POST_FOR_ME_API_KEY not configured');
    }
  }
}
