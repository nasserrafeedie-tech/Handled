import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';

import { assertAdmin } from './admin-auth';

const orig = process.env.ADMIN_TOKEN;
afterEach(() => {
  if (orig === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = orig;
});

describe('assertAdmin', () => {
  it('passes the exact token', () => {
    process.env.ADMIN_TOKEN = 'secret-token-123';
    assert.doesNotThrow(() => assertAdmin('secret-token-123'));
  });

  it('rejects a wrong token, a missing token, and a prefix', () => {
    process.env.ADMIN_TOKEN = 'secret-token-123';
    assert.throws(() => assertAdmin('wrong'));
    assert.throws(() => assertAdmin(undefined));
    assert.throws(() => assertAdmin('secret-token-12')); // length mismatch
    assert.throws(() => assertAdmin('secret-token-1234')); // longer
  });

  it('fails closed when no token is configured', () => {
    delete process.env.ADMIN_TOKEN;
    assert.throws(() => assertAdmin('anything'));
  });
});
