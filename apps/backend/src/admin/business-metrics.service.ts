import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { costOf, formatCost } from '../operator/llm/pricing';

/**
 * The two numbers that decide whether this business works.
 *
 * Churn, because social media services lose roughly 46% of customers a year —
 * the worst of any marketing category — and at this price the whole model
 * depends on customers staying. Anything above about 5% a month is a fire, and
 * a fire is much cheaper to put out in month two than in month ten.
 *
 * Cost to serve, because a ~90% margin has so far been an assumption rather
 * than a measurement. A quiet owner and one who revises every draft cost
 * wildly different amounts, and until now nothing recorded which was which.
 *
 * Built before the first customer on purpose: a churn rate cannot be
 * backfilled, and starting the count at customer one is the only way to have
 * the number when it starts to matter.
 */

export interface BusinessMetrics {
  customers: {
    active: number;
    paused: number;
    cancelled: number;
    onboarding: number;
  };
  churn: {
    /** Cancelled in the last 30 days. */
    lost30d: number;
    /** Active at the start of the window — the denominator. */
    baseline: number;
    /** Monthly rate as a percentage, or null when there is nothing to divide. */
    monthlyRatePct: number | null;
    /** Plain-English read, so the number does not need interpreting. */
    verdict: 'no data' | 'healthy' | 'watch' | 'fire';
  };
  revenue: {
    mrrUsd: number;
    byTier: { tier: string; customers: number; mrrUsd: number }[];
  };
  cost: {
    last30dUsd: number;
    last30dLabel: string;
    /** Model spend as a percentage of MRR. */
    pctOfMrr: number | null;
    perCustomer: { customerId: string; businessName: string | null; usd: number; label: string }[];
  };
}

/** What each tier bills monthly. */
const TIER_PRICE: Record<string, number> = {
  starter: 95,
  growth: 349,
  pro: 699,
};

/** Above this monthly churn, the business does not compound. */
const FIRE_ABOVE_PCT = 5;
const WATCH_ABOVE_PCT = 3;

@Injectable()
export class BusinessMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async build(now = new Date()): Promise<BusinessMetrics> {
    const since = new Date(now.getTime() - 30 * 86_400_000);

    const [customers, usage] = await Promise.all([
      this.prisma.customer.findMany({
        select: {
          id: true,
          businessName: true,
          status: true,
          planTier: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.llmUsage.findMany({
        where: { createdAt: { gte: since } },
        select: {
          customerId: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheWriteTokens: true,
        },
      }),
    ]);

    const byStatus = (s: string) => customers.filter((c) => c.status === s).length;
    const active = byStatus('active');
    const cancelled = byStatus('cancelled');

    // Anyone who cancelled inside the window. updatedAt is a proxy for when
    // the status changed — good enough for a trend, and it is the trend that
    // matters, not the third decimal place.
    const lost30d = customers.filter(
      (c) => c.status === 'cancelled' && c.updatedAt >= since,
    ).length;

    // The denominator is who was around to leave: everyone still active, plus
    // everyone who left. Using only current actives would understate churn
    // exactly when it is worst.
    const baseline = active + lost30d;
    const monthlyRatePct = baseline > 0 ? (lost30d / baseline) * 100 : null;

    const activeCustomers = customers.filter((c) => c.status === 'active');
    const tiers = [...new Set(activeCustomers.map((c) => c.planTier))].sort();
    const byTier = tiers.map((tier) => {
      const n = activeCustomers.filter((c) => c.planTier === tier).length;
      return { tier, customers: n, mrrUsd: n * (TIER_PRICE[tier] ?? 0) };
    });
    const mrrUsd = byTier.reduce((sum, t) => sum + t.mrrUsd, 0);

    const costByCustomer = new Map<string, number>();
    let totalCostUsd = 0;
    for (const u of usage) {
      const c = costOf(u);
      totalCostUsd += c;
      // Unattributed work (playbook research is paid once and reused by every
      // business in that trade) counts toward the total but belongs to nobody.
      if (u.customerId) {
        costByCustomer.set(u.customerId, (costByCustomer.get(u.customerId) ?? 0) + c);
      }
    }

    const nameOf = new Map(customers.map((c) => [c.id, c.businessName]));
    const perCustomer = [...costByCustomer.entries()]
      .map(([customerId, usd]) => ({
        customerId,
        businessName: nameOf.get(customerId) ?? null,
        usd,
        label: formatCost(usd),
      }))
      // Most expensive first: the outlier is the one worth understanding.
      .sort((a, b) => b.usd - a.usd);

    return {
      customers: {
        active,
        paused: byStatus('paused'),
        cancelled,
        onboarding: byStatus('onboarding'),
      },
      churn: {
        lost30d,
        baseline,
        monthlyRatePct,
        verdict: this.verdict(monthlyRatePct, baseline),
      },
      revenue: { mrrUsd, byTier },
      cost: {
        last30dUsd: totalCostUsd,
        last30dLabel: formatCost(totalCostUsd),
        pctOfMrr: mrrUsd > 0 ? (totalCostUsd / mrrUsd) * 100 : null,
        perCustomer,
      },
    };
  }

  /**
   * A rate needs a verdict attached, or it is just a number on a page. The
   * thresholds are the ones the category research gives: 3-5% a month is
   * normal for a service at this price, above 5% is the thing that kills it.
   */
  private verdict(ratePct: number | null, baseline: number): BusinessMetrics['churn']['verdict'] {
    // A single cancellation out of two customers is 50% and means nothing.
    // Calling that a fire would teach you to ignore the number.
    if (ratePct === null || baseline < 10) return 'no data';
    if (ratePct > FIRE_ABOVE_PCT) return 'fire';
    if (ratePct > WATCH_ABOVE_PCT) return 'watch';
    return 'healthy';
  }
}
