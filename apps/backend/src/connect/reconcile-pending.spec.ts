import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConnectService } from './connect.service';

/**
 * The mobile connect bug: the OAuth return lands in a different browser than
 * the one that started it (the Instagram app's in-app view), so the callback
 * has no idea whose connection to sync. The server does — every started
 * connect is recorded on the customer — and reconcilePending finishes them.
 */
function build(opts: {
  waiting: Array<{ id: string; platform: string }>;
  connectsAfter: Record<string, string[]>;
}) {
  const cleared: string[] = [];
  const prisma = {
    customer: {
      findMany: async () =>
        opts.waiting.map((w) => ({ id: w.id, connectPendingPlatform: w.platform })),
      update: async (args: { where: { id: string } }) => {
        cleared.push(args.where.id);
        return {};
      },
    },
    connectedAccount: {
      findMany: async () => [],
    },
  };
  const svc = new ConnectService(prisma as never, {} as never, {} as never, {} as never);
  // reconcile() is covered by its own spec — here it stands in for the PFM
  // sync and reports what each customer's account list looks like after.
  (svc as unknown as { reconcile: (id: string) => Promise<unknown[]> }).reconcile = async (
    id: string,
  ) => (opts.connectsAfter[id] ?? []).map((platform) => ({ platform }));
  return { svc, cleared };
}

describe('reconcilePending — finishing connects the browser lost', () => {
  it('syncs each waiting customer, reports the gained platforms, clears the record', async () => {
    const { svc, cleared } = build({
      waiting: [{ id: 'c1', platform: 'instagram' }],
      connectsAfter: { c1: ['instagram'] },
    });
    const results = await svc.reconcilePending();
    assert.deepEqual(results, [{ customerId: 'c1', gained: ['instagram'] }]);
    assert.deepEqual(cleared, ['c1'], 'pending record cleared');
  });

  it('a customer whose auth never completed stays pending and gets no text', async () => {
    const { svc, cleared } = build({
      waiting: [{ id: 'c1', platform: 'instagram' }],
      connectsAfter: { c1: [] },
    });
    const results = await svc.reconcilePending();
    assert.deepEqual(results, [], 'nothing gained, nothing announced');
    assert.deepEqual(cleared, [], 'they may still come back — keep waiting');
  });

  it('multiple pending customers each get exactly their own platforms', async () => {
    const { svc } = build({
      waiting: [
        { id: 'c1', platform: 'instagram' },
        { id: 'c2', platform: 'tiktok' },
      ],
      connectsAfter: { c1: ['instagram'], c2: ['tiktok'] },
    });
    const results = await svc.reconcilePending();
    assert.deepEqual(
      results.map((r) => `${r.customerId}:${r.gained.join()}`),
      ['c1:instagram', 'c2:tiktok'],
      'no cross-customer attribution — each sync is keyed by external id',
    );
  });
});
