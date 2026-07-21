import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ReauthService } from './reauth.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-07-20T17:00:00Z');

interface Row {
  id: string;
  customerId: string;
  platform: string;
  expiresAt: Date | null;
  reauthAskedAt: Date | null;
}

/**
 * A stand-in for Prisma that applies the same filter the real query would, so
 * the test covers which rows the sweep selects rather than just what it does
 * with them.
 */
function fakePrisma(rows: Row[]) {
  const updates: { id: string; reauthAskedAt: Date }[] = [];
  return {
    updates,
    connectedAccount: {
      findMany: async ({ where }: any) => {
        const horizon = where.expiresAt.lte as Date;
        const reaskBefore = (where.OR[1].reauthAskedAt.lt as Date) ?? null;
        return rows
          .filter((r) => r.expiresAt !== null && r.expiresAt <= horizon)
          .filter(
            (r) => r.reauthAskedAt === null || r.reauthAskedAt < reaskBefore,
          )
          .map((r) => ({ ...r, customer: { id: r.customerId, businessName: 'Test' } }));
      },
      update: async ({ where, data }: any) => {
        updates.push({ id: where.id, reauthAskedAt: data.reauthAskedAt });
      },
    },
  };
}

function fakeConcierge() {
  const sent: { customerId: string; body: string }[] = [];
  return {
    sent,
    notify: async (customerId: string, body: string) => {
      sent.push({ customerId, body });
    },
  };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: 'a1',
  customerId: 'c1',
  platform: 'instagram',
  expiresAt: new Date(NOW.getTime() + 3 * DAY),
  reauthAskedAt: null,
  ...over,
});

const build = (rows: Row[]) => {
  const prisma = fakePrisma(rows);
  const concierge = fakeConcierge();
  const svc = new ReauthService(prisma as any, concierge as any);
  return { svc, prisma, concierge };
};

describe('ReauthService.sweep', () => {
  it('asks when a connection lapses inside the warning window', async () => {
    const { svc, concierge } = build([row({ expiresAt: new Date(NOW.getTime() + 3 * DAY) })]);
    const { asked } = await svc.sweep(NOW);
    assert.equal(asked, 1);
    assert.equal(concierge.sent.length, 1);
    assert.match(concierge.sent[0].body, /Instagram needs reconnecting/);
  });

  it('stays quiet when expiry is still far off', async () => {
    const { svc, concierge } = build([row({ expiresAt: new Date(NOW.getTime() + 30 * DAY) })]);
    const { asked } = await svc.sweep(NOW);
    assert.equal(asked, 0);
    assert.equal(concierge.sent.length, 0);
  });

  it('stays quiet when there is no known expiry', async () => {
    const { svc, concierge } = build([row({ expiresAt: null })]);
    assert.equal((await svc.sweep(NOW)).asked, 0);
    assert.equal(concierge.sent.length, 0);
  });

  it('changes the wording once it has actually expired', async () => {
    const { svc, concierge } = build([row({ expiresAt: new Date(NOW.getTime() - 1 * DAY) })]);
    await svc.sweep(NOW);
    const body = concierge.sent[0].body;
    assert.match(body, /has disconnected/);
    // The owner needs to know their queued work is not lost.
    assert.match(body, /queued up and safe/);
  });

  it('does not nag: silent if asked recently', async () => {
    const { svc, concierge } = build([
      row({ reauthAskedAt: new Date(NOW.getTime() - 1 * DAY) }),
    ]);
    assert.equal((await svc.sweep(NOW)).asked, 0);
    assert.equal(concierge.sent.length, 0);
  });

  it('asks again once the re-ask window has passed', async () => {
    const { svc, concierge } = build([
      row({ reauthAskedAt: new Date(NOW.getTime() - 5 * DAY) }),
    ]);
    assert.equal((await svc.sweep(NOW)).asked, 1);
    assert.equal(concierge.sent.length, 1);
  });

  it('records when it asked, so the next sweep stays quiet', async () => {
    const { svc, prisma } = build([row()]);
    await svc.sweep(NOW);
    assert.equal(prisma.updates.length, 1);
    assert.equal(prisma.updates[0].reauthAskedAt.getTime(), NOW.getTime());
  });

  it('keeps going when one owner fails', async () => {
    const rows = [row({ id: 'a1', customerId: 'c1' }), row({ id: 'a2', customerId: 'c2' })];
    const prisma = fakePrisma(rows);
    const concierge = fakeConcierge();
    const original = concierge.notify;
    concierge.notify = async (customerId: string, body: string) => {
      if (customerId === 'c1') throw new Error('unreachable');
      return original(customerId, body);
    };
    const svc = new ReauthService(prisma as any, concierge as any);
    const { asked } = await svc.sweep(NOW);
    // The second owner is still told, and the failed one is not marked asked.
    assert.equal(asked, 1);
    assert.equal(concierge.sent[0].customerId, 'c2');
    assert.deepEqual(prisma.updates.map((u) => u.id), ['a2']);
  });

  it('uses the name owners know the platform by', async () => {
    const { svc, concierge } = build([row({ platform: 'tiktok' })]);
    await svc.sweep(NOW);
    assert.match(concierge.sent[0].body, /TikTok/);
  });

  it('includes a reconnect link pointing at the right customer', async () => {
    const { svc, concierge } = build([row({ customerId: 'cust-42' })]);
    await svc.sweep(NOW);
    assert.match(concierge.sent[0].body, /\/connect\?customer=cust-42/);
  });
});
