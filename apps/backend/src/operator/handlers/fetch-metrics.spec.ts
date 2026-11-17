import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { FetchMetricsHandler } from './fetch-metrics.handler';

function harness(fetchResult: unknown, accounts = [{ platform: 'instagram', postForMeRef: 'spc_1' }]) {
  const asked: unknown[][] = [];
  const created: unknown[] = [];
  let deleted = 0;
  const prisma = {
    post: { findMany: async () => [{ id: 'p1', platform: 'instagram', externalPostId: 'sp_7' }] },
    connectedAccount: { findMany: async () => accounts },
    metric: {
      deleteMany: async () => { deleted++; },
      create: async (a: { data: object }) => { created.push(a.data); return { ...a.data, fetchedAt: new Date() }; },
    },
  };
  const pfm = { fetchMetrics: async (...a: unknown[]) => { asked.push(a); return fetchResult; } };
  const h = new FetchMetricsHandler(prisma as never, pfm as never);
  const task = { task_id: 't', customer_id: 'c1', type: 'FETCH_METRICS', payload: {} };
  return { run: () => h.handle(task as never), asked, created, deleted: () => deleted };
}

describe('FETCH_METRICS', () => {
  it('asks the feed of the account the post went out on', async () => {
    const t = harness({ impressions: 10, likes: 1, comments: 0, shares: 0, saves: 0 });
    await t.run();
    assert.deepEqual(t.asked[0], ['spc_1', 'sp_7']);
    assert.equal(t.created.length, 1);
  });

  it('keeps the last numbers when the post is not in the feed yet', async () => {
    const t = harness(null);
    await t.run();
    assert.equal(t.deleted(), 0);
    assert.equal(t.created.length, 0);
  });

  it('skips a post whose account is no longer linked', async () => {
    const t = harness({ impressions: 1, likes: 0, comments: 0, shares: 0, saves: 0 }, []);
    await t.run();
    assert.equal(t.asked.length, 0);
  });
});
