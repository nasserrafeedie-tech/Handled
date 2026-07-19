import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { Task } from '@smm/contracts';
import type { CalendarSlot } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { ConciergeService } from '../concierge/concierge.service';
import { zonedToUtc } from '../common/time';

/** Shape of the PLAN_WEEK Result we care about. */
type PlanResult = { data?: { slots?: CalendarSlot[] } };

/**
 * The autonomous heartbeat (§10). Three recurring jobs, all routed through the
 * TaskBus so they get the same validation + audit trail as owner-triggered work:
 *   • weekly  — PLAN_WEEK for every active customer (Mon 08:00)
 *   • hourly  — PUBLISH_DUE sweep (safety net beside the per-post BullMQ jobs)
 *   • daily   — FETCH_METRICS so planning learns from what worked (06:00)
 *
 * Disabled when ENABLE_CRON=0 (e.g. local dev / tests) so it never fires
 * unexpectedly. Paused customers are skipped — the kill switch stays honored.
 */
@Injectable()
export class CronService {
  private readonly log = new Logger(CronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: TaskBus,
    private readonly concierge: ConciergeService,
  ) {}

  private get enabled(): boolean {
    return process.env.ENABLE_CRON !== '0';
  }

  private async activeCustomerIds(): Promise<string[]> {
    const rows = await this.prisma.customer.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private emit(customerId: string, type: Task['type'], payload: unknown) {
    const task = {
      task_id: randomUUID(),
      customer_id: customerId,
      type,
      payload,
      requires_approval: false,
      created_by: 'cron' as const,
      created_at: new Date().toISOString(),
    } as Task;
    return this.bus.emit(task);
  }

  /** Weekly: plan the coming week for every active customer. */
  @Cron('0 8 * * 1')
  async planWeek(): Promise<void> {
    if (!this.enabled) return;
    const ids = await this.activeCustomerIds();
    this.log.log(`weekly rhythm for ${ids.length} customers`);
    for (const id of ids) {
      await this.runWeeklyRhythm(id).catch((e) =>
        this.log.warn(`weekly rhythm failed for ${id}: ${e.message}`),
      );
    }
  }

  /**
   * The whole Monday morning in one place: plan the week, draft a post for
   * every planned slot, then hand the first draft to the owner over SMS.
   *
   * Planning alone used to be the end of it — a calendar nobody ever saw and
   * no posts to go with it. The owner only experiences this product when the
   * text arrives, so the notify step is the part that matters.
   */
  async runWeeklyRhythm(customerId: string): Promise<number> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { timezone: true, planTier: true },
    });
    const tz = customer?.timezone ?? 'America/Los_Angeles';

    const planned = await this.emit(customerId, 'PLAN_WEEK', {
      week_start: nextMonday(),
    });
    const slots = (planned as PlanResult)?.data?.slots ?? [];
    if (!slots.length) {
      this.log.warn(`no slots planned for ${customerId}`);
      return 0;
    }

    let drafted = 0;
    for (const slot of slots) {
      try {
        await this.emit(customerId, 'DRAFT_POST', {
          platform: slot.platform,
          archetype: slot.archetype,
          scheduled_time: zonedToUtc(slot.date, slot.best_time, tz).toISOString(),
          needs_asset: slot.needs_asset,
          shot_list_hint: slot.shot_list,
        });
        drafted++;
      } catch (e) {
        // One bad draft shouldn't cost the owner their whole week.
        this.log.warn(
          `DRAFT_POST failed for ${customerId} on ${slot.date}: ${(e as Error).message}`,
        );
      }
    }

    if (drafted > 0) {
      await this.concierge.presentNextDraft(
        customerId,
        `Morning! Your week is planned — ${drafted} post${drafted > 1 ? 's' : ''} ready for a look.`,
      );
    }

    // Growth+ gets one reel a week. The ask goes out with the plan, but only
    // if no video ask is already open — nagging twice about the same clips is
    // how you teach an owner to ignore you.
    if (customer?.planTier && customer.planTier !== 'starter') {
      const openVideoAsk = await this.prisma.shotListRequest.findFirst({
        where: { customerId, status: 'requested', prompt: { contains: 'clips' } },
      });
      if (!openVideoAsk) {
        await this.prisma.shotListRequest.create({
          data: {
            customerId,
            prompt:
              'Reel clips: (1) your storefront from the street, (2) you doing the work, (3) a happy customer moment. 5-10 seconds each.',
          },
        });
        const site = process.env.PUBLIC_SITE_URL ?? 'https://aissm-web.vercel.app';
        await this.concierge.notify(
          customerId,
          `One more thing — film me 3 quick clips this week (your storefront, you at work, a happy customer) and I'll cut them into a reel. Upload here: ${site}/upload?c=${customerId}`,
        );
      }
    }

    this.log.log(`${customerId}: planned ${slots.length}, drafted ${drafted}`);
    return drafted;
  }

  /** Hourly: publish anything now due (belt-and-suspenders with BullMQ). */
  @Cron(CronExpression.EVERY_HOUR)
  async publishDue(): Promise<void> {
    if (!this.enabled) return;
    const ids = await this.activeCustomerIds();
    for (const id of ids) {
      await this.emit(id, 'PUBLISH_DUE', {}).catch((e) =>
        this.log.warn(`PUBLISH_DUE failed for ${id}: ${e.message}`),
      );
    }
  }

  /** Daily: pull fresh metrics so next week's plan learns from results. */
  @Cron('0 6 * * *')
  async fetchMetrics(): Promise<void> {
    if (!this.enabled) return;
    const ids = await this.activeCustomerIds();
    this.log.log(`daily FETCH_METRICS for ${ids.length} customers`);
    for (const id of ids) {
      await this.emit(id, 'FETCH_METRICS', {}).catch((e) =>
        this.log.warn(`FETCH_METRICS failed for ${id}: ${e.message}`),
      );
    }
  }
}

function nextMonday(): string {
  const d = new Date();
  const day = d.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
