import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConciergeService } from './concierge.service';

/**
 * A graphic must be COMMISSIONED, not merely mentioned.
 *
 * The bug this guards: "Can I see the full carousel?" — a request to LOOK at
 * an existing draft — matched the old bare-noun regex, generated a nonsense
 * graphic from the question's own words, and replied "Made your graphic" with
 * nothing attached. Viewing words must never read as making words.
 *
 * isGraphicRequest is pure (regex on the body), so a bare instance suffices.
 */
const svc = new ConciergeService(
  ...(Array(12).fill(undefined) as []),
) as unknown as { isGraphicRequest(b: string): boolean };
const isMake = (b: string) => svc.isGraphicRequest(b);

describe('graphic request detection', () => {
  it('fires on genuine commissions', () => {
    for (const b of [
      'can you make a graphic about our happy hour',
      'Make me a carousel on spring cleaning tips',
      'I need a promo flyer for the weekend',
      'create a quote card from that review',
      'can I get a graphic for the sale',
      'make me a post about closing early friday',
    ]) {
      assert.equal(isMake(b), true, `"${b}" should commission a graphic`);
    }
  });

  it('never fires on requests to VIEW an existing draft or its media', () => {
    for (const b of [
      'Can I see the full carousel?',
      'show me the carousel',
      'can you resend the graphic',
      'where is the carousel you mentioned',
      'send the slides again',
      'I want to look at the graphic first',
    ]) {
      assert.equal(isMake(b), false, `"${b}" is a view, not a make`);
    }
  });

  it('ignores captions that merely mention the words', () => {
    for (const b of ['yes', 'love the carousel, schedule it', 'that promo looks great']) {
      assert.equal(isMake(b), false, `"${b}" should not commission anything`);
    }
  });
});

/**
 * QA round 2 (Nov 17): "make a graphic for our birthday party packages" sent
 * back a graphic headed "our birthday party packages" with "ready to review",
 * and "post it" then found nothing to post. It now comes as a draft post.
 */
describe('a requested graphic becomes a post', () => {
  function world(opts: { draftFails?: boolean; waiting?: boolean; planTier?: string; deckFails?: boolean } = {}) {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const replies: Array<{ body: string; media?: string[] }> = [];
    const shown: string[] = [];
    const postUpdates: Array<Record<string, unknown>> = [];
    const prisma = {
      customer: { findUnique: async () => ({ timezone: 'America/Los_Angeles', planTier: opts.planTier ?? 'starter' }) },
      connectedAccount: { findFirst: async () => ({ platform: 'instagram' }) },
      post: {
        findUnique: async () => ({ status: 'approved' }),
        findFirst: async () => (opts.waiting ? { id: 'older' } : null),
        count: async () => (opts.waiting ? 3 : 0),
        update: async ({ data }: { data: Record<string, unknown> }) => void postUpdates.push(data),
      },
    };
    const bus = {
      emit: async (t: { type: string; payload: Record<string, unknown> }) => {
        emitted.push(t);
        if (t.type === 'GENERATE_CAROUSEL') {
          return opts.deckFails ? { error: { code: 'x' }, summary_for_owner: 'no' } : { data: { slides: [] }, summary_for_owner: 'ok' };
        }
        if (t.type === 'DRAFT_POST') {
          return opts.draftFails ? { error: { code: 'x' }, summary_for_owner: 'no' } : { data: { post_id: 'p1' }, summary_for_owner: 'ok' };
        }
        return { data: { slides: [{ media_ref: 'k/slide-1.png' }] }, summary_for_owner: 'Made your graphic — ready to review.' };
      },
    };
    const svc = new ConciergeService(prisma as never, bus as never, ...(Array(10).fill({ publicUrl: (k: string) => `https://cdn.test/${k}` }) as [never]));
    (svc as any).reply = async (_to: string, _c: string, body: string, media?: string[]) => void replies.push({ body, media });
    (svc as any).presentNextDraft = async (_id: string, lead: string, o: { postId: string }) => void shown.push(`${lead} ${o.postId}`);
    const ask = (body: string) => (svc as any).makeRequestedGraphic('c1', '+1555', 'conv1', body);
    return { ask, emitted, replies, shown, postUpdates };
  }

  it('drafts a caption, puts the graphic on that post, and shows it for a yes', async () => {
    const w = world();
    await w.ask('make a graphic for our birthday party packages');
    assert.deepEqual(w.emitted.map((e) => e.type), ['DRAFT_POST', 'MAKE_GRAPHIC']);
    assert.equal(w.emitted[1].payload.post_id, 'p1');
    const slides = w.emitted[1].payload.slides as Array<{ headline: string }>;
    assert.equal(slides[0].headline, 'Birthday party packages');
    assert.deepEqual(w.postUpdates[0], { status: 'pending_approval', approvalState: 'awaiting_owner' });
    assert.deepEqual(w.shown, ['Made it ✳ Here it is as a post: p1']);
  });

  it('shows it straight away even with drafts already waiting', async () => {
    // "yes" answers the draft shown last, so the one they asked for no longer
    // waits behind the queue (QA, Nov 17: eight drafts ahead of it).
    const w = world({ waiting: true });
    await w.ask('make a graphic for our birthday party packages');
    assert.deepEqual(w.shown, ['Made it ✳ Here it is as a post: p1']);
    assert.equal(w.replies.length, 0);
  });

  it('a carousel ask on a carousel plan builds a real deck from the post', async () => {
    const w = world({ planTier: 'growth' });
    await w.ask('can you make a carousel about our nail trims');
    assert.deepEqual(w.emitted.map((e) => e.type), ['DRAFT_POST', 'GENERATE_CAROUSEL']);
    assert.equal(w.emitted[1].payload.post_id, 'p1');
    assert.deepEqual(w.shown, ['Made it ✳ Here it is as a post: p1']);
  });

  it('falls back to the single graphic when the deck fails, or on Starter', async () => {
    const failed = world({ planTier: 'growth', deckFails: true });
    await failed.ask('can you make a carousel about our nail trims');
    assert.deepEqual(failed.emitted.map((e) => e.type), ['DRAFT_POST', 'GENERATE_CAROUSEL', 'MAKE_GRAPHIC']);
    const starter = world();
    await starter.ask('can you make a carousel about our nail trims');
    assert.deepEqual(starter.emitted.map((e) => e.type), ['DRAFT_POST', 'MAKE_GRAPHIC']);
    const slides = starter.emitted[1].payload.slides as Array<{ headline: string }>;
    assert.equal(slides[0].headline, 'Nail trims');
  });

  it('still sends the graphic if the caption could not be written', async () => {
    const w = world({ draftFails: true });
    await w.ask('make a graphic for our birthday party packages');
    assert.equal(w.emitted[1].payload.post_id, undefined);
    assert.deepEqual(w.replies[0].media, ['https://cdn.test/k/slide-1.png']);
  });
});

describe('the ask around a graphic is not printed on it', () => {
  it('keeps only the subject', async () => {
    const { stripCommand } = await import('./concierge.service');
    assert.equal(stripCommand('can you make a carousel about our nail trims'), 'our nail trims');
    assert.equal(stripCommand('could you design a flyer for our grand opening please?'), 'our grand opening');
    assert.equal(stripCommand('pls make a post about kids cuts'), 'kids cuts');
    assert.equal(stripCommand('make a graphic that says "Open late Fridays"'), 'Open late Fridays');
    assert.equal(stripCommand('Saturday sale 20% off'), 'Saturday sale 20% off');
  });
});
