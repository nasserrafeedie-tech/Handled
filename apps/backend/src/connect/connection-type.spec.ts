import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';

import { ConnectService } from './connect.service';
import {
  PostForMeService,
  type AuthUrlRequest,
} from '../operator/publishing/post-for-me.service';

/**
 * The connection_type fix, both halves. Post for Me reads connection_type
 * from platform_data.<platform> — sent at the top level (our old shape) it
 * was silently ignored, which is why every Instagram connect came back as
 * Instagram Login no matter what we asked for. And now that the field
 * actually works, the default flips to Instagram Login on purpose: no
 * Facebook Page required, and the iOS api.instagram.com workaround only
 * applies to it. PFM_INSTAGRAM_CONNECTION=facebook switches it back.
 */

function buildConnect() {
  const authCalls: AuthUrlRequest[] = [];
  const prisma = {
    customer: {
      update: async () => ({}),
      // Pro tier so the platform-allowance gate lets every platform through.
      findUnique: async () => ({ planTier: 'pro' }),
    },
    connectedAccount: { findMany: async () => [] },
  };
  const pfm = {
    configured: true,
    createAuthUrl: async (req: AuthUrlRequest) => {
      authCalls.push(req);
      return { url: 'https://www.instagram.com/oauth/authorize?x=1' };
    },
  };
  const svc = new ConnectService(prisma as never, {} as never, pfm as never, {} as never);
  return { svc, authCalls };
}

describe('startAuth — which Instagram login flow gets requested', () => {
  afterEach(() => {
    delete process.env.PFM_INSTAGRAM_CONNECTION;
  });

  it('defaults Instagram to Instagram Login', async () => {
    const { svc, authCalls } = buildConnect();
    await svc.startAuth({ customerId: 'c1', platform: 'instagram' });
    assert.equal(authCalls.length, 1);
    assert.equal(authCalls[0].connectionType, 'instagram');
  });

  it('PFM_INSTAGRAM_CONNECTION=facebook switches to Facebook Login', async () => {
    process.env.PFM_INSTAGRAM_CONNECTION = 'facebook';
    const { svc, authCalls } = buildConnect();
    await svc.startAuth({ customerId: 'c1', platform: 'instagram' });
    assert.equal(authCalls[0].connectionType, 'facebook');
  });

  it('non-Instagram platforms send no connection type at all', async () => {
    const { svc, authCalls } = buildConnect();
    await svc.startAuth({ customerId: 'c1', platform: 'tiktok' });
    assert.equal(authCalls[0].connectionType, undefined);
  });
});

describe('createAuthUrl — connection_type rides in platform_data', () => {
  const realFetch = globalThis.fetch;
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'POST_FOR_ME_API_KEY');
  const realKey = process.env.POST_FOR_ME_API_KEY;

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (hadKey) process.env.POST_FOR_ME_API_KEY = realKey;
    else delete process.env.POST_FOR_ME_API_KEY;
  });

  function captureBody() {
    process.env.POST_FOR_ME_API_KEY = 'test-key';
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
      return {
        ok: true,
        json: async () => ({ url: 'https://example.test/auth' }),
      };
    }) as unknown as typeof fetch;
    return bodies;
  }

  it('nests connection_type under platform_data.<platform>, never the top level', async () => {
    const bodies = captureBody();
    const svc = new PostForMeService();
    await svc.createAuthUrl({
      platform: 'instagram',
      externalId: 'c1',
      connectionType: 'instagram',
    });
    assert.deepEqual(bodies[0].platform_data, {
      instagram: { connection_type: 'instagram' },
    });
    assert.equal('connection_type' in bodies[0], false, 'top-level field was ignored by PFM');
  });

  it('omits platform_data entirely when no connection type is set', async () => {
    const bodies = captureBody();
    const svc = new PostForMeService();
    await svc.createAuthUrl({ platform: 'tiktok', externalId: 'c1' });
    assert.equal('platform_data' in bodies[0], false);
    assert.equal('connection_type' in bodies[0], false);
  });
});
