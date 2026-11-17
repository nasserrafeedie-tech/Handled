import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from '../operator/security/token-crypto.service';
import {
  PostForMeService,
  conflictingAccountId,
  type RemoteAccount,
} from '../operator/publishing/post-for-me.service';
import { GoogleBusinessService } from '../operator/publishing/google-business.service';
import {
  canConnectPlatform,
  isGoogleBusiness,
  socialLimit,
  socialsOffered,
} from '../operator/tier-entitlements';
import { platformName } from '../operator/publishing/platform-names';
import { ConciergeService } from '../concierge/concierge.service';

export interface StartAuthRequest {
  customerId: string;
  platform: Platform;
}

export interface StartAuthResult {
  url: string;
  /** True when running without a Post for Me key (returns a demo URL). */
  offline: boolean;
}

/**
 * What Post for Me appends to the redirect when the owner comes back:
 * isSuccess, accountIds, failedAccountIds, error (plus provider/projectId).
 * The callback page forwards them. All optional — the mobile path has none.
 */
export interface ConnectReturn {
  isSuccess?: boolean;
  accountIds?: string[];
  failedAccountIds?: string[];
  error?: string;
}

/**
 * connected — at least one account is linked and recorded.
 * retry     — we cleared a stale link that was blocking this account; one
 *             more pass through Connect finishes it.
 * taken     — that account is linked to a different, live Handled customer.
 * failed    — Post for Me said no (owner cancelled, personal IG, no Page…).
 * waiting   — nothing yet; Post for Me can lag. The cron sweep keeps trying.
 */
export type FinishOutcome = 'connected' | 'retry' | 'taken' | 'failed' | 'waiting';

/** How recent a started connect must be for its callback to move an account. */
const PENDING_WINDOW_MS = 30 * 60_000;

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
    private readonly concierge: ConciergeService,
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

    const authReq = {
      platform: req.platform,
      externalId: req.customerId,
      // Facebook Login by default. Verified live on an iPhone (Oct 2026):
      // Instagram Login's own login page deep-links into the Instagram app,
      // whose OAuth dead-ends — every logged-out mobile customer hit it. The
      // Facebook route completes in Safari and also unlocks Meta's Reels
      // audio library. Cost: the owner's Instagram must be a Professional
      // account linked to a Facebook Page (the connect page says so).
      // PFM_INSTAGRAM_CONNECTION=instagram switches back for desktop-only tests.
      ...(req.platform === 'instagram'
        ? {
            connectionType:
              process.env.PFM_INSTAGRAM_CONNECTION === 'instagram' ? 'instagram' : 'facebook',
          }
        : {}),
    };
    let url: string;
    try {
      ({ url } = await this.pfm.createAuthUrl(authReq));
    } catch (err) {
      // Whether a Post for Me project allows the Facebook route for Instagram
      // isn't something we can check ahead of time. If Post for Me turns the
      // request itself down (a 4xx, not an outage), fall back once to
      // Instagram Login rather than leave the owner with no way to connect.
      const msg = err instanceof Error ? err.message : String(err);
      if (authReq.connectionType !== 'facebook' || !/→ 4\d\d\b/.test(msg)) throw err;
      this.log.warn(`Facebook Login refused for Instagram, retrying with Instagram Login: ${msg}`);
      ({ url } = await this.pfm.createAuthUrl({ ...authReq, connectionType: 'instagram' }));
    }

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

  /**
   * reconcilePending plus the confirmation text each owner is waiting on.
   * Called from the callback page's no-identity path AND from a cron sweep —
   * Post for Me can register an account seconds or minutes after the owner
   * saw their OAuth succeed, and without the sweep a slow registration left
   * the connect stranded forever (nothing else ever retried).
   */
  async confirmPending(): Promise<number> {
    const results = await this.reconcilePending();
    for (const r of results) {
      const labels = r.gained.map((p) => platformName(p)).join(' and ');
      void this.concierge
        .notify(r.customerId, `${labels} connected ✓ You're all set — I'll take it from here.`, {
          promptedByOwner: true,
        })
        .catch(() => undefined);
    }
    return results.length;
  }

  /**
   * The callback page's one call. Reads what Post for Me appended to the
   * redirect and turns it into one plain outcome for the page to show.
   *
   * This is where "linking never worked" came from. Post for Me registers an
   * account once per platform user. Connect your Instagram under one Handled
   * customer (a test signup, an earlier phone number), and every later
   * connect of that same Instagram under a different customer fails on their
   * side with "External Id already exists for account spc_…" and
   * isSuccess=false. The page ignored those parameters, polled for an account
   * that was never coming, and the owner was left on "still finishing up".
   */
  async finishConnect(
    customerId: string,
    ret: ConnectReturn = {},
  ): Promise<{ outcome: FinishOutcome; accounts: ConnectedSummary[]; reason?: string }> {
    if (!this.pfm.configured) {
      return { outcome: 'connected', accounts: await this.listConnected(customerId) };
    }

    const conflictId = conflictingAccountId(ret.error);
    if (conflictId) {
      const adopted = await this.adoptStaleAccount(customerId, conflictId);
      if (adopted !== 'refused') {
        return {
          outcome: adopted,
          accounts: await this.listConnected(customerId),
          reason:
            adopted === 'taken'
              ? 'That account is already linked to another Handled account.'
              : undefined,
        };
      }
    }

    const accounts = await this.reconcile(customerId, ret.accountIds);
    if (accounts.length > 0 && (ret.accountIds?.length || ret.isSuccess !== false)) {
      return { outcome: 'connected', accounts };
    }
    if (ret.isSuccess === false) {
      return { outcome: 'failed', accounts, reason: friendlyConnectError(ret.error) };
    }
    return { outcome: 'waiting', accounts };
  }

  /**
   * Take over an account Post for Me has registered under someone else's id,
   * when (and only when) that someone isn't really using it.
   *
   *  - The asking customer must have started a connect in the last 30
   *    minutes. The callback endpoint is public; without this, anyone holding
   *    a customer id and an spc_ id could re-point an account.
   *  - If the current holder is a live customer actively connected to it,
   *    nothing moves — that's a human decision (admin pfm-account/reassign).
   *  - Otherwise (deleted test customer, cancelled, never recorded it) the
   *    external_id moves, and the owner taps Connect once more: a reconnect
   *    under the SAME external_id updates the account in place, with fresh
   *    tokens, which is the one path Post for Me always accepts.
   */
  /** The one customer with a connect started in the last 30 minutes, or null if none or several. */
  async soleRecentPendingCustomer(): Promise<string | null> {
    const rows = await this.prisma.customer.findMany({
      where: { connectPendingAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) } },
      select: { id: true },
      take: 2,
    });
    return rows.length === 1 ? rows[0].id : null;
  }

  /** The customer the first of these Post for Me accounts belongs to, if it's one of ours. */
  async ownerOfAccounts(accountIds: string[]): Promise<string | null> {
    if (!this.pfm.configured) return null;
    for (const id of accountIds.filter((i) => /^spc_/.test(i)).slice(0, 5)) {
      const acct = await this.pfm.getAccount(id).catch(() => null);
      if (!acct?.externalId) continue;
      const exists = await this.prisma.customer.findUnique({
        where: { id: acct.externalId },
        select: { id: true },
      }).catch(() => null);
      if (exists) return exists.id;
    }
    return null;
  }

  private async adoptStaleAccount(
    customerId: string,
    accountId: string,
  ): Promise<'retry' | 'taken' | 'refused'> {
    const me = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { connectPendingAt: true },
    });
    if (!me?.connectPendingAt || Date.now() - me.connectPendingAt.getTime() > PENDING_WINDOW_MS) {
      this.log.warn(`adopt ${accountId} for ${customerId}: no recent connect started — refusing`);
      return 'refused';
    }
    const remote = await this.pfm.getAccount(accountId);
    if (!remote) return 'refused';
    if (remote.externalId === customerId) return 'retry';

    const holder = remote.externalId
      ? await this.prisma.connectedAccount.findFirst({
          where: {
            postForMeRef: accountId,
            customerId: remote.externalId,
            revoked: false,
            customer: { status: { in: ['active', 'onboarding'] } },
          },
          select: { id: true },
        })
      : null;
    if (holder) {
      this.log.error(
        `connect conflict: ${accountId} (${remote.platform}) is live under customer ` +
          `${remote.externalId}; ${customerId} also tried to connect it. Resolve with ` +
          'POST /admin/pfm-account/reassign.',
      );
      return 'taken';
    }

    await this.pfm.setExternalId(accountId, customerId);
    await this.prisma.connectedAccount.updateMany({
      where: { postForMeRef: accountId, NOT: { customerId } },
      data: { revoked: true },
    });
    this.log.log(
      `connect: moved stale ${remote.platform} account ${accountId} from ` +
        `${remote.externalId ?? '(none)'} to ${customerId}`,
    );
    return 'retry';
  }

  async reconcile(customerId: string, accountIds: string[] = []): Promise<ConnectedSummary[]> {
    if (!this.pfm.configured) {
      // Nothing to sync in demo mode.
      return this.listConnected(customerId);
    }

    const listed = await this.pfm.listAccounts(customerId);
    // Post for Me's redirect names the new account ids. Their list endpoint
    // can trail the redirect by a beat, so fetch any it didn't return yet —
    // but only adopt one that is genuinely registered to this customer.
    const seen = new Set(listed.map((a) => a.id));
    const extra: RemoteAccount[] = [];
    for (const id of accountIds.filter((i) => /^spc_/.test(i) && !seen.has(i)).slice(0, 10)) {
      const acct = await this.pfm.getAccount(id).catch(() => null);
      if (acct && acct.externalId === customerId) extra.push(acct);
    }
    const all = [...listed, ...extra];

    // A disconnected account can't be posted to. Don't import one; and if we
    // already hold it, mark it lapsed so the reconnect reminder goes out
    // instead of posts quietly failing.
    const disconnected = all.filter((a) => a.status === 'disconnected');
    for (const acct of disconnected) {
      await this.prisma.connectedAccount.updateMany({
        where: {
          customerId,
          postForMeRef: acct.id,
          revoked: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        data: { expiresAt: new Date() },
      });
    }
    const remote = all.filter((a) => a.status !== 'disconnected');

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

    // The connect this customer started has arrived: retire the pending
    // record here too, not only in the cron sweep, so a connect confirmed
    // by the callback page isn't re-checked for the next half hour.
    const pending = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { connectPendingPlatform: true },
    });
    if (
      pending?.connectPendingPlatform &&
      admitted.some((a) => a.platform === pending.connectPendingPlatform)
    ) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { connectPendingPlatform: null, connectPendingAt: null },
      });
    }

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

/**
 * Post for Me's error, in words for the owner. Their messages are written for
 * developers; the common ones get a translation, anything else a generic
 * line (the raw text stays in our logs, never on the page).
 */
export function friendlyConnectError(error: string | null | undefined): string {
  const e = (error ?? '').toLowerCase();
  if (/cancel|denied|access_denied|user denied/.test(e)) {
    return 'It looks like the connection was cancelled. You can try again any time.';
  }
  if (/page/.test(e) && /(no|not|without|select)/.test(e)) {
    return 'Instagram needs to be linked to a Facebook Page, and that Page has to be picked during connect.';
  }
  if (/professional|business|creator|personal/.test(e)) {
    return 'Instagram only allows posting to Professional (Business or Creator) accounts. You can switch for free in Instagram settings.';
  }
  return 'The connection didn’t go through. Try once more, and if it happens again just text us.';
}
