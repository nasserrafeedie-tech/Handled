import { Injectable, Logger } from '@nestjs/common';
import type { Platform } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ConciergeService } from '../concierge/concierge.service';
import { platformName } from '../operator/publishing/platform-names';

/**
 * Asking owners to reconnect before their posting stops.
 *
 * Meta issues Business tokens that last about 60 days and cannot be renewed
 * without the owner going through the authorization flow again — there is no
 * server-side refresh to fall back on. So every connected Instagram and
 * Facebook account has a date on which it stops working, and it is a date we
 * know in advance.
 *
 * Without this, that date arrives silently: posts stop publishing, nothing
 * tells the owner why, and the first signal is them noticing their feed has
 * gone quiet. The whole product is one text thread, which makes this the one
 * kind of problem it should be good at — we can ask, in the same thread they
 * already use, while there is still time to act.
 */
@Injectable()
export class ReauthService {
  private readonly log = new Logger(ReauthService.name);

  /** Start asking this many days before a connection lapses. */
  private static readonly WARN_WITHIN_DAYS = 7;
  /** Don't ask again within this many days of the last ask. */
  private static readonly REASK_AFTER_DAYS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly concierge: ConciergeService,
  ) {}

  /**
   * Text every owner whose connection is close to lapsing, or has lapsed.
   * Safe to run repeatedly — the re-ask window keeps it from nagging.
   */
  async sweep(now = new Date()): Promise<{ asked: number }> {
    const horizon = new Date(
      now.getTime() + ReauthService.WARN_WITHIN_DAYS * 24 * 60 * 60 * 1000,
    );
    const reaskBefore = new Date(
      now.getTime() - ReauthService.REASK_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    const due = await this.prisma.connectedAccount.findMany({
      where: {
        revoked: false,
        expiresAt: { not: null, lte: horizon },
        OR: [{ reauthAskedAt: null }, { reauthAskedAt: { lt: reaskBefore } }],
        // A paused or cancelled customer doesn't need chasing about a
        // connection they aren't using.
        customer: { status: 'active' },
      },
      include: { customer: { select: { id: true, businessName: true } } },
    });

    let asked = 0;
    for (const account of due) {
      const expired = account.expiresAt !== null && account.expiresAt <= now;
      try {
        await this.concierge.notify(
          account.customerId,
          this.message(account.platform as Platform, expired, account.customerId),
          // Deliberately not promptedByOwner: this is us starting a
          // conversation, so it waits for a reasonable hour like any other
          // outbound message.
        );
        await this.prisma.connectedAccount.update({
          where: { id: account.id },
          data: { reauthAskedAt: now },
        });
        asked += 1;
      } catch (e) {
        // One owner's failure shouldn't stop the rest of the sweep.
        this.log.warn(
          `reauth notice failed for ${account.customerId}/${account.platform}: ${String(e)}`,
        );
      }
    }

    if (asked > 0) this.log.log(`asked ${asked} owner(s) to reconnect`);
    return { asked };
  }

  /**
   * What the owner reads. Plain about what happens and what it costs them,
   * because the ask is only worth sending if it gets acted on.
   */
  private message(platform: Platform, expired: boolean, customerId: string): string {
    const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
    const link = `${site}/connect?customer=${customerId}`;
    const name = platformName(platform);

    return expired
      ? `${name} has disconnected — that's their 60-day limit, not anything you did. ` +
          `Your posts are queued up and safe, they just can't go out until it's reconnected. ` +
          `Takes about 20 seconds: ${link}`
      : `Quick housekeeping: ${name} needs reconnecting this week. ` +
          `They expire every 60 days and there's no way around it. ` +
          `If it lapses your posts pause until it's back. About 20 seconds: ${link}`;
  }
}

