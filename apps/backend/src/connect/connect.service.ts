import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from '../operator/security/token-crypto.service';
import { PostForMeService } from '../operator/publishing/post-for-me.service';
import { GoogleBusinessService } from '../operator/publishing/google-business.service';
import {
  canConnectPlatform,
  isGoogleBusiness,
  socialLimit,
  socialsOffered,
} from '../operator/tier-entitlements';
import { platformName } from '../operator/publishing/platform-names';

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
    private readonly google: GoogleBusinessService,
  ) {}

  private get siteUrl(): string {
    return process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
  }

  /**
   * The platform allowance gate. A customer can connect up to their tier's
   * platform limit; reconnecting one they already have is always allowed.
   * Throws a message written for the owner, because the connect controller puts
   * the reason straight on the response.
   */
  private async assertWithinPlatformLimit(
    customerId: string,
    platform: Platform,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { planTier: true },
    });
    const connected = await this.prisma.connectedAccount.findMany({
      where: { customerId, revoked: false },
      select: { platform: true },
    });
    const tier = customer?.planTier ?? 'starter';
    const already = connected.map((c) => c.platform);
    if (!canConnectPlatform(tier, already, platform)) {
      // Two reasons it can be refused: the platform isn't offered on this tier
      // at all (TikTok/Threads below Pro), or they've used up their social slots
      // (GBP is always free and never the blocker).
      const notOffered =
        !isGoogleBusiness(platform) && !socialsOffered(tier).includes(platform);
      throw new Error(
        notOffered
          ? `${platformName(platform)} is part of the Pro plan. Reply UPGRADE to add it.`
          : `Your ${tier} plan covers ${socialLimit(tier)} social platform` +
            `${socialLimit(tier) > 1 ? 's' : ''} plus your Google Business Profile, ` +
            `and you're already there. Reply UPGRADE to add ${platformName(platform)}, ` +
            `or disconnect one first.`,
      );
    }
  }

  /** Step 1: hand the browser a link to go authorize a platform. */
  async startAuth(req: StartAuthRequest): Promise<StartAuthResult> {
    // Enforce the tier's platform allowance before spending a round trip on an
    // auth link the customer isn't entitled to use.
    await this.assertWithinPlatformLimit(req.customerId, req.platform);

    // Google Business Profile is a direct Google OAuth, not Post for Me. Its
    // consent URL carries the customer id as `state`, and the owner returns to
    // our own /connect/google/callback where the code is exchanged.
    if (req.platform === 'google_business') {
      if (!this.google.configured) {
        this.log.warn('Connect offline mode (no GOOGLE_OAUTH_CLIENT_ID) — demo URL');
        return {
          url:
            `${this.siteUrl}/connect/callback?customer=${encodeURIComponent(req.customerId)}` +
            `&platform=google_business&demo=1`,
          offline: true,
        };
      }
      return { url: this.google.authUrl(req.customerId), offline: false };
    }

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

    // No per-request redirect override. Post for Me rejects it outright on
    // Quickstart projects ("Redirect URL Override is not allowed"), and the
    // project-level Redirect URL configured in their dashboard is what actually
    // gets used. The customer id therefore cannot ride back on the query
    // string, so the connect page stashes it before handing the browser over
    // and the callback reads it back.
    // Remember the in-flight connect server-side. On mobile the OAuth
    // return frequently lands in a DIFFERENT browser (the Instagram app's
    // in-app view), where the sessionStorage the connect page stashed does
    // not exist — the callback then has no idea whose connection to sync.
    // This record lets /connect/reconcile-pending finish the association
    // without the browser's help.
    await this.prisma.customer.update({
      where: { id: req.customerId },
      data: { connectPendingPlatform: req.platform, connectPendingAt: new Date() },
    });

    const { url } = await this.pfm.createAuthUrl({
      platform: req.platform,
      externalId: req.customerId,
      // Connect Instagram via Facebook Login, not Instagram Login: Meta only
      // exposes its Reels audio library to Facebook-Login connections, and we
      // want customers audio-eligible the day Post for Me ships audio support.
      // Switching connection type later is free and doesn't disturb scheduled
      // posts, so defaulting this way has no downside.
      ...(req.platform === 'instagram' ? { connectionType: 'facebook' } : {}),
    });

    // iOS hands www.instagram.com links to the Instagram app (universal
    // links), and the app's OAuth picker is broken — verified live, while
    // the web picker works. api.instagram.com serves the SAME authorize
    // endpoint as a 302 back to www with every param intact, and it is not
    // app-claimed (no valid AASA — Apple's association fetch doesn't follow
    // its 302). iOS evaluates universal links against the URL being
    // navigated to, not mid-flight redirects, so routing through api.* keeps
    // the whole flow in the browser deterministically. If Instagram ever
    // drops that redirect, the flow degrades to exactly today's behavior.
    const finalUrl =
      req.platform === 'instagram'
        ? url.replace(/^https:\/\/www\.instagram\.com\//, 'https://api.instagram.com/')
        : url;
    return { url: finalUrl, offline: false };
  }

  /**
   * Step 2: the owner has returned from authorizing. Ask Post for Me what's now
   * connected for this customer and record it. Idempotent — safe to call again.
   */
  /**
   * Finish every connect whose owner never made it back in the same browser
   * (the mobile case). For each customer with a recent in-flight connect,
   * sync from Post for Me — the auth we started carried their id as the
   * external id, so the association lives server-side — and report who
   * gained which platforms so the caller can confirm over their channel.
   */
  async reconcilePending(): Promise<Array<{ customerId: string; gained: string[] }>> {
    const cutoff = new Date(Date.now() - 30 * 60_000);
    const waiting = await this.prisma.customer.findMany({
      where: { connectPendingAt: { gte: cutoff } },
      select: { id: true, connectPendingPlatform: true },
    });
    const results: Array<{ customerId: string; gained: string[] }> = [];
    for (const c of waiting) {
      try {
        const before = new Set(
          (
            await this.prisma.connectedAccount.findMany({
              where: { customerId: c.id, revoked: false },
              select: { platform: true },
            })
          ).map((a) => a.platform),
        );
        const after = await this.reconcile(c.id);
        const gained = after.map((a) => a.platform).filter((pl) => !before.has(pl));
        const arrived =
          gained.length > 0 ||
          (c.connectPendingPlatform && after.some((a) => a.platform === c.connectPendingPlatform));
        if (arrived) {
          await this.prisma.customer.update({
            where: { id: c.id },
            data: { connectPendingPlatform: null, connectPendingAt: null },
          });
          if (gained.length > 0) results.push({ customerId: c.id, gained });
        }
      } catch (e) {
        this.log.warn(`pending reconcile for ${c.id} failed: ${String(e)}`);
      }
    }
    return results;
  }

  async reconcile(customerId: string): Promise<ConnectedSummary[]> {
    if (!this.pfm.configured) {
      // Nothing to sync in demo mode.
      return this.listConnected(customerId);
    }

    const remote = await this.pfm.listAccounts(customerId);

    // Enforce the tier's platform allowance HERE, where rows are actually
    // created. startAuth checks it too, but against DB state that lags the real
    // connection — several auths started before any returns all see 0 connected
    // and all pass. This is the writer, so it is the real gate. GBP is always
    // admitted (included in every tier, never a slot). For socials: keep the
    // ones already connected (reconnects never count), admit new ones only if
    // the tier offers that platform AND it is under the social cap.
    const tier =
      (
        await this.prisma.customer.findUnique({
          where: { id: customerId },
          select: { planTier: true },
        })
      )?.planTier ?? 'starter';
    const limit = socialLimit(tier);
    const offered = new Set(socialsOffered(tier));
    const keptSocials = new Set(
      (
        await this.prisma.connectedAccount.findMany({
          where: { customerId, revoked: false },
          select: { platform: true },
        })
      )
        .map((r) => r.platform)
        .filter((p) => !isGoogleBusiness(p)),
    );
    const admitted = remote.filter((acct) => {
      if (isGoogleBusiness(acct.platform)) return true; // always included
      if (keptSocials.has(acct.platform)) return true; // already connected
      if (!offered.has(acct.platform)) {
        this.log.warn(
          `reconcile: ${acct.platform} is not offered on ${tier} for ${customerId} — not importing`,
        );
        return false;
      }
      if (keptSocials.size < limit) {
        keptSocials.add(acct.platform);
        return true;
      }
      this.log.warn(
        `reconcile: ${acct.platform} exceeds the ${tier} social cap of ${limit} for ${customerId} — not importing`,
      );
      return false;
    });

    for (const acct of admitted) {
      // Reconnecting restarts the clock, so this is set on both paths.
      const expiresAt = expiryFor(acct.platform);
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
          expiresAt,
        },
        update: {
          postForMeRef: acct.id,
          externalHandle: acct.username ?? null,
          revoked: false,
          expiresAt,
          // A fresh connection means the last reminder is spent.
          reauthAskedAt: null,
        },
      });
    }
    return this.listConnected(customerId);
  }

  /**
   * Google OAuth callback: the owner has authorized, and Google handed us a
   * one-time code plus our customer id in `state`. Exchange it, resolve the
   * business location, and store the connection.
   *
   * We persist the REFRESH token (encrypted), not an access token — Google's
   * access tokens last an hour, and we mint a fresh one per publish from the
   * refresh token. The location resource name rides in `postForMeRef` (a
   * generic external-reference column); publishing needs it to know where the
   * post goes. No token expiry is recorded: a refresh token does not lapse on a
   * clock the way Meta's do, so there is nothing to nag the owner about.
   */
  async completeGoogle(code: string, customerId: string): Promise<ConnectedSummary[]> {
    if (!this.google.configured) return this.listConnected(customerId);

    const tokens = await this.google.exchangeCode(code);
    if (!tokens.refreshToken) {
      // Without a refresh token the connection dies in an hour. This happens
      // when Google skips the consent screen on a re-auth — which is exactly
      // what access_type=offline + prompt=consent exist to prevent, so treat it
      // as a real failure rather than storing a doomed connection.
      throw new Error(
        'Google did not return a refresh token — reconnect and approve the consent screen.',
      );
    }

    const location = await this.google.firstLocation(tokens.accessToken);
    if (!location) {
      throw new Error(
        'No Business Profile location found on this Google account — is it the one that manages the shop?',
      );
    }

    await this.prisma.connectedAccount.upsert({
      where: { customerId_platform: { customerId, platform: 'google_business' } },
      create: {
        customerId,
        platform: 'google_business',
        // Required column: a marker, since the real secret is the refresh token.
        accessTokenEnc: this.marker(),
        refreshTokenEnc: this.crypto.encrypt(tokens.refreshToken),
        // The post target `accounts/{account}/locations/{location}`, reused into the generic ref.
        postForMeRef: location.name,
        externalHandle: location.title ?? null,
        scopes: [GoogleBusinessService.SCOPE],
        revoked: false,
        expiresAt: null,
      },
      update: {
        refreshTokenEnc: this.crypto.encrypt(tokens.refreshToken),
        postForMeRef: location.name,
        externalHandle: location.title ?? null,
        revoked: false,
        reauthAskedAt: null,
      },
    });
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

/**
 * How long a platform's authorization lasts before the owner has to grant it
 * again. Post for Me holds the tokens but cannot extend them: Meta's limit is
 * on the token itself, and renewing needs the owner present.
 *
 * Null means no known expiry — we won't chase an owner about a connection that
 * has no deadline. Meta's documented window is 60 days; we record 59 so the
 * reminder is always sent while the connection still works.
 */
const TOKEN_LIFETIME_DAYS: Partial<Record<Platform, number>> = {
  instagram: 59,
  facebook: 59,
  threads: 59,
};

function expiryFor(platform: Platform, from = new Date()): Date | null {
  const days = TOKEN_LIFETIME_DAYS[platform];
  if (!days) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
