import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { UploadsController } from './uploads.controller';

/** A real extractable logo: a saturated mark on white. */
function logoBytes(fill = '#8C2F39', size = 240): Buffer {
  const r = Math.round(size * 0.35);
  return Buffer.from(
    new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#fff"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${fill}"/></svg>`,
    )
      .render()
      .asPng(),
  );
}

function makeController(existingColors: string[]) {
  const updates: any[] = [];
  const notes: string[] = [];
  const prisma = {
    brandProfile: {
      findUnique: async () => ({ brandColors: existingColors }),
      update: async ({ data }: any) => {
        updates.push(data);
        return data;
      },
    },
  };
  const storage = { put: async () => {} };
  const concierge = { notify: async (_id: string, m: string) => notes.push(m) };
  const ctrl = new UploadsController(
    prisma as any,
    {} as any,
    concierge as any,
    storage as any,
  );
  return { ctrl, updates, notes };
}

const file = (buffer: Buffer) => ({
  originalname: 'logo.png',
  mimetype: 'image/png',
  size: buffer.length,
  buffer,
});

describe('logo upload', () => {
  it('stores the logo and takes its colors when we have none', async () => {
    const { ctrl, updates } = makeController([]);
    const res = await (ctrl as any).handleLogo('cus_1', file(logoBytes()));
    assert.deepEqual(res, { stored: 1, kinds: ['logo'] });
    assert.match(updates[0].logoRef, /logo\.png$/);
    assert.ok(updates[0].brandColors?.length, 'should extract and set colors');
  });

  it('does NOT overwrite colors the owner already gave in words', async () => {
    const { ctrl, updates } = makeController(['teal', 'gold']);
    await (ctrl as any).handleLogo('cus_1', file(logoBytes()));
    assert.ok(updates[0].logoRef, 'logo still stored');
    assert.equal(
      updates[0].brandColors,
      undefined,
      'must not clobber the owner’s stated colors',
    );
  });

  it('takes colors but does NOT set logoRef for a low-res logo', async () => {
    // Colours survive any resolution; a tiny logo would look blurry stamped, so
    // it is not composited — logoRef stays unset, the text footer is kept.
    const { ctrl, updates, notes } = makeController([]);
    await (ctrl as any).handleLogo('cus_1', file(logoBytes('#8C2F39', 90)));
    assert.equal(updates[0].logoRef, undefined, 'low-res logo must not be composited');
    assert.ok(updates[0].brandColors?.length, 'but its colours are still taken');
    assert.match(notes.join(' '), /low-res|larger version/i, 'owner is told');
  });

  it('rejects a file that is not an image', async () => {
    const { ctrl } = makeController([]);
    await assert.rejects(() =>
      (ctrl as any).handleLogo('cus_1', file(Buffer.from('not an image'))),
    );
  });

  it('stores a monochrome logo but takes no color from it', async () => {
    // A black-and-white logo extracts nothing — store it, keep colors empty,
    // and (per the message) invite the owner to name their colors.
    const { ctrl, updates } = makeController([]);
    await (ctrl as any).handleLogo('cus_1', file(logoBytes('#111111')));
    assert.ok(updates[0].logoRef, 'logo stored');
    assert.equal(updates[0].brandColors, undefined, 'no color from a mono logo');
  });
});
