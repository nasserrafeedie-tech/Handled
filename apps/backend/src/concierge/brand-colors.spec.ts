import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';

/**
 * "The colors don't match my brand" (live failure, Aug 7): the complaint was
 * routed as caption feedback, the deck rebuilt in the same wrong palette, and
 * nothing offered a way to actually change the stored colors. Color feedback
 * is PROFILE feedback: fix the identity, rebuild the pending decks, and when
 * no colors are named, ask — and read the next text as the answer.
 */

type Row = Record<string, unknown>;

function makeWorld(opts: {
  body: string;
  extracted?: string[];
  awaiting?: boolean;
  pendingDeck?: boolean;
}) {
  const emitted: Array<{ type: string; payload: Row }> = [];
  const replied: string[] = [];
  const presents: string[] = [];
  const profileUpdates: Row[] = [];
  const convoUpdates: Row[] = [];

  const prisma = {
    post: {
      findFirst: async () =>
        opts.pendingDeck
          ? { id: 'p1', status: 'pending_approval', caption: 'c', mediaRefs: ['a/slide-1.png'], scheduledTime: null, presentedAt: new Date() }
          : null,
      findMany: async () =>
        opts.pendingDeck ? [{ id: 'p1', mediaRefs: ['a/slide-1.png'] }] : [],
      update: async () => ({}),
    },
    brandProfile: {
      update: async (args: { data: Row }) => {
        profileUpdates.push(args.data);
        return {};
      },
    },
    mediaAsset: {
      findFirst: async ({ where }: { where: { source?: string } }) => {
        if (where.source === 'assembled') return { id: 'm-slides' };
        return null;
      },
    },
    customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
    conversation: {
      findUnique: async () => ({
        id: 'conv1',
        pendingIntent: opts.awaiting ? 'await:brand_colors' : null,
        pendingIntentAt: opts.awaiting ? new Date() : null,
      }),
      update: async (args: { data: Row }) => {
        convoUpdates.push(args.data);
        return {};
      },
    },
    message: { create: async () => ({}) },
  };
  const bus = {
    emit: async (t: { type: string; payload: Row }) => {
      emitted.push({ type: t.type, payload: t.payload });
      return { summary_for_owner: 'ok', status: 'done', data: null, error: null };
    },
  };
  const svc = new ConciergeService(
    prisma as never,
    bus as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { classify: async () => ({ intent: 'revise', feedback: opts.body, confidence: 1 }) } as never,
    { completeJson: async () => ({ colors: opts.extracted ?? [] }) } as never,
    {} as never,
    {} as never,
    {} as never,
    { publicUrl: (k: string) => `https://cdn.test/${k}` } as never,
  );
  (svc as unknown as Row).notify = async () => undefined;
  (svc as unknown as Row).reply = async (_p: string, _c: string, b: string) => void replied.push(b);
  (svc as unknown as Row).presentNextDraft = async (_id: string, lead?: string) => {
    presents.push(lead ?? '');
    return true;
  };

  const run = () =>
    (svc as unknown as {
      handleSteadyState(id: string, phone: string, conv: string, body: string): Promise<void>;
    }).handleSteadyState('cust1', '+15550001111', 'conv1', opts.body);
  return { run, emitted, replied, presents, profileUpdates, convoUpdates };
}

describe('brand color feedback', () => {
  it('a complaint naming no colors asks for them and arms the marker', async () => {
    const w = makeWorld({ body: "the colors dont match my brand", pendingDeck: true });
    await w.run();
    assert.equal(w.emitted.length, 0, 'no caption rewrite, no deck rebuild yet');
    assert.match(w.replied[0], /what are your colors/i);
    assert.match(w.replied[0], /logo/i, 'offers the logo path too');
    assert.equal(w.convoUpdates[0]?.pendingIntent, 'await:brand_colors');
  });

  it('named colors update the profile and rebuild the pending deck', async () => {
    const w = makeWorld({
      body: 'the colors are wrong — we are oxblood and cream',
      extracted: ['#8C2F39', '#F5EFE6'],
      pendingDeck: true,
    });
    await w.run();
    assert.deepEqual(w.profileUpdates[0], { brandColors: ['#8C2F39', '#F5EFE6'] });
    const rebuild = w.emitted.find((e) => e.type === 'GENERATE_CAROUSEL');
    assert.ok(rebuild, 'pending deck rebuilt');
    assert.equal(rebuild!.payload.replace_existing, true);
    assert.match(w.presents[0], /Switched your colors/);
  });

  it('the NEXT text after our question is read as the answer, not as intent', async () => {
    const w = makeWorld({
      body: 'oxblood and cream',
      extracted: ['#8C2F39', '#F5EFE6'],
      awaiting: true,
      pendingDeck: false,
    });
    await w.run();
    assert.deepEqual(w.profileUpdates[0], { brandColors: ['#8C2F39', '#F5EFE6'] });
    assert.match(w.replied[0], /Switched your colors/);
  });

  it('an unreadable answer re-asks gently and re-arms, never loops silently', async () => {
    const w = makeWorld({ body: 'the nice ones', awaiting: true });
    await w.run();
    assert.match(w.replied[0], /couldn't read colors/i);
    assert.ok(w.convoUpdates.some((u) => u.pendingIntent === 'await:brand_colors'), 're-armed');
  });
});
