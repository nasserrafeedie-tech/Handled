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

describe('reconcile enforces the platform allowance', () => {
  it('gives a Starter GBP + one social, refusing the rest', async () => {
    const { svc, upserts } = build('starter', [], ['instagram', 'google_business', 'facebook', 'tiktok', 'threads']);
    await svc.reconcile('c1');
    assert.ok(upserts.includes('google_business'), 'GBP is always included');
    assert.ok(upserts.includes('instagram'), 'plus one social');
    assert.ok(!upserts.includes('facebook'), 'a second social is over the Starter cap');
    assert.ok(!upserts.includes('tiktok'), 'TikTok is Pro-only');
    assert.equal(upserts.length, 2);
  });

  it('never counts a reconnect, and GBP never consumes a social slot', async () => {
    const { svc, upserts } = build('starter', ['instagram', 'google_business'], ['instagram', 'google_business', 'facebook']);
    await svc.reconcile('c1');
    assert.ok(upserts.includes('instagram'));
    assert.ok(upserts.includes('google_business'));
    assert.ok(!upserts.includes('facebook'), 'a second social is still refused');
  });

  it('lets Pro connect GBP plus all four socials', async () => {
    const { svc, upserts } = build('pro', [], ['instagram', 'google_business', 'facebook', 'tiktok', 'threads']);
    await svc.reconcile('c1');
    assert.equal(upserts.length, 5, 'GBP + IG + FB + TikTok + Threads');
  });
});
