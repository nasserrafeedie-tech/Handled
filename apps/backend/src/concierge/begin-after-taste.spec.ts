import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';
import { OnboardingService } from './onboarding.service';

/**
 * Someone who got a free draft has already described their business. When
 * they pay, that description answers question one instead of being asked for
 * again, and an email signup is never told to "reply to my texts".
 */
function harness(opts: { channel: 'sms' | 'email'; taste?: { asked: string } }) {
  const sent: string[] = [];
  const continued: { answer: string; to: string }[] = [];
  const t0 = new Date('2026-11-16T10:00:00Z');
  const messages = opts.taste
    ? [
        { direction: 'inbound', body: opts.taste.asked, createdAt: t0 },
        { direction: 'outbound', body: "Here's what I'd post for you:\n\n“x”", createdAt: new Date(t0.getTime() + 1000) },
      ]
    : [];
  const prisma = {
    customer: {
      findUnique: async () => ({
        id: 'c1',
        phone: opts.channel === 'sms' ? '+13105550000' : '+13105550001',
        email: opts.channel === 'email' ? 'jo@juniper.test' : null,
        preferredChannel: opts.channel,
        stripeCustomerId: 'cus_1',
        businessName: 'Juniper Florals',
        planTier: 'growth',
        freeDraftUsedAt: opts.taste ? t0 : null,
        conversation: { id: 'conv1' },
      }),
    },
    brandProfile: { findUnique: async () => ({ businessType: null }) },
    message: {
      findFirst: async ({ where }: any) => {
        const pool = messages
          .filter((m) => m.direction === where.direction)
          .filter((m) => !where.body?.startsWith || m.body.startsWith(where.body.startsWith))
          .filter((m) => !where.createdAt?.lte || m.createdAt <= where.createdAt.lte);
        return pool[pool.length - 1] ?? null;
      },
    },
  };
  const svc = new ConciergeService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    new OnboardingService({} as never),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (svc as any).notify = async (_id: string, body: string) => void sent.push(body);
  (svc as any).continueOnboarding = async (_id: string, to: string, _c: string, answer: string) =>
    void continued.push({ answer, to });
  return { svc, sent, continued };
}

describe('starting the interview after a free draft', () => {
  it('takes the free-draft description as the first answer', async () => {
    const h = harness({ channel: 'sms', taste: { asked: 'Flower shop in Silver Lake, weddings and events' } });
    await h.svc.beginOnboarding('c1');
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0], /already answers the first/);
    assert.doesNotMatch(h.sent[0], /1 of 7/);
    assert.deepEqual(h.continued, [{ answer: 'Flower shop in Silver Lake, weddings and events', to: '+13105550000' }]);
  });

  it('asks question one as usual with no free draft, or when they only said hi', async () => {
    for (const taste of [undefined, { asked: 'hey!' }]) {
      const h = harness({ channel: 'sms', taste });
      await h.svc.beginOnboarding('c1');
      assert.match(h.sent[0], /1 of 7: Tell me about Juniper Florals/);
      assert.equal(h.continued.length, 0);
    }
  });

  it('talks about email, not texts, to an email signup', async () => {
    const h = harness({ channel: 'email', taste: { asked: 'Flower shop in Silver Lake' } });
    await h.svc.beginOnboarding('c1');
    assert.match(h.sent[0], /reply to my emails/);
    assert.doesNotMatch(h.sent[0], /texts|contact/);
    assert.equal(h.continued[0].to, 'jo@juniper.test');
  });
});
