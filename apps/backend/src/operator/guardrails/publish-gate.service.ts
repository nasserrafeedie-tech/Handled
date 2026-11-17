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
   * positives just mean an extra owner confirmation, and under full_auto this
   * classifier IS the line between "auto-posts on its own" and "a human sees it
   * first", so it errs toward catching.
   *
   * The gaps that were letting real promos auto-post: non-dollar currencies
   * (£5, €3), worded discounts ("20 percent off", "half off"), and multi-buy
   * offers ("two for one", "buy one get one"). Each is money the owner would
   * want to sign off on. Widened to catch them — but "save" is only a signal in
   * a money context ("save $5", "save big"), never bare, so the playbook's own
   * "save this post" call-to-action still auto-publishes as the evergreen
   * content it is.
   */
  classifyRisk(caption: string): RiskLevel {
    const c = caption.toLowerCase();
    const signals = [
      // Prices, any common currency symbol or worded amount.
      /[$£€]\s?\d/,
      /\b\d+\s?(dollars?|bucks?|cents?|quid|euros?|pounds?)\b/,
      // Percentages and worded discounts.
      /\b\d{1,3}\s?(%|percent)/,
      /\b(half|\d{1,3}\s?(%|percent))\s?(off|price)\b/,
      // Promo / offer language.
      /\b(sale|deal|offer|discount|promo|coupon|free|bogo|limited time|special|clearance|markdown)\b/,
      /\b(buy one|two for one|2 for 1|half off|half price)\b/,
      /\bsave\s+(\$?\d|up to|big)\b/,
      // Time pressure and specific calendar dates.
      /\b(today|tomorrow|tonight|this (week|weekend)|ends|expires|grand opening)\b/,
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s?\d{1,2}\b/,
      // Superlative / comparative claims. "#1" sits outside the \b group: a
      // word boundary can't come before "#", so inside it "#1" never matched.
      /\b(guarantee|guaranteed|best|cheapest|lowest price|number one)\b/,
      /(^|[^\w])(#1|no\.\s?1)\b/,
      // Health and results claims. A dentist, spa, salon, gym or groomer post
      // promising an outcome is the claim a regulator or an unhappy customer
      // holds the owner to, so it always waits for them.
      /\b(cures?|heals?|treats?|prevents?|relieves?|eliminates?|reverses?)\b.{0,40}\b(pain|acne|anxiety|disease|infection|cavities|gum disease|hair loss|wrinkles|arthritis|allergies|cancer|depression|weight)\b/,
      /\b(pain[- ]free|painless|clinically (proven|tested)|doctor recommended|fda|no side effects|risk[- ]free|permanent results|100% safe|miracle)\b/,
      /\b(lose|drop)\s+\d+\s?(lbs?|pounds|kg|inches)\b/,
    ];
    return signals.some((re) => re.test(c)) ? 'high' : 'low';
  }
}
