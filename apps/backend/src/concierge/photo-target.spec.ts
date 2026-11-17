import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';

/**
 * QA round 4 (Nov 17): the Tuesday draft ended "text me a photo and I'll put
 * it on this post", the owner sent one, and it went on Monday's scheduled post
 * because Monday's shot-list ask was older. A photo now goes on the draft they
 * were just shown, and that draft comes back with the photo for their yes.
 */
type Ask = { id: string; postId: string | null; askedAt: Date };
type Post = { id: string; presentedAt: Date | null };

function world(o: { ask?: Ask | null; shown?: Post | null; next?: { id: string } | null }) {
  const emitted: Array<Record<string, unknown>> = [];
  const shown: string[] = [];
  const sent: string[] = [];
  const prisma = {
    shotListRequest: {
      findFirst: async ({ where }: { where: { postId?: string } }) =>
        where.postId ? (o.ask?.postId === where.postId ? o.ask : null) : (o.ask ?? null),
    },
    post: {
      findFirst: async ({ where }: { where: { presentedAt?: unknown } }) =>
        where.presentedAt ? (o.shown ?? null) : (o.next ?? null),
    },
  };
  const bus = {
    emit: async (t: { payload: Record<string, unknown> }) => {
      emitted.push(t.payload);
      return { status: 'done', summary_for_owner: 'Love it — added.' };
    },
  };
  const svc = new ConciergeService(prisma as never, bus as never, ...(Array(10).fill({}) as [never]));
  (svc as any).reply = async (_a: unknown, _c: string, body: string) => void sent.push(body);
  (svc as any).presentNextDraft = async (_id: string, lead: string, opts: { postId: string }) => {
    shown.push(`${lead} ${opts.postId}`);
    return true;
  };
  return { svc, emitted, shown, sent };
}

const T = (min: number) => new Date(Date.UTC(2026, 10, 17, 12, min));

describe('where a texted photo goes', () => {
  it('goes on the draft they were just shown, not an older ask for another post', async () => {
    const w = world({ ask: { id: 'a1', postId: 'mon', askedAt: T(0) }, shown: { id: 'tue', presentedAt: T(5) } });
    assert.deepEqual(await w.svc.photoTarget('c1'), { askId: undefined, postId: 'tue', shownDraft: true });
  });

  it('fills an ask made after the draft was shown', async () => {
    const w = world({ ask: { id: 'a1', postId: 'mon', askedAt: T(9) }, shown: { id: 'tue', presentedAt: T(5) } });
    assert.deepEqual(await w.svc.photoTarget('c1'), { askId: 'a1', postId: 'mon', shownDraft: false });
  });

  it('closes the ask when it was for the shown draft', async () => {
    const w = world({ ask: { id: 'a1', postId: 'tue', askedAt: T(0) }, shown: { id: 'tue', presentedAt: T(5) } });
    assert.deepEqual(await w.svc.photoTarget('c1'), { askId: 'a1', postId: 'tue', shownDraft: true });
  });

  it('falls back to the next photoless post when nothing is showing', async () => {
    const w = world({ next: { id: 'wed' } });
    assert.deepEqual(await w.svc.photoTarget('c1'), { postId: 'wed', shownDraft: false });
  });

  it('shows the draft again with the photo on it, and keeps a second photo on it too', async () => {
    const w = world({ shown: { id: 'tue', presentedAt: T(5) } });
    (w.svc as any).addressOf = () => ({ channel: 'sms', to: '+1555' });
    await w.svc.takePhotos({ id: 'c1', phone: '+1555', email: null, preferredChannel: 'sms' }, 'conv1', {
      from: '+1555',
      body: '',
      mediaUrls: ['https://x/1.jpg', 'https://x/2.jpg'],
      mediaContentTypes: [],
    });
    assert.deepEqual(w.emitted.map((e) => e.post_id), ['tue', 'tue']);
    assert.deepEqual(w.shown, ['Added your photo ✳ tue']);
    assert.deepEqual(w.sent, []);
  });

  it('just says where it went when the photo fills a later post', async () => {
    const w = world({ next: { id: 'wed' } });
    (w.svc as any).addressOf = () => ({ channel: 'sms', to: '+1555' });
    await w.svc.takePhotos({ id: 'c1', phone: '+1555', email: null, preferredChannel: 'sms' }, 'conv1', {
      from: '+1555', body: '', mediaUrls: ['https://x/1.jpg'], mediaContentTypes: [],
    });
    assert.deepEqual(w.shown, []);
    assert.deepEqual(w.sent, ['Love it — added.']);
  });
});
