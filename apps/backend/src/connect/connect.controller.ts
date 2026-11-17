import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { z } from 'zod';
import { Platform } from '@smm/contracts';
import { ConnectService, friendlyConnectError } from './connect.service';
import { conflictingAccountId } from '../operator/publishing/post-for-me.service';

const StartBody = z.object({
  customerId: z.string().uuid(),
  platform: Platform,
});

/** What Post for Me appended to the redirect, forwarded by the callback page. */
const ReturnFields = {
  isSuccess: z.boolean().optional(),
  accountIds: z.array(z.string().max(100)).max(20).optional(),
  failedAccountIds: z.array(z.string().max(100)).max(20).optional(),
  error: z.string().max(1000).optional(),
};

const ReconcileBody = z.object({
  customerId: z.string().uuid(),
  ...ReturnFields,
});

const PendingBody = z.object(ReturnFields).partial();

/**
 * Public connect endpoints. The marketing site's Connect page POSTs here to get
 * a hosted authorization link, and calls back after the owner returns to sync
 * what got connected. Everything degrades to a safe demo when offline.
 */
@Controller('connect')
export class ConnectController {
  private readonly log = new Logger(ConnectController.name);

  constructor(private readonly connect: ConnectService) {}

  /** Start authorizing one platform → returns a URL to redirect the browser. */
  @Post('start')
  async start(@Body() body: unknown) {
    const parsed = StartBody.safeParse(body);
    if (!parsed.success) {
      // A garbled or hand-edited connect link. A 400 the page can explain,
      // not the 500 a thrown ZodError used to become.
      throw new BadRequestException({ error: 'bad_request', reason: 'That connect link looks incomplete.' });
    }
    const { customerId, platform } = parsed.data;
    try {
      return await this.connect.startAuth({ customerId, platform });
    } catch (err) {
      // The full upstream reason goes to OUR logs. The page gets a reason
      // only when it's one of ours, written for the owner (plan limits); a
      // vendor or database error used to be echoed whole — file paths,
      // Prisma internals and all — to whoever opened the link.
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`connect/start ${platform} for ${customerId} failed: ${reason}`);
      const ownerFacing = /Reply UPGRADE/.test(reason);
      throw new BadGatewayException({
        error: 'connect_failed',
        platform,
        reason: ownerFacing
          ? reason
          : "We couldn't start that connection just now. Try again in a minute, or text us.",
      });
    }
  }

  /**
   * Google OAuth redirect target. Google sends the owner here with a one-time
   * `code` and the customer id in `state`. We exchange it server-side, store the
   * connection, and bounce the browser to the connect page — success or a
   * readable error, never a raw stack. The redirect keeps the code out of the
   * page and the owner out of an API response.
   */
  @Get('google/callback')
  @Redirect()
  async googleCallback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
    const base = `${site}/connect?customer=${encodeURIComponent(state ?? '')}`;
    // The owner declined on Google's screen, or Google returned an error.
    if (error || !code || !state) {
      return { url: `${base}&google=denied` };
    }
    try {
      await this.connect.completeGoogle(code, state);
      return { url: `${base}&google=connected` };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`google callback for ${state} failed: ${reason}`);
      return { url: `${base}&google=error` };
    }
  }

  /**
   * The callback landed with NO customer identity — the mobile case, where
   * the OAuth return opened in a different browser than the one that
   * started it. Finish every recent in-flight connect server-side and
   * confirm to each owner over their own channel.
   */
  @Post('reconcile-pending')
  async reconcilePending(@Body() body: unknown) {
    // Mobile case: no customer id survived the round trip, but Post for Me's
    // redirect may still name the new account — and an account carries its
    // own external_id, which IS the customer. Finish that one directly.
    const ret = PendingBody.safeParse(body ?? {});
    if (ret.success && ret.data.accountIds?.length) {
      const owner = await this.connect.ownerOfAccounts(ret.data.accountIds);
      if (owner) {
        const out = await this.connect.finishConnect(owner, ret.data);
        await this.connect.confirmPending();
        return { reconciled: out.accounts.length > 0 ? 1 : 0, outcome: out.outcome, reason: out.reason };
      }
    }
    // A conflict ("External Id already exists for account spc_…") carries no
    // new account id. If exactly one owner has a connect in flight, it's
    // theirs; with more than one we can't tell, so nobody's account moves.
    if (ret.success && conflictingAccountId(ret.data.error)) {
      const sole = await this.connect.soleRecentPendingCustomer();
      if (sole) {
        const out = await this.connect.finishConnect(sole, ret.data);
        return { reconciled: 0, outcome: out.outcome, reason: out.reason, customerId: out.outcome === 'retry' ? sole : undefined };
      }
    }
    const reconciled = await this.connect.confirmPending();
    if (ret.success && ret.data.isSuccess === false && reconciled === 0) {
      return { reconciled, outcome: 'failed', reason: friendlyConnectError(ret.data.error) };
    }
    return { reconciled };
  }

  /**
   * After the owner returns from authorizing: sync, and say plainly what
   * happened (connected / one more tap / already linked elsewhere / failed /
   * still waiting) using what Post for Me put on the redirect.
   */
  @Post('reconcile')
  async reconcile(@Body() body: unknown) {
    const parsed = ReconcileBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: 'bad_request' });
    const { customerId, ...ret } = parsed.data;
    return this.connect.finishConnect(customerId, ret);
  }

  /** Read-only status: which platforms this customer has connected. */
  @Get('status')
  async status(@Query('customer') customer?: string) {
    if (!customer) return { accounts: [] };
    const accounts = await this.connect.listConnected(customer);
    return { accounts };
  }
}
