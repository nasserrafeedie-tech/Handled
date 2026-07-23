import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AdminController } from './admin.controller';

/**
 * The hand-run signup path. These tests exist because the failure mode this
 * endpoint prevents is silent: a customer left on the "starter" default gets no
 * carousels, no generated images and no reels, with nothing logged and nothing
 * to debug. The tier has to survive, and the phone has to normalize, or the
 * founder-run signup quietly produces a customer who never sees the product.
 */

const TOKEN = 'test-admin-token';

function makeController(store: { rows: Record<string, any> }) {
  const prisma = {
    customer: {
      findUnique: async ({ where }: any) => store.rows[where.phone] ?? null,
      upsert: async ({ where, create, update }: any) => {
        const existing = store.rows[where.phone];
        const row = existing
          ? { ...existing, ...update }
          : {
              id: 'cus_generated',
              planTier: 'starter',
              status: 'active',
              businessName: null,
              ...create,
            };
        store.rows[where.phone] = row;
        return row;
      },
    },
  };
  return new AdminController(prisma as any, {} as any, {} as any, {} as any);
}

describe('POST /admin/customer', () => {
  let store: { rows: Record<string, any> };
  let ctrl: AdminController;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = TOKEN;
    store = { rows: {} };
    ctrl = makeController(store);
  });

  it('fails closed on a wrong token', async () => {
    await assert.rejects(() =>
      ctrl.upsertCustomer('nope', { phone: '4244098341' }),
    );
  });

  it('fails closed when no token is configured at all', async () => {
    delete process.env.ADMIN_TOKEN;
    await assert.rejects(() =>
      ctrl.upsertCustomer(undefined, { phone: '4244098341' }),
    );
  });

  it('normalizes the phone so Twilio finds the same record', async () => {
    // The whole product keys on phone. A customer created as "(424) 409-8341"
    // and an inbound text from "+14244098341" must be one customer, not two.
    const res: any = await ctrl.upsertCustomer(TOKEN, {
      phone: '(424) 409-8341',
      businessName: 'Test Dental',
      planTier: 'growth',
    });
    assert.equal(res.customer.phone, '+14244098341');
    assert.equal(res.created, true);
  });

  it('actually sets the tier — the whole reason this endpoint exists', async () => {
    const res: any = await ctrl.upsertCustomer(TOKEN, {
      phone: '4244098341',
      planTier: 'growth',
    });
    assert.equal(res.customer.planTier, 'growth');
  });

  it('says out loud when a tier means no carousels', async () => {
    const res: any = await ctrl.upsertCustomer(TOKEN, {
      phone: '4244098341',
      planTier: 'starter',
    });
    assert.match(res.note, /NO carousels/);
  });

  it('confirms when a tier does include carousels', async () => {
    const res: any = await ctrl.upsertCustomer(TOKEN, {
      phone: '4244098341',
      planTier: 'pro',
    });
    assert.match(res.note, /ON/);
  });

  it('rejects a tier that is not sellable', async () => {
    const res: any = await ctrl.upsertCustomer(TOKEN, {
      phone: '4244098341',
      planTier: 'premium',
    });
    assert.equal(res.error, 'bad_request');
  });

  it('rejects a phone it cannot text instead of storing junk', async () => {
    const res: any = await ctrl.upsertCustomer(TOKEN, { phone: 'not a phone' });
    assert.equal(res.error, 'bad_phone');
  });

  it('updates an existing customer rather than duplicating them', async () => {
    await ctrl.upsertCustomer(TOKEN, {
      phone: '4244098341',
      planTier: 'starter',
    });
    const res: any = await ctrl.upsertCustomer(TOKEN, {
      phone: '+14244098341',
      planTier: 'growth',
    });
    assert.equal(res.created, false);
    assert.equal(res.customer.planTier, 'growth');
    assert.equal(Object.keys(store.rows).length, 1);
  });

  it('gives back a connect link pointing at the customer', async () => {
    const res: any = await ctrl.upsertCustomer(TOKEN, { phone: '4244098341' });
    assert.match(res.connectLink, /\/connect\?c=cus_generated$/);
  });
});

/**
 * Off-channel approval. The gate this opens is the product's central promise —
 * nothing reaches a customer's Instagram without a human saying yes — so the
 * tests here are about the trail, not the mechanics.
 */
describe('POST /admin/approve', () => {
  const TOKEN2 = 'test-admin-token';
  let post: any;
  let ctrl: AdminController;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = TOKEN2;
    post = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', approvalState: 'awaiting_owner', approvalNote: null };
    const prisma = {
      post: {
        findUnique: async ({ where }: any) => (where.id === post.id ? post : null),
        update: async ({ data }: any) => Object.assign(post, data),
      },
    };
    ctrl = new AdminController(prisma as any, {} as any, {} as any, {} as any);
  });

  it('fails closed on a wrong token', async () => {
    await assert.rejects(() => ctrl.approve('nope', { postId: post.id, approvedBy: 'x' }));
  });

  it('refuses an approval with nobody attached to it', async () => {
    const res: any = await ctrl.approve(TOKEN2, { postId: post.id });
    assert.equal(res.error, 'bad_request');
    assert.equal(post.approvalState, 'awaiting_owner', 'must not approve without a name');
  });

  it('records who approved it, on the post itself', async () => {
    const res: any = await ctrl.approve(TOKEN2, {
      postId: post.id,
      approvedBy: 'Dr. Rafeedie, by text 22 Jul',
    });
    assert.equal(res.changed, true);
    assert.equal(post.approvalState, 'approved');
    assert.match(post.approvalNote, /Dr\. Rafeedie/);
  });

  it('does not publish — approving and sending stay separate acts', async () => {
    // The controller is built with an empty TaskBus; if approve() tried to
    // publish, this would throw rather than return cleanly.
    const res: any = await ctrl.approve(TOKEN2, { postId: post.id, approvedBy: 'owner, in person' });
    assert.equal(res.changed, true);
    assert.match(res.next, /publish-now/);
  });

  it('is idempotent — re-approving changes nothing', async () => {
    await ctrl.approve(TOKEN2, { postId: post.id, approvedBy: 'owner, in person' });
    const res: any = await ctrl.approve(TOKEN2, { postId: post.id, approvedBy: 'someone else' });
    assert.equal(res.changed, false);
    assert.match(post.approvalNote, /owner, in person/, 'first approver must not be overwritten');
  });
});
