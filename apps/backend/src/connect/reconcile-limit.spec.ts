import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConnectService } from './connect.service';

/**
 * The platform cap has to be enforced where rows are CREATED (reconcile), not
 * only at startAuth — several auths started before any returns all read 0
 * connected and pass the pre-check, then land here together.
 */
function build(tier: string, alreadyConnected: string[], remote: string[]) {
  const upserts: string[] = [];
  const prisma = {
    customer: { findUnique: async () => ({ planTier: tier }) },
    connectedAccount: {
      findMany: async () => alreadyConnected.map((platform) => ({ platform })),
      upsert: async ({ create }: any) => {
        upserts.push(create.platform);
      },
    },
  };
  const pfm = {
    configured: true,
    listAccounts: async () => remote.map((platform, i) => ({ platform, id: `ref_${i}`, username: null })),
  };
  const svc = new ConnectService(
    prisma as never, {} as never, pfm as never, {} as never,
  );
  // listConnected is called at the end; stub it to avoid extra prisma surface.
  (svc as unknown as { listConnected: () => Promise<unknown[]> }).listConnected = async () => [];
  return { svc, upserts };
}

describe('reconcile enforces the platform cap', () => {
  it('admits only up to a Starter’s 2 platforms when PFM reports 5', async () => {
    const { svc, upserts } = build('starter', [], ['instagram', 'google_business', 'facebook', 'tiktok', 'threads']);
    await svc.reconcile('c1');
    assert.equal(upserts.length, 2, 'a Starter gets at most 2 platforms, not all 5');
  });

  it('never counts a reconnect of an already-connected platform against the cap', async () => {
    // Already at the 2-platform cap; a reconnect of one of them still goes
    // through, and no NEW platform sneaks in.
    const { svc, upserts } = build('starter', ['instagram', 'google_business'], ['instagram', 'google_business', 'facebook']);
    await svc.reconcile('c1');
    assert.ok(upserts.includes('instagram'));
    assert.ok(upserts.includes('google_business'));
    assert.ok(!upserts.includes('facebook'), 'a third platform is refused');
  });

  it('lets Pro connect all five', async () => {
    const { svc, upserts } = build('pro', [], ['instagram', 'google_business', 'facebook', 'tiktok', 'threads']);
    await svc.reconcile('c1');
    assert.equal(upserts.length, 5);
  });
});
