import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import type { Task } from '@smm/contracts';
import type { CalendarSlot, DraftPostResult } from '@smm/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { ConciergeService } from '../concierge/concierge.service';
import { ArchetypeResearchService } from '../playbook/archetype-research.service';
import { ReauthService } from '../connect/reauth.service';
import { tierHasCarousel } from '../operator/graphics/carousel-content';
import { ReconcileService } from './reconcile.service';
import { RecapService } from '../concierge/recap.service';
import { photoWalkReminder } from '../concierge/photo-walk';
import { ArchetypePerformanceService } from '../playbook/archetype-performance.service';
import { zonedToUtc } from '../common/time';
import { resolveStrategy, reelClipsFor } from '../operator/llm/vertical-playbook';

/** Shape of the PLAN_WEEK Result we care about. */
type PlanResult = { data?: { slots?: CalendarSlot[] } };

/**
 * The wall clock every @Cron below is anchored to. @nestjs/schedule fires cron
 * jobs in the SERVER'S local time unless a timeZone is given — so on a UTC host
 * "Mon 08:00" (planWeek) would fire at 01:00 Pacific and the Friday 16:00 recap
 * at 09:00. These jobs are described as local-morning/afternoon events, so pin
 * the zone explicitly. Overridable per deploy; defaults to the business zone.
 */
const CRON_TZ = process.env.CRON_TIMEZONE ?? 'America/Los_Angeles';

/**
 * The autonomous heartbeat (§10). Three recurring jobs, all routed through the
 * TaskBus so they get the same validation + audit trail as owner-triggered work:
 *   • weekly  — PLAN_WEEK for every active customer (Mon 08:00)
 *   • hourly  — PUBLISH_DUE sweep (safety net beside the per-post BullMQ jobs)
 *   • daily   — FETCH_METRICS, then the Flow 4 recompute that turns those
 *               numbers into per-format results the next plan reads (06:00)
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
    private readonly research: ArchetypeResearchService,
    private readonly reauth: ReauthService,
    private readonly reconcile: ReconcileService,
    private readonly performance: ArchetypePerformanceService,
    private readonly recap: RecapService,
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
  @Cron('0 8 * * 1', { timeZone: CRON_TZ })
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

    // A cold backend's first PLAN_WEEK LLM call can time out to zero slots.
    // Unretried that quietly skips the customer's whole week, so try a few
    // times before giving up — the same cold-start guard the onboarding path
    // uses.
    let slots: CalendarSlot[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const planned = await this.emit(customerId, 'PLAN_WEEK', {
        week_start: nextMonday(),
      });
      slots = (planned as PlanResult)?.data?.slots ?? [];
      if (slots.length) break;
      this.log.warn(
        `no slots planned for ${customerId} (attempt ${attempt}/3)`,
      );
    }
    if (!slots.length) {
      this.log.error(`PLAN_WEEK yielded no slots for ${customerId} after retries`);
      return 0;
    }

    let drafted = 0;
    for (const slot of slots) {
      try {
        const scheduledTimeIso = zonedToUtc(slot.date, slot.best_time, tz).toISOString();
        const draft = await this.emit(customerId, 'DRAFT_POST', {
          platform: slot.platform,
          archetype: slot.archetype,
          scheduled_time: scheduledTimeIso,
          needs_asset: slot.needs_asset,
          shot_list_hint: slot.shot_list,
        });
        drafted++;

        // The draft has no photo of the owner's and they've asked us to make
        // one. Started here rather than inside the draft handler, which cannot
        // dispatch tasks without closing a dependency loop. Failures are
        // logged, never fatal: a post without a picture still goes out.
        const drafted_ = (draft as { data?: DraftPostResult })?.data;
        // A carousel is the default visual for informational posts; a single
        // generated photo is the fallback for the photo-first ones. The draft
        // handler picks exactly one, so these never both fire for a post.
        if (drafted_?.post_id && (drafted_.needs_carousel || drafted_.needs_image)) {
          const kind = drafted_.needs_carousel ? 'GENERATE_CAROUSEL' : 'GENERATE_IMAGE';
          const payload = drafted_.needs_carousel
            ? { post_id: drafted_.post_id }
            : { post_id: drafted_.post_id, aspect: '1:1' as const };
          const res = await this.emit(customerId, kind, payload).catch(
            (e) => ({ status: 'failed', error: { message: (e as Error).message } }),
          );

          // A carousel or image that fails must NOT vanish. Before, the error
          // went to a server log line and the post silently shipped as bare
          // text — exactly the "no pictures, and no reason why" a real planned
          // week came back with. Record the reason on the post so the cause is
          // visible in the operator view and can actually be found and fixed.
          // failureReason is not read by the publish gate, so this surfaces the
          // problem without blocking a post that can still go out as text.
          if ((res as { status?: string })?.status === 'failed') {
            const message =
              (res as { error?: { message?: string } })?.error?.message ?? 'unknown';
            this.log.warn(`${kind} for ${drafted_.post_id} failed: ${message}`);
            await this.prisma.post
              .update({
                where: { id: drafted_.post_id },
                data: { failureReason: `media ${kind}: ${message}`.slice(0, 500) },
              })
              .catch(() => undefined);
          }
        }

        // Carousel safety net. A post that should have had a visual but ended
        // up with none — an AI image the place-guard declined, a photo-first
        // archetype the owner never opted into imagery for, an archetype the
        // carousel set does not recognise — used to ship as bare text. On a
        // carousel-capable plan that is never the right answer: a carousel needs
        // no photo, no image API and cannot be declined. So if the post is still
        // empty after its intended treatment, make one. Photo-ask slots are left
        // alone — they are meant to wait for the owner's real shot.
        if (
          drafted_?.post_id &&
          !slot.needs_asset &&
          tierHasCarousel(customer?.planTier ?? 'starter')
        ) {
          const persisted = await this.prisma.post.findUnique({
            where: { id: drafted_.post_id },
            select: { mediaRefs: true },
          });
          if (persisted && persisted.mediaRefs.length === 0) {
            await this.emit(customerId, 'GENERATE_CAROUSEL', { post_id: drafted_.post_id })
              .catch((e) =>
                this.log.warn(`fallback carousel for ${drafted_.post_id} failed: ${e.message}`),
              );
          }
        }

        // Auto-approved posts must be scheduled here — nothing else does it.
        // On autopilot (trust auto_low_risk / full_auto) a cleared post is
        // persisted status='approved', but the publish sweep and reconciler
        // only ever look at status='scheduled'. Without this step the post
        // sits 'approved' forever: invisible to publishing, never even marked
        // failed. We read the post's REAL persisted status rather than the
        // draft result — a draft the guard forced back to the owner (invented
        // customer) reports 'done' but is actually pending_approval, and must
        // NOT be auto-scheduled. Owner-approval posts are scheduled later, when
        // the owner texts yes; only the ones already cleared for autopilot pass
        // through here. Runs after media generation so the scheduled post
        // carries its carousel/image.
        if (drafted_?.post_id) {
          const persisted = await this.prisma.post.findUnique({
            where: { id: drafted_.post_id },
            select: { status: true },
          });
          if (persisted?.status === 'approved') {
            await this.emit(customerId, 'SCHEDULE_POST', {
              post_id: drafted_.post_id,
              scheduled_time: scheduledTimeIso,
              // System-approved, not owner-approved: don't stamp an owner "yes"
              // it never gave. The post's approvalState is already
              // 'not_required', which SCHEDULE_POST accepts.
              owner_approved: false,
            }).catch((e) =>
              this.log.warn(`schedule for ${drafted_.post_id} failed: ${e.message}`),
            );
          }
        }
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

    // An empty photo bank means every post this week is designed, not real —
    // and real photos are the single biggest engagement lever we know of. One
    // nudge with the weekly plan, only while the bank stays empty; the moment
    // a single owner photo lands, this goes quiet forever.
    const bankedPhotos = await this.prisma.mediaAsset.count({
      where: { customerId, kind: 'image', source: 'owner_upload' },
    });
    if (bankedPhotos === 0) {
      const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
      await this.concierge
        .notify(customerId, photoWalkReminder(site, customerId), {
          promptedByOwner: false,
        })
        .catch((e) => this.log.warn(`photo-walk nudge failed for ${customerId}: ${String(e)}`));
    }

    // Growth+ gets one reel a week. The ask goes out with the plan, but only
    // if no video ask is already open — nagging twice about the same clips is
    // how you teach an owner to ignore you.
    if (customer?.planTier && customer.planTier !== 'starter') {
      const openVideoAsk = await this.prisma.shotListRequest.findFirst({
        where: { customerId, status: 'requested', prompt: { contains: 'clips' } },
      });
      if (!openVideoAsk) {
        // The ask is vertical-specific: a salon is asked for the before, the
        // work, and the mirror reveal — not a generic storefront pan. The
        // recipe is designed so the cut can't miss.
        const profile = await this.prisma.brandProfile.findUnique({
          where: { customerId },
          select: { businessType: true, contentStrategy: true },
        });
        // Swap the opening storefront shot for something filmable when the
        // business has no premises — an agency, or a trade that travels to the
        // customer. An ask nobody can complete stalls the whole reel.
        const v = {
          key: 'custom',
          reelClips: reelClipsFor(
            profile?.businessType,
            resolveStrategy(profile ?? {}).reel_clips as [string, string, string],
          ),
        };
        await this.prisma.shotListRequest.create({
          data: {
            customerId,
            prompt: `Reel clips (${v.key}): (1) ${v.reelClips[0]}, (2) ${v.reelClips[1]}, (3) ${v.reelClips[2]}. 5-10 seconds each.`,
          },
        });
        const site = process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com';
        await this.concierge.notify(
          customerId,
          `One more thing — film me 3 quick clips this week: (1) ${v.reelClips[0]}, (2) ${v.reelClips[1]}, (3) ${v.reelClips[2]}. 5-10 seconds each, don't overthink it. Upload here: ${site}/upload?c=${customerId}`,
        );
      }
    }

    this.log.log(`${customerId}: planned ${slots.length}, drafted ${drafted}`);
    return drafted;
  }

  /**
   * Every 15 minutes: release texts the quiet-hours guard held overnight.
   * Sends land within a quarter hour of the recipient's 8:00.
   */
  @Cron('*/15 * * * *', { timeZone: CRON_TZ })
  async flushQuietHoursQueue(): Promise<void> {
    if (!this.enabled) return;
    await this.concierge
      .flushQueuedTexts()
      .catch((e) => this.log.warn(`quiet-hours flush failed: ${e.message}`));
  }

  /** Dev-endpoint passthrough: drain the queue regardless of ENABLE_CRON. */
  async flushQueuedTextsNow(): Promise<number> {
    return this.concierge.flushQueuedTexts();
  }

  /**
   * Every 10 minutes: present drafts that were written but never shown.
   *
   * The post-onboarding pipeline (research → plan → draft → present) runs
   * minutes-long inside one process; a deploy landing in that window creates
   * drafts nobody was ever texted — the owner sits waiting on a message that
   * isn't coming. This sweep is the difference between "hiccup" and "lost
   * customer on day one". See ConciergeService.presentStrandedDrafts.
   */
  @Cron('*/10 * * * *', { timeZone: CRON_TZ })
  async presentStranded(): Promise<void> {
    if (!this.enabled) return;
    await this.concierge
      .presentStrandedDrafts()
      .catch((e) => this.log.warn(`stranded-draft sweep failed: ${e.message}`));
  }

  /**
   * Daily (09:00): ask owners whose platform connection is about to lapse to
   * reconnect. Meta's tokens expire every ~60 days with no server-side renewal,
   * so this is a deadline we can see coming — the alternative is posting
   * stopping with no explanation. See ReauthService.
   */
  @Cron('0 9 * * *', { timeZone: CRON_TZ })
  async askForReauth(): Promise<void> {
    if (!this.enabled) return;
    await this.reauth
      .sweep()
      .catch((e) => this.log.warn(`reauth sweep failed: ${e.message}`));
  }

  /**
   * Every 30 minutes: find posts whose moment passed but that never went out.
   *
   * The scheduled job firing is what publishes a post, and a job can be lost —
   * Redis evicted, a worker restarted mid-window. Without this the post simply
   * never happens and the owner finds out from their own feed. See
   * ReconcileService.
   */
  @Cron('*/30 * * * *', { timeZone: CRON_TZ })
  async reconcileStranded(): Promise<void> {
    if (!this.enabled) return;
    await this.reconcile
      .sweep()
      .catch((e) => this.log.warn(`reconciliation failed: ${e.message}`));
  }

  /** Dev-endpoint passthrough: run reconciliation regardless of ENABLE_CRON. */
  async reconcileNow(): Promise<{ requeued: number; stale: number }> {
    return this.reconcile.sweep();
  }

  /** Dev-endpoint passthrough: run the reauth sweep regardless of ENABLE_CRON. */
  async askForReauthNow(): Promise<number> {
    const { asked } = await this.reauth.sweep();
    return asked;
  }

  /**
   * Weekly (Sun 03:00): keep the playbook current. Algorithms shift, so a
   * stale archetype is a slowly-wrong strategy — see refreshStale for why
   * web-sourced rows are flagged rather than silently re-drafted.
   */
  @Cron('0 3 * * 0', { timeZone: CRON_TZ })
  async refreshPlaybook(): Promise<void> {
    if (!this.enabled) return;
    const { refreshed, flagged } = await this.research
      .refreshStale()
      .catch((e) => {
        this.log.warn(`playbook refresh failed: ${e.message}`);
        return { refreshed: [], flagged: [] };
      });
    if (refreshed.length || flagged.length) {
      this.log.log(
        `playbook freshness: refreshed ${refreshed.length}, flagged ${flagged.length} for review`,
      );
    }
  }

  /** Hourly: publish anything now due (belt-and-suspenders with BullMQ). */
  @Cron(CronExpression.EVERY_HOUR, { timeZone: CRON_TZ })
  async publishDue(): Promise<void> {
    if (!this.enabled) return;
    const ids = await this.activeCustomerIds();
    for (const id of ids) {
      await this.emit(id, 'PUBLISH_DUE', {}).catch((e) =>
        this.log.warn(`PUBLISH_DUE failed for ${id}: ${e.message}`),
      );
    }
  }

  /** Friday recap — the service proving it worked this week (retention §2). */
  @Cron('0 16 * * 5', { timeZone: CRON_TZ })
  async weeklyRecap(): Promise<void> {
    if (!this.enabled) return;
    for (const id of await this.activeCustomerIds()) {
      await this.sendRecap(id).catch((e) =>
        this.log.warn(`recap failed for ${id}: ${e.message}`),
      );
    }
  }

  async sendRecap(customerId: string): Promise<void> {
    const now = Date.now();
    const since = new Date(now - 7 * 24 * 3600 * 1000);
    const nextWeekEnd = new Date(now + 7 * 24 * 3600 * 1000);
    const [published, scheduled] = await Promise.all([
      // "went out this week" must key off the real publish time, not updatedAt —
      // any later metadata write (a failureReason, a metric touch) would move
      // updatedAt and mis-bucket the count.
      this.prisma.post.count({
        where: { customerId, status: 'published', publishedAt: { gte: since } },
      }),
      // "lined up for next week" means the coming week, not every scheduled post
      // however far out (or a stranded one not yet reconciled).
      this.prisma.post.count({
        where: {
          customerId,
          status: 'scheduled',
          scheduledTime: { gte: new Date(now), lte: nextWeekEnd },
        },
      }),
    ]);
    if (published === 0 && scheduled === 0) return; // nothing to brag about
    const bits = [
      published
        ? `${published} post${published > 1 ? 's' : ''} went out this week`
        : null,
      scheduled ? `${scheduled} lined up for next week` : null,
    ].filter(Boolean);
    await this.concierge.notify(
      customerId,
      `Friday check-in ✳ ${bits.join(', ')}. Have a great weekend — I've got the feed.`,
    );
  }

  /** Daily: pull fresh metrics so next week's plan learns from results. */
  @Cron('0 6 * * *', { timeZone: CRON_TZ })
  async fetchMetrics(): Promise<void> {
    if (!this.enabled) return;
    const ids = await this.activeCustomerIds();
    this.log.log(`daily FETCH_METRICS for ${ids.length} customers`);
    for (const id of ids) {
      await this.emit(id, 'FETCH_METRICS', {}).catch((e) =>
        this.log.warn(`FETCH_METRICS failed for ${id}: ${e.message}`),
      );
    }

    // Flow 4, immediately after: the numbers just landed, so this is the one
    // moment the pooled per-format results are certainly current. Monday's
    // planning reads them.
    await this.performance
      .recompute()
      .catch((e) => this.log.warn(`Flow 4 recompute failed: ${e.message}`));
  }

  /**
   * Daily (10:00): the month-in-review text, to everyone whose renewal is a
   * few days out. This category churns at ~46% a year and the difference is
   * whether the owner can see what they are paying for — see RecapService.
   */
  @Cron('0 10 * * *', { timeZone: CRON_TZ })
  async sendRecaps(): Promise<void> {
    if (!this.enabled) return;
    await this.recap
      .sweep()
      .catch((e) => this.log.warn(`recap sweep failed: ${e.message}`));
  }

  /** Dev-endpoint passthrough: run the recap sweep regardless of ENABLE_CRON. */
  async sendRecapsNow(): Promise<{ sent: number; skipped: number }> {
    return this.recap.sweep();
  }

  /** Dev-endpoint passthrough: rebuild Flow 4 regardless of ENABLE_CRON. */
  async recomputePerformanceNow(): Promise<{ rows: number; posts: number }> {
    return this.performance.recompute();
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
