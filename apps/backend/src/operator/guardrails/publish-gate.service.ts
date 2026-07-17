import { Injectable } from '@nestjs/common';
import type { RiskLevel, TrustLevel } from '@smm/contracts';

export interface GateDecision {
  /** May this post publish without owner sign-off right now? */
  autoPublishAllowed: boolean;
  /** Owner-facing approval state to persist on the post. */
  approvalState: 'not_required' | 'awaiting_owner';
  reason: string;
}

/**
 * §8 trust ramp — the gate the Operator checks before EVERY publish.
 *
 * Hard rule that overrides tier: anything with a claim, price, offer, date, or
 * promo (risk = high) requires owner confirmation regardless of trust level.
 * Only low-risk evergreen content can auto-publish, and only at higher tiers.
 */
@Injectable()
export class PublishGateService {
  decide(trust: TrustLevel, risk: RiskLevel): GateDecision {
    // High risk always needs a human, at any tier.
    if (risk === 'high') {
      return {
        autoPublishAllowed: false,
        approvalState: 'awaiting_owner',
        reason: 'high-risk content (claim/price/offer/date/promo) always confirmed',
      };
    }

    switch (trust) {
      case 'approve_all':
        return {
          autoPublishAllowed: false,
          approvalState: 'awaiting_owner',
          reason: 'customer is at approve_all — everything is confirmed first',
        };
      case 'auto_low_risk':
      case 'full_auto':
        return {
          autoPublishAllowed: true,
          approvalState: 'not_required',
          reason: `low-risk content auto-approved at ${trust}`,
        };
    }
  }

  /**
   * Classify draft risk. Presence of a price, percentage, date, or promo
   * language pushes a post to `high` (§8). Deliberately conservative — false
   * positives just mean an extra owner confirmation.
   */
  classifyRisk(caption: string): RiskLevel {
    const c = caption.toLowerCase();
    const signals = [
      /\$\s?\d/, // prices
      /\b\d{1,3}\s?%/, // percentages / discounts
      /\b(sale|deal|offer|discount|promo|coupon|free|bogo|limited time)\b/,
      /\b(today|tomorrow|tonight|this (week|weekend)|ends|expires)\b/,
      /\b(guarantee|guaranteed|best|#1|cheapest|lowest price)\b/, // claims
    ];
    return signals.some((re) => re.test(c)) ? 'high' : 'low';
  }
}
