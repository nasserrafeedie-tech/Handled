import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService, inboundNoise } from './concierge.service';

/**
 * Duplicates and gibberish: Twilio repeating a webhook, or an owner sending
 * "asdfgh" or a lone emoji. Neither should text the owner twice or get a
 * confused answer, and gibberish must never reach the intent model, where it
 * could be read as feedback and rewrite a draft.
 */

type Row = Record<string, unknown>;

function steadyWorld(pending: boolean) {
  const replied: string[] = [];
  let classified = 0;
  const prisma = {
    post: { findFirst: async () => (pending ? { id: 'p1', status: 'pending_approval' } : null) },
    conversation: { findUnique: async () => ({ id: 'conv1', pendingIntent: null }) },
  };
  const svc = new ConciergeService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      classify: async () => {
        classified++;
        return { intent: 'revise', feedback: 'x', confidence: 0.9 };
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (svc as unknown as Row).reply = async (_p: string, _c: string, body: string) => void replied.push(body);
  const send = (body: string) =>
    (svc as unknown as {
      handleSteadyState(id: string, phone: string, conv: string, body: string): Promise<void>;
    }).handleSteadyState('cust1', '+15550001111', 'conv1', body);
  return { send, replied, classified: () => classified };
}

describe('inboundNoise', () => {
  it('spots keyboard mash and lone non-yes emoji', () => {
    for (const t of ['asdfgh', 'qwerty', 'zxcvb', 'sdfghj', 'hjkl']) assert.equal(inboundNoise(t), 'mash', t);
    for (const t of ['😂', '🤔🤔', '🙏']) assert.equal(inboundNoise(t), 'emoji', t);
  });

  it('leaves real words, yes emoji and questions alone', () => {
    for (const t of ['ok', 'yes', 'k', 'lol', 'property', 'liberty', 'quiet', 'rhythm', 'hmmmm', '???', 'Thanks!', '👍', '❤️', '...', 'post at 5', 'asdf']) {
      assert.equal(inboundNoise(t), null, t);
    }
  });
});

describe('gibberish in the steady state', () => {
  it('"asdfgh" with a draft waiting asks once and never reaches the intent model', async () => {
    const w = steadyWorld(true);
    await w.send('asdfgh');
    assert.equal(w.replied.length, 1);
    assert.match(w.replied[0], /Didn't catch that.*yes to post/);
    assert.equal(w.classified(), 0);
  });

  it('a lone 😂 with nothing waiting gets no reply', async () => {
    const w = steadyWorld(false);
    await w.send('😂');
    assert.equal(w.replied.length, 0);
    assert.equal(w.classified(), 0);
  });

  it('a lone 🤔 with a draft waiting asks whether to post it', async () => {
    const w = steadyWorld(true);
    await w.send('🤔');
    assert.match(w.replied[0], /post the draft/);
  });
});

describe('a repeated Twilio webhook', () => {
  it('is dropped quietly when its MessageSid is already stored', async () => {
    const sent: string[] = [];
    const seen = new Set<string>();
    const prisma = {
      customer: {
        findUnique: async () => ({
          id: 'cust1',
          phone: '+15550001111',
          email: null,
          preferredChannel: 'sms',
          stripeCustomerId: null,
          freeDraftUsedAt: new Date(),
          conversation: { id: 'conv1' },
        }),
      },
      message: {
        create: async ({ data }: { data: { twilioSid?: string } }) => {
          if (data.twilioSid && seen.has(data.twilioSid)) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          if (data.twilioSid) seen.add(data.twilioSid);
          return {};
        },
      },
    };
    const svc = new ConciergeService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    (svc as unknown as Row).reply = async (_p: string, _c: string, body: string) => void sent.push(body);
    const msg = { from: '+15550001111', body: 'hello there', mediaUrls: [], mediaContentTypes: [], twilioSid: 'SM123' };
    await svc.handleInbound(msg);
    await svc.handleInbound(msg);
    assert.equal(sent.length, 1, 'the owner is answered once');
  });
});
