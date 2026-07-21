import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { truncateCaption, validateForPlatform } from './platform-limits';

const codes = (v: { code: string }[]) => v.map((x) => x.code).sort();

describe('validateForPlatform', () => {
  it('passes a normal post', () => {
    const v = validateForPlatform('instagram', 'Fresh cortados all week.', [
      { width: 1080, height: 1080, bytes: 900_000 },
    ]);
    assert.deepEqual(v, []);
  });

  it('catches an over-long caption', () => {
    const v = validateForPlatform('instagram', 'x'.repeat(2201));
    assert.deepEqual(codes(v), ['caption_too_long']);
    assert.match(v[0].message, /2201 characters; instagram allows 2200/);
  });

  it('holds Threads to its much shorter limit', () => {
    // The same caption is fine on Instagram and too long on Threads, which is
    // the case most likely to slip through unnoticed.
    const caption = 'x'.repeat(600);
    assert.deepEqual(validateForPlatform('instagram', caption), []);
    assert.deepEqual(codes(validateForPlatform('threads', caption)), ['caption_too_long']);
  });

  describe('Instagram aspect ratio', () => {
    const check = (width: number, height: number) =>
      codes(validateForPlatform('instagram', 'hi', [{ width, height }]));

    it('accepts the shapes inside the feed window', () => {
      assert.deepEqual(check(1080, 1080), []); // square
      assert.deepEqual(check(1080, 1350), []); // 4:5 portrait, the lower bound
      assert.deepEqual(check(1080, 566), []); // ~1.91:1 landscape, upper bound
    });

    it('rejects shapes outside it', () => {
      assert.deepEqual(check(1080, 1920), ['aspect_out_of_range']); // 9:16 vertical
      assert.deepEqual(check(2400, 1000), ['aspect_out_of_range']); // 2.4:1 panorama
    });

    it('still accepts 16:9, which is inside the window', () => {
      // 16:9 is 1.78:1 and the ceiling is 1.91:1 — easy to assume otherwise.
      assert.deepEqual(check(1920, 1080), []);
    });

    it('flags the reel output shape, which is not a feed shape', () => {
      // reel.service.ts renders 1080x1920. Correct for Reels, rejected as a
      // feed post — worth catching rather than discovering at publish.
      const v = validateForPlatform('instagram', 'hi', [{ width: 1080, height: 1920 }]);
      assert.equal(v[0].code, 'aspect_out_of_range');
      assert.equal(v[0].autoFixable, false);
    });

    it('does not apply the window where the platform has none', () => {
      assert.deepEqual(codes(validateForPlatform('tiktok', 'hi', [{ width: 1080, height: 1920 }])), []);
    });
  });

  it('applies Facebook\'s stricter 4MB photo cap', () => {
    const big = [{ bytes: 6 * 1024 * 1024 }];
    assert.deepEqual(codes(validateForPlatform('facebook', 'hi', big)), ['image_too_large']);
    // Same file is fine on Instagram.
    assert.deepEqual(codes(validateForPlatform('instagram', 'hi', big)), []);
  });

  it('catches an oversized carousel', () => {
    const eleven = Array.from({ length: 11 }, () => ({ width: 1080, height: 1080 }));
    assert.deepEqual(codes(validateForPlatform('instagram', 'hi', eleven)), ['too_many_media']);
    // X allows only 4.
    assert.deepEqual(codes(validateForPlatform('x', 'hi', eleven.slice(0, 5))), ['too_many_media']);
  });

  it('reports every violation at once, not just the first', () => {
    const v = validateForPlatform('facebook', 'x'.repeat(70000), [
      { bytes: 9 * 1024 * 1024 },
    ]);
    assert.deepEqual(codes(v), ['caption_too_long', 'image_too_large']);
  });

  it('skips checks for facts it does not have', () => {
    // A caption drafted before the photo exists must not fail on the photo.
    assert.deepEqual(validateForPlatform('instagram', 'hi', [{}]), []);
    assert.deepEqual(validateForPlatform('instagram', 'hi'), []);
  });

  it('numbers each image so the owner knows which one', () => {
    const v = validateForPlatform('instagram', 'hi', [
      { width: 1080, height: 1080 },
      { width: 1080, height: 1920 },
    ]);
    assert.match(v[0].message, /^Image 2 /);
  });
});

describe('truncateCaption', () => {
  it('leaves a caption that already fits', () => {
    assert.equal(truncateCaption('short', 'instagram'), 'short');
  });

  it('trims to the limit', () => {
    const out = truncateCaption('x'.repeat(3000), 'instagram');
    assert.ok(out.length <= 2200, `got ${out.length}`);
  });

  it('breaks at a word boundary rather than mid-word', () => {
    const caption = 'word '.repeat(200); // 1000 chars
    const out = truncateCaption(caption, 'threads'); // 500 limit
    assert.ok(out.length <= 500);
    assert.ok(!/wor…$/.test(out), `broke mid-word: ${out.slice(-10)}`);
  });

  it('still trims text with no spaces in it', () => {
    const out = truncateCaption('x'.repeat(900), 'threads');
    assert.ok(out.length <= 500 && out.length > 400, `got ${out.length}`);
  });
});
