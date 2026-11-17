import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { SignupController, emailSignupOpen } from './signup.controller';

function world() {
  const created: unknown[] = [];
  const welcomed: string[] = [];
  const prisma = {
    customer: {
      findUnique: async () => null,
      create: async (args: { data: unknown }) => {
        created.push(args.data);
        return { id: 'c1' };
      },
    },
  };
  const concierge = { beginOnboarding: async (id: string) => void welcomed.push(id) };
  const ctl = new SignupController(prisma as never, concierge as never);
  return { ctl, created, welcomed };
}

const saved = { token: process.env.POSTMARK_SERVER_TOKEN, secret: process.env.EMAIL_INBOUND_SECRET };
afterEach(() => {
  for (const [k, v] of [['POSTMARK_SERVER_TOKEN', saved.token], ['EMAIL_INBOUND_SECRET', saved.secret]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('email sign-up waits for email to work', () => {
  it('is closed without Postmark sending and receiving', () => {
    assert.equal(emailSignupOpen({}), false);
    assert.equal(emailSignupOpen({ POSTMARK_SERVER_TOKEN: 'x' }), false);
    assert.equal(emailSignupOpen({ EMAIL_INBOUND_SECRET: 'y' }), false);
    assert.equal(emailSignupOpen({ POSTMARK_SERVER_TOKEN: ' ', EMAIL_INBOUND_SECRET: 'y' }), false);
    assert.equal(emailSignupOpen({ POSTMARK_SERVER_TOKEN: 'x', EMAIL_INBOUND_SECRET: 'y' }), true);
  });

  it('creates nobody and sends nothing while closed', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    delete process.env.EMAIL_INBOUND_SECRET;
    const w = world();
    const res = await w.ctl.emailSignup({ email: 'owner@shop.com' });
    assert.deepEqual(res, { ok: false, closed: true });
    assert.equal(w.created.length, 0);
    assert.equal(w.welcomed.length, 0);
  });

  it('signs them up once email is set up', async () => {
    process.env.POSTMARK_SERVER_TOKEN = 'x';
    process.env.EMAIL_INBOUND_SECRET = 'y';
    const w = world();
    const res = await w.ctl.emailSignup({ email: 'Owner@Shop.com' });
    assert.deepEqual(res, { ok: true });
    assert.equal(w.created.length, 1);
    assert.deepEqual(w.welcomed, ['c1']);
  });
});
