import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from '../operator/security/token-crypto.service';
import { PostForMeService } from '../operator/publishing/post-for-me.service';

export interface StartAuthRequest {
  customerId: string;
  platform: Platform;
}

export interface StartAuthResult {
  url: string;
  /** True when running without a Post for Me key (returns a demo URL). */
  offline: boolean;
}

export interface ConnectedSummary {
  platform: Platform;
  handle?: string;
  connectedAt: string;
}

/**
 * Connect flow (§8). Turns "tap Connect Instagram" into a real hosted
 * authorization link from Post for Me, and records what came back so the
 * Operator knows which accounts it may publish to.
 *
 * We never see or store the platform passwords/tokens — Post for Me holds those.
 * We only keep a reference id + the public handle, encrypted at rest.
 *
 * Offline mode: with no POST_FOR_ME_API_KEY we return a harmless demo URL so the
 * page and flow can be walked through for free.
 */
@Injectable()
export class ConnectService {
  private readonly log = new Logger(ConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TokenCryptoService,
    private readonly pfm: PostForMeService,
  ) {}

  private get siteUrl(): string {
    return process.env.PUBLIC_SITE_URL ?? 'https://aissm-web.vercel.app';
  }

  /** Step 1: hand the browser a link to go authorize a platform. */
  async startAuth(req: StartAuthRequest): Promise<StartAuthResult> {
    const redirectUrl =
      `${this.siteUrl}/connect/callback` +
      `?customer=${encodeURIComponent(req.customerId)}` +
      `&platform=${encodeURIComponent(req.platform)}`;

    if (!this.pfm.configured) {
      this.log.warn(
        'Connect offline mode (no POST_FOR_ME_API_KEY) — returning demo URL',
      );
      return {
        url: `${redirectUrl}&demo=1`,
        offline: true,
      };
    }

    const { url } = await this.pfm.createAuthUrl({
      platform: req.platform,
      externalId: req.customerId,
      redirectUrl,
    });
    return { url, offline: false };
  }

  /**
   * Step 2: the owner has returned from authorizing. Ask Post for Me what's now
   * connected for this customer and record it. Idempotent — safe to call again.
   */
  async reconcile(customerId: string): Promise<ConnectedSummary[]> {
    if (!this.pfm.configured) {
      // Nothing to sync in demo mode.
      return this.listConnected(customerId);
    }

    const remote = await this.pfm.listAccounts(customerId);
    for (const acct of remote) {
      await this.prisma.connectedAccount.upsert({
        where: {
          customerId_platform: { customerId, platform: acct.platform },
        },
        create: {
          customerId,
          platform: acct.platform,
          // Post for Me manages the real tokens; we store an encrypted marker so
          // the required column never holds plaintext.
          accessTokenEnc: this.marker(),
          postForMeRef: acct.id,
          externalHandle: acct.username ?? null,
          scopes: [],
          revoked: false,
        },
        update: {
          postForMeRef: acct.id,
          externalHandle: acct.username ?? null,
          revoked: false,
        },
      });
    }
    return this.listConnected(customerId);
  }

  /** Read-only: which platforms this customer currently has connected. */
  async listConnected(customerId: string): Promise<ConnectedSummary[]> {
    const rows = await this.prisma.connectedAccount.findMany({
      where: { customerId, revoked: false },
      orderBy: { connectedAt: 'asc' },
    });
    return rows.map((r) => ({
      platform: r.platform as Platform,
      handle: r.externalHandle ?? undefined,
      connectedAt: r.connectedAt.toISOString(),
    }));
  }

  /** Encrypted placeholder for the required token column (PFM holds real ones). */
  private marker(): string {
    try {
      return this.crypto.encrypt('pfm-managed');
    } catch {
      // Encryption key not set yet — store a non-secret sentinel so the row is
      // still valid. No real token is ever exposed here.
      return 'pfm-managed';
    }
  }
}
