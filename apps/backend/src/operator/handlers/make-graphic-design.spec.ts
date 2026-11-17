import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { MakeGraphicHandler } from './make-graphic.handler';

function world(designer?: unknown) {
  const stored: Buffer[] = [];
  const prisma = {
    brandProfile: { findUnique: async () => ({ brandColors: [], businessType: 'bakery', logoRef: null, visualStyle: null }) },
    customer: { findUnique: async () => ({ businessName: 'Rosa' }) },
    post: { count: async () => 2, update: async () => ({}) },
    mediaAsset: { create: async () => ({}) },
  };
  const graphics = { renderCarousel: (specs: unknown[]) => specs.map(() => Buffer.from('template')) };
  const storage = { put: async (_k: string, b: Buffer) => void stored.push(b), get: async () => null };
  const h = new MakeGraphicHandler(prisma as never, graphics as never, storage as never, designer as never);
  const task = {
    task_id: 't', customer_id: 'c1', type: 'MAKE_GRAPHIC',
    payload: { slides: [{ kind: 'promo', headline: 'Pastries land at 7' }] },
  } as never;
  return { h, task, stored };
}

describe('MAKE_GRAPHIC designed graphic', () => {
  it('uses the design when there is one', async () => {
    const calls: Array<{ role: string }> = [];
    const w = world({
      live: () => true,
      design: async (r: { role: string }) => {
        calls.push(r);
        return { png: Buffer.from('designed'), drawnText: 'Pastries land at 7', svg: '', concept: '' };
      },
    });
    const r = await w.h.handle(w.task);
    assert.equal(r.status, 'done');
    assert.equal(calls[0].role, 'graphic');
    assert.equal(w.stored[0].toString(), 'designed');
  });

  it('keeps the template when the designer is off or gives up', async () => {
    const off = world({ live: () => false, design: async () => assert.fail('not called') });
    await off.h.handle(off.task);
    assert.equal(off.stored[0].toString(), 'template');
    const none = world();
    await none.h.handle(none.task);
    assert.equal(none.stored[0].toString(), 'template');
  });
});
