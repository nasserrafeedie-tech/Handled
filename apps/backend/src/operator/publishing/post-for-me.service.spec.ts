import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { PostForMeService } from './post-for-me.service';

/**
 * Every call shaped against Post for Me's published API (their Stainless SDKs,
 * generated from the OpenAPI spec): paths, verbs, and bodies with no fields
 * the API doesn't define.
 */
type Call = { url: string; method: string; body: any };

function stub(responder: (c: Call) => unknown = () => ({ id: 'sp_1' }), status = 200) {
  const calls: Call[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    const c = { url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(c);
    return new Response(JSON.stringify(responder(c)), { status });
  };
  return calls;
}

describe('PostForMeService', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.POST_FOR_ME_API_KEY = 'pfm_test';
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.POST_FOR_ME_API_KEY;
  });

  it('publish sends only CreateSocialPost fields (no top-level platform)', async () => {
    const calls = stub();
    await new PostForMeService().publish({
      platform: 'instagram',
      postForMeRef: 'spc_1',
      caption: 'Fresh loaves',
      hashtags: ['bread'],
      mediaUrls: ['https://cdn/x.jpg'],
      aiGenerated: true,
    });
    assert.equal(calls[0].url, 'https://api.postforme.dev/v1/social-posts');
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['caption', 'media', 'social_accounts']);
    assert.equal(calls[0].body.caption, 'Fresh loaves\n\n#bread');
  });

  it('TikTok AI disclosure goes in platform_configurations.tiktok.is_ai_generated', async () => {
    const calls = stub();
    await new PostForMeService().publish({
      platform: 'tiktok',
      postForMeRef: 'spc_2',
      caption: 'x',
      hashtags: [],
      mediaUrls: ['https://cdn/a.jpg'],
      aiGenerated: true,
    });
    assert.deepEqual(calls[0].body.platform_configurations, { tiktok: { is_ai_generated: true } });
    assert.equal(calls[0].body.is_ai_generated, undefined);
  });

  it('listAccounts filters by external_id, asks for a full page, and keeps status + owner', async () => {
    const calls = stub(() => ({
      data: [{ id: 'spc_1', platform: 'instagram', username: 'b', status: 'disconnected', external_id: 'c1' }],
    }));
    const rows = await new PostForMeService().listAccounts('c1');
    assert.match(calls[0].url, /\/v1\/social-accounts\?external_id=c1&limit=100$/);
    assert.deepEqual(rows[0], { id: 'spc_1', platform: 'instagram', username: 'b', status: 'disconnected', externalId: 'c1' });
  });

  it('re-homing an account is PATCH external_id; disconnect is POST …/disconnect (there is no DELETE)', async () => {
    const calls = stub(() => ({}));
    const pfm = new PostForMeService();
    await pfm.setExternalId('spc_9', 'cust-new');
    await pfm.disconnectAccount('spc_9');
    assert.equal(calls[0].method, 'PATCH');
    assert.match(calls[0].url, /\/v1\/social-accounts\/spc_9$/);
    assert.deepEqual(calls[0].body, { external_id: 'cust-new' });
    assert.equal(calls[1].method, 'POST');
    assert.match(calls[1].url, /\/v1\/social-accounts\/spc_9\/disconnect$/);
  });

  it('getAccount is null for an account Post for Me does not have', async () => {
    stub(() => ({ message: 'not found' }), 404);
    assert.equal(await new PostForMeService().getAccount('spc_gone'), null);
  });

  it('auth-url carries the customer as external_id and the login flow under platform_data', async () => {
    const calls = stub(() => ({ url: 'https://x', platform: 'instagram' }));
    await new PostForMeService().createAuthUrl({ platform: 'instagram', externalId: 'c1', connectionType: 'facebook' });
    assert.deepEqual(calls[0].body, {
      platform: 'instagram',
      external_id: 'c1',
      platform_data: { instagram: { connection_type: 'facebook' } },
    });
  });
});
