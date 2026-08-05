import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';

/**
 * Revise routing (§6): which thing does the owner's feedback revise?
 *
 * The bug this guards (live, Aug 5): "Redo the carousel" was fed to the
 * caption rewriter — which wrote meta-copy about redesigning slides — while
 * the deck itself was never re-rendered, and the reply was a 120-char slice
 * of that caption with nothing attached. Deck feedback must rebuild the deck,
 * and every revise must re-present the full draft (whole caption, slides
 * attached) so the owner sees exactly what their "yes" would publish.
 */

type Row = Record<string, unknown>;

function makeWorld(opts?: {
  feedback: string;
  mediaRefs?: string[];
  ownerUpload?: boolean;
  carouselFails?: boolean;
}) {
  const emitted: Array<{ type: string; payload: Row }> = [];
  const notified: Array<{ body: string; mediaUrls?: string[] }> = [];
  const replied: string[] = [];

  const post: Row = {
    id: 'p1',
    customerId: 'cust1',
    status: 'pending_approval',
    caption: 'Original caption about pan dulce.',
    mediaRefs: opts?.mediaRefs ?? ['c1/old/slide-1.png', 'c1/old/slide-2.png'],
    scheduledTime: null,
    presentedAt: new Date(),
  };

  const prisma = {
    post: {
      findFirst: async () => ({ ...post }),
      findUnique: async () => ({ ...post }),
      update: async (args: { data: Row }) => {
        Object.assign(post, args.data);
        return { ...post };
      },
    },
    mediaAsset: {
      findFirst: async ({ where }: { where: { source?: string } }) => {
        if (where.source === 'owner_upload') return opts?.ownerUpload ? { id: 'm-owner' } : null;
        if (where.source === 'assembled') return opts?.ownerUpload ? null : { id: 'm-slides' };
        return null;
      },
    },
    customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles' }) },
    message: { create: async () => ({}) },
    conversation: {
      findUnique: async () => ({ id: 'conv1', pendingIntent: null }),
      update: async () => ({}),
    },
  };

  const bus = {
    emit: async (t: { type: string; payload: Row }) => {
      emitted.push({ type: t.type, payload: t.payload });
      if (t.type === 'REGENERATE_POST') {
        post.caption = 'Rewritten caption honoring the feedback about pan dulce.';
        return { summary_for_owner: 'Reworked it ✳', status: 'pending_approval', data: null, error: null };
      }
      if (t.type === 'GENERATE_CAROUSEL') {
        if (opts?.carouselFails) {
          return {
            summary_for_owner: "I couldn't lay that one out as slides — I'll keep it as a plain post.",
            status: 'failed',
            data: null,
            error: { code: 'carousel_copy_failed', message: 'llm down', retryable: true },
          };
        }
        post.mediaRefs = ['c1/new/slide-1.png', 'c1/new/slide-2.png', 'c1/new/slide-3.png'];
        return { summary_for_owner: 'Rebuilt it.', status: 'done', data: null, error: null };
      }
      return { summary_for_owner: 'ok', status: 'done', data: null, error: null };
    },
  };

  const svc = new ConciergeService(
    prisma as never,
    bus as never,
    {} as never, // twilio (reply/notify are stubbed below)
    {} as never, // email
    {} as never, // onboarding
    {} as never, // lookup
    { classify: async () => ({ intent: 'revise', feedback: opts?.feedback, confidence: 1 }) } as never,
    {} as never, // llm
    {} as never, // playbook
    {} as never, // classifier
    {} as never, // research
    { publicUrl: (k: string) => `https://cdn.test/${k}` } as never,
  );
  // Delivery plumbing (quiet hours, channel pick) is covered by its own
  // tests — here we only care WHAT is presented and with WHICH media.
  (svc as unknown as Row).notify = async (
    _customerId: string,
    body: string,
    o?: { mediaUrls?: string[] },
  ) => void notified.push({ body, mediaUrls: o?.mediaUrls });
  (svc as unknown as Row).reply = async (_p: string, _c: string, body: string) =>
    void replied.push(body);

  const run = () =>
    (svc as unknown as {
      handleSteadyState(id: string, phone: string, conv: string, body: string): Promise<void>;
    }).handleSteadyState('cust1', '+15550001111', 'conv1', opts?.feedback ?? '');

  return { run, emitted, notified, replied, post };
}

describe('revise routing', () => {
  it('"Redo the carousel" rebuilds the DECK — no caption rewrite, full deck re-presented', async () => {
    const w = makeWorld({ feedback: 'Redo the carousel' });
    await w.run();
    assert.deepEqual(w.emitted.map((e) => e.type), ['GENERATE_CAROUSEL']);
    assert.equal(w.emitted[0].payload.replace_existing, true);
    assert.match(String(w.emitted[0].payload.owner_feedback), /redo the carousel/i);
    assert.equal(w.post.caption, 'Original caption about pan dulce.', 'caption untouched');
    assert.equal(w.notified.length, 1, 're-presented once');
    assert.match(w.notified[0].body, /Rebuilt the carousel/);
    assert.match(w.notified[0].body, /Original caption about pan dulce\./, 'full caption shown');
    assert.equal(w.notified[0].mediaUrls?.length, 3, 'the NEW deck rides along');
    for (const u of w.notified[0].mediaUrls!) assert.match(u, /\/new\//);
  });

  it('wording feedback on a carousel post rewrites the caption AND rebuilds the deck to match', async () => {
    const w = makeWorld({ feedback: 'make it shorter and mention the patio' });
    await w.run();
    assert.deepEqual(w.emitted.map((e) => e.type), ['REGENERATE_POST', 'GENERATE_CAROUSEL']);
    assert.match(w.notified[0].body, /Rewritten caption honoring the feedback/, 'whole caption, no 120-char slice');
    assert.equal(w.notified[0].mediaUrls?.length, 3, 'slides re-rendered from the new caption');
  });

  it('a post with an owner photo never gets a carousel from a revise', async () => {
    const w = makeWorld({ feedback: 'make it shorter', ownerUpload: true, mediaRefs: ['c1/owner.jpg'] });
    await w.run();
    assert.deepEqual(w.emitted.map((e) => e.type), ['REGENERATE_POST']);
    assert.equal(w.notified.length, 1, 'still re-presented');
  });

  it('a text-only post with visual words still just rewrites the caption', async () => {
    const w = makeWorld({ feedback: 'redo the design of this', mediaRefs: [] });
    await w.run();
    assert.deepEqual(w.emitted.map((e) => e.type), ['REGENERATE_POST']);
  });

  it('a failed rebuild is reported honestly — no cheerful re-present', async () => {
    const w = makeWorld({ feedback: 'Redo the carousel', carouselFails: true });
    await w.run();
    assert.equal(w.notified.length, 0);
    assert.equal(w.replied.length, 1);
    assert.match(w.replied[0], /couldn't lay that one out/i);
  });
});
