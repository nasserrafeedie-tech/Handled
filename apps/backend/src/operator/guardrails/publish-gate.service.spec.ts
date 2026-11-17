import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PublishGateService } from './publish-gate.service';

/**
 * The gate is the line between "posts on its own" and "a human sees it first",
 * and it had no tests at all. Under full_auto the risk classifier alone decides
 * whether a promo goes out unreviewed, so the misses are the point of these
 * tests: a price or offer the classifier waves through is money spent — or a
 * claim made — under the business's name with nobody watching.
 */
const gate = new PublishGateService();

describe('the trust gate', () => {
  it('always holds high-risk content, at every trust level', () => {
    for (const trust of ['approve_all', 'auto_low_risk', 'full_auto'] as const) {
      const d = gate.decide(trust, 'high');
      assert.equal(d.autoPublishAllowed, false, `high risk auto-published at ${trust}`);
      assert.equal(d.approvalState, 'awaiting_owner');
    }
  });

  it('holds everything on approve_all, even low risk', () => {
    const d = gate.decide('approve_all', 'low');
    assert.equal(d.autoPublishAllowed, false);
    assert.equal(d.approvalState, 'awaiting_owner');
  });

  it('auto-publishes low-risk content on the autopilot tiers', () => {
    for (const trust of ['auto_low_risk', 'full_auto'] as const) {
      const d = gate.decide(trust, 'low');
      assert.equal(d.autoPublishAllowed, true, `low risk was held at ${trust}`);
      assert.equal(d.approvalState, 'not_required');
    }
  });
});

describe('risk classification — what full_auto may NOT post unreviewed', () => {
  // Every one of these is money, a promo, or a dated claim. Auto-posting it
  // without a human is the failure this classifier exists to prevent.
  for (const caption of [
    '$5 lattes all week',
    '£5 pastries this morning', // non-dollar currency
    '€3 espresso today',
    '5 bucks a cup',
    '20 percent off everything', // worded percentage
    '50% off',
    'Half off all lattes',
    'Two for one on croissants', // multi-buy
    'Buy one get one free',
    'Save big this Friday', // promo "save"
    'Save $10 on a dozen',
    'Grand opening March 5th', // dated event
    'Best coffee in town, guaranteed', // claim
    'Limited time only',
    "We're the #1 barber in Pasadena", // "#1" used to slip past the word boundary
    'Voted No. 1 groomer',
    'Our whitening is completely pain-free', // health / results claims
    'Clinically proven to whiten',
    'This facial cures acne in one visit',
    'Laser treatment that eliminates back pain',
    'Lose 10 lbs with our bootcamp',
    'Totally risk-free',
  ]) {
    it(`flags "${caption}" as high risk`, () => {
      assert.equal(gate.classifyRisk(caption), 'high');
    });
  }
});

describe('risk classification — what full_auto SHOULD post on its own', () => {
  // Evergreen content with no price, promo, or dated claim. Flagging these
  // would gut autopilot by sending ordinary posts back for approval.
  for (const caption of [
    'Behind the scenes at the bakery this morning',
    'Our new seasonal blend just dropped',
    'Meet the team that makes your morning coffee',
    'Save this post for your next visit', // the playbook's own CTA — not a promo
    'Open till 8 on Friday', // hours, not an offer
    'A little rainy-day pour to warm you up',
    'How we treat every dog like family', // "treat" with no health outcome
    'Healthy gums start with flossing before you brush', // advice, not a promise
    'Hashtag #1stday at the new shop',
  ]) {
    it(`lets "${caption}" through as low risk`, () => {
      assert.equal(gate.classifyRisk(caption), 'low');
    });
  }
});
