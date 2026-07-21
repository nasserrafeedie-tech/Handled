import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@smm/contracts';

export interface PublishRequest {
  platform: Platform;
  postForMeRef: string;
  caption: string;
  hashtags: string[];
  mediaUrls: string[];
  /**
   * Whether any attached image was made by a model. Instagram and TikTok
   * require this to be declared — TikTok takes it as a field on the publish
   * call (`video_made_with_ai` on its own API).
   */
  aiGenerated?: boolean;
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

export interface AuthUrlRequest {
  platform: Platform;
  /** Our customer id — Post for Me stores it so we can find the account later. */
  externalId: string;
  /** Where Post for Me sends the owner back once they finish authorizing. */
  redirectUrl: string;
}

/** One connected social account as Post for Me reports it. */
export interface RemoteAccount {
  id: string;
  platform: Platform;
  username?: string;
  status?: string;
}

/** The raw shape Post for Me returns — we normalize it into RemoteAccount. */
interface RawAccount {
  id: string;
  platform: string;
  username?: string;
  handle?: string;
  status?: string;
}

/**
 * Post for Me (§2/§13) — the unified posting + aggregation layer. All platform
 * quirks (no native scheduling on IG/TikTok/X/LinkedIn/Threads; Meta Graph
 * deprecations) live behind here, not in our code. Both methods are seams until
 * POST_FOR_ME_API_KEY is wired.
 */
@Injectable()
export class PostForMeService {
  private readonly log = new Logger(PostForMeService.name);
  private base = process.env.POST_FOR_ME_BASE_URL ?? 'https://api.postforme.dev';

  /** True once the paid key is set. Lets callers pick a graceful fallback. */
  get configured(): boolean {
    return Boolean(process.env.POST_FOR_ME_API_KEY);
  }

  /**
   * Ask Post for Me for a hosted authorization link. The owner opens it, logs
   * into (say) Instagram, and grants permission to post. Post for Me keeps the
   * tokens; we only ever get a reference id back.
   */
  async createAuthUrl(req: AuthUrlRequest): Promise<{ url: string }> {
    this.assertConfigured();
    const data = await this.call<{ url: string }>(
      'POST',
      '/v1/social-accounts/auth-url',
      {
        platform: req.platform,
        external_id: req.externalId,
        redirect_url_override: req.redirectUrl,
      },
    );
    return { url: data.url };
  }

  /**
   * List the social accounts Post for Me holds for one of our customers. We call
   * this after the owner returns from authorizing, to record what got connected.
   */
  async listAccounts(externalId: string): Promise<RemoteAccount[]> {
    this.assertConfigured();
    const data = await this.call<{ data?: RawAccount[] } | RawAccount[]>(
      'GET',
      `/v1/social-accounts?external_id=${encodeURIComponent(externalId)}`,
    );
    const rows = Array.isArray(data) ? data : (data.data ?? []);
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform as Platform,
      username: r.username ?? r.handle ?? undefined,
      status: r.status ?? undefined,
    }));
  }

  async publish(req: PublishRequest): Promise<PublishOutcome> {
    this.assertConfigured();
    const caption = [req.caption, req.hashtags.map((h) => `#${h}`).join(' ')]
      .filter(Boolean)
      .join('\n\n');

    if (req.aiGenerated) {
      // UNVERIFIED: the field name below is our best reading of how Post for Me
      // exposes AI disclosure, and it has not been confirmed against their API.
      // The consequence of getting it wrong lands on the owner's account, not
      // ours, so it is logged every time until someone checks the docs and
      // either confirms the key or replaces it.
      this.log.warn(
        `publishing AI-generated media to ${req.platform} — disclosure field ` +
          'not yet verified against the Post for Me API',
      );
    }

    const data = await this.call<{ id: string }>('POST', '/v1/posts', {
      social_accounts: [req.postForMeRef],
      platform: req.platform,
      caption,
      media: req.mediaUrls.map((url) => ({ url })),
      ...(req.aiGenerated ? { is_ai_generated: true } : {}),
    });
    return { externalPostId: data.id };
  }

  async fetchMetrics(externalPostId: string): Promise<PlatformMetrics> {
    this.assertConfigured();
    const data = await this.call<Partial<PlatformMetrics>>(
      'GET',
      `/v1/posts/${encodeURIComponent(externalPostId)}/insights`,
    );
    return {
      impressions: data.impressions ?? 0,
      likes: data.likes ?? 0,
      comments: data.comments ?? 0,
      shares: data.shares ?? 0,
      saves: data.saves ?? 0,
    };
  }

  /** One place that talks to Post for Me. Flips on when the key is set. */
  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${process.env.POST_FOR_ME_API_KEY}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Post for Me ${method} ${path} → ${res.status} ${res.statusText}` +
          (detail ? `: ${detail.slice(0, 300)}` : ''),
      );
    }
    return (await res.json()) as T;
  }

  private assertConfigured(): void {
    if (!process.env.POST_FOR_ME_API_KEY) {
      throw new Error('POST_FOR_ME_API_KEY not configured');
    }
  }
}
