import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConnectService } from './connect.service';
import {
  conflictingAccountId,
  type RemoteAccount,
} from '../operator/publishing/post-for-me.service';

/**
 * Why linking an account "never worked": Post for Me registers each
 * Instagram once. Connect it under one Handled customer (a test signup, an
 * old phone number) and every later connect of that Instagram under a NEW
 * customer fails on their side — "External Id already exists for account
 * spc_…", isSuccess=false — and our callback, which ignored those params,
 * waited forever for an account that was never coming.
 */

type Row = Record<string, any>;

function build(opts: {
  me?: Row;
  others?: Row[];
  local?: Row[];
  listed?: RemoteAccount[];
  byId?: Record<string, RemoteAccount>;
}) {
  const customers: Row[] = [
    { id: 'me', planTier: 'growth', connectPendingAt: new Date(), connectPendingPlatform: 'instagram', ...opts.me },
    ...(opts.others ?? []),
  ];
  const local: Row[] = (opts.local ?? []).map((r) => ({ connectedAt: new Date(), ...r }));
  const patched: Array<{ id: string; externalId: string }> = [];
  const prisma = {
    customer: {
      findUnique: async ({ where }: any) => customers.find((c) => c.id === where.id) ?? null,
      findMany: async () => customers.filter((c) => c.connectPendingAt),
      update: async ({ where, data }: any) => Object.assign(customers.find((c) => c.id === where.id)!, data),
    },
    connectedAccount: {
      findMany: async ({ where }: any) =>
        local.filter((r) => r.customerId === where.customerId && r.revoked === false),
      findFirst: async ({ where }: any) => {
        const holder = customers.find((c) => c.id === where.customerId);
        return (
          local.find(
            (r) =>
              r.postForMeRef === where.postForMeRef &&
              r.customerId === where.customerId &&
              !r.revoked &&
              holder &&
              where.customer.status.in.includes(holder.status),
          ) ?? null
        );
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of local) {
          const notMine = where.NOT ? r.customerId !== where.NOT.customerId : true;
          const mine = where.customerId ? r.customerId === where.customerId : true;
          if (r.postForMeRef === where.postForMeRef && notMine && mine) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
      upsert: async ({ where, create, update }: any) => {
        const k = where.customerId_platform;
        const row = local.find((r) => r.customerId === k.customerId && r.platform === k.platform);
        if (row) return Object.assign(row, update);
        const fresh = { connectedAt: new Date(), ...create };
        local.push(fresh);
        return fresh;
      },
    },
  };
  const pfm = {
    configured: true,
    listAccounts: async () => opts.listed ?? [],
    getAccount: async (id: string) => opts.byId?.[id] ?? null,
    setExternalId: async (id: string, externalId: string) => {
      patched.push({ id, externalId });
    },
  };
  const crypto = { encrypt: (s: string) => `enc:${s}` };
  const svc = new ConnectService(prisma as never, crypto as never, pfm as never, {} as never, {} as never);
  return { svc, local, patched, customers };
}

const CONFLICT = 'External Id already exists for account spc_OLD123';
const ig = (over: Partial<RemoteAccount> = {}): RemoteAccount => ({
  id: 'spc_OLD123',
  platform: 'instagram',
  username: 'bakery',
  status: 'connected',
  externalId: 'deleted-test-customer',
  ...over,
});

describe('finishConnect — the account that was already linked somewhere', () => {
  it('reads the stuck account id out of Post for Me’s error', () => {
    assert.equal(conflictingAccountId(CONFLICT), 'spc_OLD123');
    assert.equal(conflictingAccountId('No valid accounts found'), null);
    assert.equal(conflictingAccountId(undefined), null);
  });

  it('a stale old link (holder gone) is moved to this customer, and the owner taps once more', async () => {
    const { svc, patched, local } = build({
      byId: { spc_OLD123: ig() },
      local: [{ customerId: 'deleted-test-customer', platform: 'instagram', postForMeRef: 'spc_OLD123', revoked: false }],
    });
    const out = await svc.finishConnect('me', { isSuccess: false, error: CONFLICT });
    assert.equal(out.outcome, 'retry');
    assert.deepEqual(patched, [{ id: 'spc_OLD123', externalId: 'me' }]);
    assert.equal(local[0].revoked, true, 'the old holder stops publishing to it');
  });

  it('an account a LIVE customer is using is never moved', async () => {
    const { svc, patched } = build({
      byId: { spc_OLD123: ig({ externalId: 'alice' }) },
      others: [{ id: 'alice', status: 'active' }],
      local: [{ customerId: 'alice', platform: 'instagram', postForMeRef: 'spc_OLD123', revoked: false }],
    });
    const out = await svc.finishConnect('me', { isSuccess: false, error: CONFLICT });
    assert.equal(out.outcome, 'taken');
    assert.deepEqual(patched, []);
  });

  it('a cancelled former customer’s old link counts as stale', async () => {
    const { svc, patched } = build({
      byId: { spc_OLD123: ig({ externalId: 'old-me' }) },
      others: [{ id: 'old-me', status: 'cancelled' }],
      local: [{ customerId: 'old-me', platform: 'instagram', postForMeRef: 'spc_OLD123', revoked: false }],
    });
    const out = await svc.finishConnect('me', { isSuccess: false, error: CONFLICT });
    assert.equal(out.outcome, 'retry');
    assert.equal(patched.length, 1);
  });

  it('nothing moves for a customer who did not just start a connect (the endpoint is public)', async () => {
    const { svc, patched } = build({
      me: { connectPendingAt: null },
      byId: { spc_OLD123: ig() },
    });
    const out = await svc.finishConnect('me', { isSuccess: false, error: CONFLICT });
    assert.deepEqual(patched, []);
    assert.equal(out.outcome, 'failed');
  });
});

describe('finishConnect — using what the redirect tells us', () => {
  it('an account named in accountIds is recorded even before the list endpoint shows it', async () => {
    const { svc, local } = build({
      listed: [],
      byId: { spc_NEW: ig({ id: 'spc_NEW', externalId: 'me' }) },
    });
    const out = await svc.finishConnect('me', { isSuccess: true, accountIds: ['spc_NEW'] });
    assert.equal(out.outcome, 'connected');
    assert.equal(local.length, 1);
    assert.equal(local[0].postForMeRef, 'spc_NEW');
  });

  it('an accountId registered to someone else is not adopted', async () => {
    const { svc, local } = build({
      byId: { spc_NEW: ig({ id: 'spc_NEW', externalId: 'someone-else' }) },
    });
    const out = await svc.finishConnect('me', { isSuccess: true, accountIds: ['spc_NEW'] });
    assert.equal(local.length, 0);
    assert.equal(out.outcome, 'waiting');
  });

  it('a refused connect says why, in owner words — not "still finishing up"', async () => {
    const { svc } = build({});
    const out = await svc.finishConnect('me', { isSuccess: false, error: 'User denied access' });
    assert.equal(out.outcome, 'failed');
    assert.match(out.reason!, /cancelled/);
  });

  it('a disconnected account is not imported, and one we hold is marked lapsed for the reminder', async () => {
    const old = new Date(Date.now() + 30 * 86400_000);
    const { svc, local } = build({
      listed: [ig({ id: 'spc_FB', platform: 'facebook', status: 'disconnected', externalId: 'me' })],
      local: [{ customerId: 'me', platform: 'facebook', postForMeRef: 'spc_FB', revoked: false, expiresAt: old }],
    });
    await svc.finishConnect('me', {});
    assert.ok(local[0].expiresAt <= new Date(), 'expiry pulled to now so the reconnect text goes out');
  });
});
