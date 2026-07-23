import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DevSmsController } from './dev-sms.controller';

/**
 * Who is allowed to speak as a customer.
 *
 * This endpoint takes a phone number and drives the concierge as if that person
 * had texted in — which includes replying YES to approve their posts. Opened in
 * production without a token, it is a way for a stranger to publish to a
 * customer's Instagram: precisely what the approval gate exists to prevent.
 * ALLOW_DEV_SMS alone must never be enough.
 */
describe('POST /dev/sms — authorization', () => {
  const saved = { ...process.env };
  let ctrl: DevSmsController;
  let handled: string[];

  beforeEach(() => {
    handled = [];
    const concierge = {
      handleInbound: async ({ from }: any) => {
        handled.push(from);
      },
    };
    const prisma = { customer: { findUnique: async () => null } };
    ctrl = new DevSmsController(concierge as any, prisma as any);
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('is wide open in development — the simulator must stay frictionless', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ADMIN_TOKEN;
    await ctrl.simulate(undefined, { from: '+14245550199', body: 'hi' });
    assert.equal(handled.length, 1);
  });

  it('does not exist in production unless explicitly opened', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SMS = '0';
    process.env.ADMIN_TOKEN = 'right';
    await assert.rejects(() =>
      ctrl.simulate('right', { from: '+14245550199', body: 'hi' }),
    );
    assert.equal(handled.length, 0);
  });

  it('REFUSES an unauthenticated caller even when opened in production', async () => {
    // The regression that matters: flipping ALLOW_DEV_SMS on to hand-run a
    // customer must not also let anyone else speak as that customer.
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SMS = '1';
    process.env.ADMIN_TOKEN = 'right';
    await assert.rejects(() =>
      ctrl.simulate(undefined, { from: '+14245550199', body: 'YES' }),
    );
    assert.equal(handled.length, 0, 'must not reach the concierge');
  });

  it('refuses a wrong token in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SMS = '1';
    process.env.ADMIN_TOKEN = 'right';
    await assert.rejects(() =>
      ctrl.simulate('wrong', { from: '+14245550199', body: 'YES' }),
    );
    assert.equal(handled.length, 0);
  });

  it('fails closed when opened but no token is configured at all', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SMS = '1';
    delete process.env.ADMIN_TOKEN;
    await assert.rejects(() =>
      ctrl.simulate(undefined, { from: '+14245550199', body: 'YES' }),
    );
    assert.equal(handled.length, 0);
  });

  it('allows the operator through with the right token', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_SMS = '1';
    process.env.ADMIN_TOKEN = 'right';
    await ctrl.simulate('right', { from: '+14245550199', body: 'hi' });
    assert.equal(handled.length, 1);
  });
});
