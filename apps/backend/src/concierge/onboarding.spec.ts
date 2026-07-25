import { strict as assert } from 'node:assert';
import { describe, it, before, after } from 'node:test';

import { OnboardingService } from './onboarding.service';
import { NO_DOS_DONTS } from '../operator/llm/brand-context';

/**
 * Offline (no ANTHROPIC key) so interpretation is deterministic. These pin the
 * two rules a busy owner's answers depend on: "no, nothing special" is not a
 * brand rule, and a Starter can't be talked into 4 posts a week.
 */
const svc = new OnboardingService({ completeJson: async () => ({}) } as never);

let hadKey: string | undefined;
before(() => {
  hadKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});
after(() => {
  if (hadKey !== undefined) process.env.ANTHROPIC_API_KEY = hadKey;
});

describe('onboarding — standing rules', () => {
  it('requires dos_and_donts (it is asked, not skipped)', () => {
    // Everything filled except the rules → nextField must still ask for them.
    const profile = {
      businessType: 'cafe',
      voiceTone: 'warm',
      targetCustomer: 'locals',
      offers: ['coffee'],
      dosAndDonts: [],
      postingFrequency: 3,
      brandColors: [],
    } as never;
    assert.equal(svc.nextField(profile), 'dos_and_donts');
  });

  it('treats "no, nothing special" as no rules, not a rule named "no"', async () => {
    const patch = await svc.interpret('dos_and_donts', 'no, nothing special', null);
    assert.deepEqual(patch.dos_and_donts, [NO_DOS_DONTS]);
  });

  it('keeps a real rule that merely starts with "no"', async () => {
    const patch = await svc.interpret('dos_and_donts', 'no peanuts, ever', null);
    assert.notDeepEqual(patch.dos_and_donts, [NO_DOS_DONTS]);
    assert.ok(patch.dos_and_donts!.some((r) => /peanut/i.test(r)));
  });

  it('the no-rules sentinel never surfaces as a caption rule', () => {
    // buildBrandContext filters it — covered there; here we assert the marker is
    // the private sentinel, not human text an owner would recognize as a rule.
    assert.match(NO_DOS_DONTS, /no special rules/i);
  });
});

describe('onboarding — cadence is capped to the plan', () => {
  it('caps a Starter (3) who asks for 4', async () => {
    const patch = await svc.interpret('posting_frequency', '4', null, null, 3);
    assert.equal(patch.posting_frequency, 3);
  });

  it('honors fewer than the cap', async () => {
    const patch = await svc.interpret('posting_frequency', '2', null, null, 3);
    assert.equal(patch.posting_frequency, 2);
  });

  it('lets Growth (5) take 5', async () => {
    const patch = await svc.interpret('posting_frequency', '5', null, null, 5);
    assert.equal(patch.posting_frequency, 5);
  });

  it('the cadence question names the plan allowance', () => {
    assert.match(svc.question('posting_frequency', 3), /3 a week/);
  });
});
