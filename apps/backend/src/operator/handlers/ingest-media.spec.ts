import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';

import { IngestMediaHandler } from './ingest-media.handler';

/**
 * The photo pipeline used to fake itself: it linked a storage key and told the
 * owner "added it to your post" without ever fetching the image, so the post
 * published empty. These pin the two things that must be true now — a real
 * fetch+store before any linkage, and an honest failure when the fetch dies.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function makeHandler() {
  const puts: Array<{ key: string; bytes: Buffer }> = [];
  const created: unknown[] = [];
  let postMediaRefs: string[] = [];
  const storage = {
    put: async (key: string, bytes: Buffer) => {
      puts.push({ key, bytes });
    },
  };
  const prisma = {
    mediaAsset: {
      create: async (args: { data: unknown }) => {
        created.push(args.data);
        return { id: 'asset_1' };
      },
      update: async () => ({}),
    },
    post: {
      findUnique: async () => ({ mediaRefs: postMediaRefs, platform: 'instagram' }),
      update: async (args: { data: { mediaRefs: string[] } }) => {
        postMediaRefs = args.data.mediaRefs;
        return {};
      },
    },
    shotListRequest: { update: async () => ({}) },
  };
  const handler = new IngestMediaHandler(prisma as never, storage as never);
  return { handler, puts, created, refs: () => postMediaRefs };
}

const task = (overrides: Record<string, unknown> = {}) =>
  ({
    task_id: 'task_1',
    customer_id: 'cus_1',
    type: 'INGEST_MEDIA',
    payload: {
      source_url: 'https://example.com/photo.jpg',
      content_type: 'image/jpeg',
      post_id: 'post_1',
      ...overrides,
    },
  }) as never;

describe('INGEST_MEDIA — real fetch and store', () => {
  it('fetches the bytes, stores them, and links the post', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    })) as never;

    const { handler, puts, created, refs } = makeHandler();
    const result = await handler.handle(task());

    assert.equal(puts.length, 1, 'must store the fetched bytes');
    assert.equal(puts[0].bytes.length, 4);
    assert.equal(created.length, 1, 'records the asset only after a real store');
    assert.deepEqual(refs(), [puts[0].key], 'post now references the stored key');
    assert.match(result.summary_for_owner ?? '', /added it|shot i was waiting/i);
  });

  it('does NOT record or claim success when the fetch fails', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 404 })) as never;

    const { handler, puts, created, refs } = makeHandler();
    const result = await handler.handle(task());

    assert.equal(puts.length, 0, 'nothing stored');
    assert.equal(created.length, 0, 'no phantom asset record');
    assert.deepEqual(refs(), [], 'post is left with no media');
    assert.match(
      result.summary_for_owner ?? '',
      /didn.t come through|send it once more/i,
      'the owner is told honestly, not thanked',
    );
  });

  it('rejects an empty body rather than storing zero bytes', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([]).buffer,
    })) as never;

    const { handler, puts, created } = makeHandler();
    await handler.handle(task());
    assert.equal(puts.length, 0);
    assert.equal(created.length, 0);
  });
});
