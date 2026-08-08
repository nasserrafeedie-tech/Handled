import {
  BadGatewayException,
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
import { ConnectService } from './connect.service';
import { ConciergeService } from '../concierge/concierge.service';

const StartBody = z.object({
  customerId: z.string().min(1),
  platform: Platform,
});

const ReconcileBody = z.object({
  customerId: z.string().min(1),
});

/**
 * Public connect endpoints. The marketing site's Connect page POSTs here to get
 * a hosted authorization link, and calls back after the owner returns to sync
 * what got connected. Everything degrades to a safe demo when offline.
 */
@Controller('connect')
export class ConnectController {
  private readonly log = new Logger(ConnectController.name);

  constructor(
    private readonly connect: ConnectService,
    private readonly concierge: ConciergeService,
  ) {}

  /** Start authorizing one platform → returns a URL to redirect the browser. */
  @Post('start')
  async start(@Body() body: unknown) {
    const { customerId, platform } = StartBody.parse(body);
    try {
      return await this.connect.startAuth({ customerId, platform });
    } catch (err) {
      // This used to fall through as a bare 500. The owner saw "something went
      // wrong" and so did we — the real reason (an unenabled platform, a key
      // with a stray newline, a rejected redirect) was only ever a line in the
      // hosting logs, and diagnosing it meant going and reading them. The
      // upstream reason is now on the response, because the person clicking
      // Connect is the one who has to act on it.
      const reason = err instanceof Error ? err.message : String(err);
      this.log.error(`connect/start ${platform} for ${customerId} failed: ${reason}`);
      throw new BadGatewayException({
        error: 'connect_failed',
        platform,
        // Trimmed, and it is our own integration talking to our own vendor —
        // no customer data and no credentials pass through here.
        reason: reason.slice(0, 400),
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
  async reconcilePending() {
    const results = await this.connect.reconcilePending();
    for (const r of results) {
      const labels = r.gained
        .map((p) => ({ instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', threads: 'Threads', google_business: 'Google Business Profile' }[p] ?? p))
        .join(' and ');
      void this.concierge
        .notify(r.customerId, `${labels} connected ✓ You're all set — I'll take it from here.`, {
          promptedByOwner: true,
        })
        .catch(() => undefined);
    }
    return { reconciled: results.length };
  }

  /** Sync connected accounts after the owner returns from authorizing. */
  @Post('reconcile')
  async reconcile(@Body() body: unknown) {
    const { customerId } = ReconcileBody.parse(body);
    const accounts = await this.connect.reconcile(customerId);
    return { accounts };
  }

  /** Read-only status: which platforms this customer has connected. */
  @Get('status')
  async status(@Query('customer') customer?: string) {
    if (!customer) return { accounts: [] };
    const accounts = await this.connect.listConnected(customer);
    return { accounts };
  }
}
