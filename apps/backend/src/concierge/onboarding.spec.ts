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

describe('onboarding — model routing', () => {
  it('extracts the profile on the voice tier (Sonnet), not bulk (Haiku)', async () => {
    // Onboarding runs once per customer and the profile is the foundation for
    // everything after, so it gets the better model. Requires a key so the LLM
    // path (not the offline fallback) runs.
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    try {
      let seenTier: string | undefined;
      const spy = new OnboardingService({
        completeJson: async (req: { tier: string }) => {
          seenTier = req.tier;
          return { business_type: 'bakery in Pasadena', business_name: 'Rise' };
        },
      } as never);
      await spy.interpret('business_type', 'a bakery called Rise in Pasadena', null);
      assert.equal(seenTier, 'voice');
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('onboarding — standing rules', () => {
  it('requires dos_and_donts (it is asked, not skipped)', () => {
    // Everything filled except the rules → nextField must still ask for them.
    const profile = {
      businessType: 'cafe',
      websiteUrl: 'https://example.com',
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

  it('reads worded frequencies and ignores stray numbers (offline)', async () => {
    const freq = async (a: string, cap?: number) =>
      (await svc.interpret('posting_frequency', a, null, null, cap)).posting_frequency;
    assert.equal(await freq('twice a week', 5), 2);
    assert.equal(await freq('once a week', 5), 1);
    assert.equal(await freq('three times', 5), 3);
    assert.equal(await freq('daily', 7), 7);
    assert.equal(await freq('5x', 5), 5);
    // A stray promo number must not be read as cadence — falls to the default 3.
    assert.equal(await freq('post about our 20% special', 5), 3);
  });
});

describe('onboarding — greeting vs a real short answer', () => {
  it('treats an actual greeting as a non-answer', () => {
    for (const g of ['hi', 'hey there', 'hello!', 'yo', 'k']) {
      assert.equal(svc.isGreetingOnly(g), true, g);
    }
  });

  it('does NOT discard a short but real business answer', () => {
    for (const a of ['gym', 'bakery', 'car wash', 'nail salon']) {
      assert.equal(svc.isGreetingOnly(a), false, a);
    }
  });
});
