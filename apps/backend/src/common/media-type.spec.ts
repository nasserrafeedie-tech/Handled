import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { detectMedia } from './media-type';

/** A buffer starting with the given bytes, padded so length checks pass. */
const bytes = (...b: number[]): Buffer => Buffer.concat([Buffer.from(b), Buffer.alloc(32)]);

/** An ISO base-media header: 4 size bytes, "ftyp", then a 4-char brand. */
const ftyp = (brand: string): Buffer =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x20]),
    Buffer.from('ftyp', 'latin1'),
    Buffer.from(brand.padEnd(4, ' '), 'latin1'),
    Buffer.alloc(32),
  ]);

describe('detectMedia', () => {
  it('identifies JPEG', () => {
    const d = detectMedia(bytes(0xff, 0xd8, 0xff, 0xe0));
    assert.deepEqual(d, { kind: 'image', contentType: 'image/jpeg', ext: 'jpg' });
  });

  it('identifies PNG', () => {
    const d = detectMedia(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    assert.deepEqual(d, { kind: 'image', contentType: 'image/png', ext: 'png' });
  });

  it('identifies GIF', () => {
    assert.equal(detectMedia(Buffer.from('GIF89a' + '\0'.repeat(16)))?.ext, 'gif');
    assert.equal(detectMedia(Buffer.from('GIF87a' + '\0'.repeat(16)))?.ext, 'gif');
  });

  it('identifies WebP, not just the RIFF wrapper', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WEBP', 'latin1'),
      Buffer.alloc(16),
    ]);
    assert.equal(detectMedia(webp)?.contentType, 'image/webp');

    // A WAV is also RIFF. It must not pass as an image.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'latin1'),
      Buffer.alloc(16),
    ]);
    assert.equal(detectMedia(wav), null);
  });

  it('identifies what an iPhone actually produces', () => {
    // Photos default to HEIC and videos to QuickTime, so these are the two
    // most likely real uploads, not edge cases.
    assert.deepEqual(detectMedia(ftyp('heic')), {
      kind: 'image',
      contentType: 'image/heic',
      ext: 'heic',
    });
    assert.deepEqual(detectMedia(ftyp('qt')), {
      kind: 'video',
      contentType: 'video/quicktime',
      ext: 'mov',
    });
  });

  it('identifies MP4 variants', () => {
    for (const brand of ['isom', 'mp42', 'avc1', 'iso5']) {
      assert.equal(detectMedia(ftyp(brand))?.contentType, 'video/mp4', brand);
    }
  });

  it('accepts an uncatalogued ISO brand as video rather than rejecting a clip', () => {
    assert.equal(detectMedia(ftyp('xyzq'))?.kind, 'video');
  });

  it('rejects things that are not media at all', () => {
    assert.equal(detectMedia(Buffer.from('<html><body>hi</body></html>')), null);
    assert.equal(detectMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')), null);
    assert.equal(detectMedia(Buffer.from('%PDF-1.7\n' + '\0'.repeat(16))), null);
    assert.equal(detectMedia(Buffer.from('#!/bin/sh\necho hi\n')), null);
  });

  it('rejects empty and truncated input instead of guessing', () => {
    assert.equal(detectMedia(Buffer.alloc(0)), null);
    assert.equal(detectMedia(Buffer.from([0xff, 0xd8])), null);
  });

  it('ignores a declared type entirely — bytes decide', () => {
    // HTML that claims to be a PNG is the case that motivated this: it used to
    // be stored, and served, on the strength of the claim alone.
    const html = Buffer.from('<html>' + ' '.repeat(32));
    assert.equal(detectMedia(html), null);
  });
});
