import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { extractBrandColors } from './logo-colors';

/** Render a tiny SVG "logo" to PNG bytes so we can extract from known inputs. */
function logo(svgInner: string, bg = '#ffffff'): Buffer {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><rect width="240" height="240" fill="${bg}"/>${svgInner}</svg>`;
  return Buffer.from(new Resvg(svg).render().asPng());
}

/** How close two hexes are, 0 = identical. */
function dist(a: string, b: string): number {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}

describe('extractBrandColors', () => {
  it('finds the brand color of a mark on a WHITE field (not white)', async () => {
    const png = logo('<circle cx="120" cy="120" r="80" fill="#8C2F39"/>');
    const { primary } = await extractBrandColors(png);
    assert.ok(primary, 'should find a color');
    assert.ok(dist(primary!, '#8c2f39') < 30, `got ${primary}, expected ~#8C2F39`);
  });

  it('finds the brand color on a BLACK field too', async () => {
    const png = logo('<circle cx="120" cy="120" r="80" fill="#2AA198"/>', '#000000');
    const { primary } = await extractBrandColors(png);
    assert.ok(primary && dist(primary, '#2aa198') < 40, `got ${primary}`);
  });

  it('returns a primary AND secondary for a two-tone logo', async () => {
    const png = logo(
      '<rect x="20" y="70" width="100" height="100" fill="#1E3A5F"/>' +
        '<rect x="120" y="70" width="100" height="100" fill="#C79A45"/>',
    );
    const { primary, secondary } = await extractBrandColors(png);
    assert.ok(primary && secondary, `expected two colors, got ${primary}/${secondary}`);
    // The two should be genuinely different hues, not two edges of one.
    assert.ok(dist(primary!, secondary!) > 60, 'primary and secondary must differ');
  });

  it('returns NOTHING for a black-and-white logo — no invented color', async () => {
    const png = logo('<path d="M60 60 H180 V180 H60 Z" fill="#111111"/>');
    const out = await extractBrandColors(png);
    assert.equal(out.primary, undefined, 'a monochrome logo must yield no color');
  });

  it('returns nothing for an all-grey logo', async () => {
    const png = logo('<circle cx="120" cy="120" r="80" fill="#888888"/>');
    assert.equal((await extractBrandColors(png)).primary, undefined);
  });

  it('reports the logo\'s real dimensions', async () => {
    const png = logo('<circle cx="120" cy="120" r="80" fill="#8C2F39"/>'); // 240x240
    const out = await extractBrandColors(png);
    assert.equal(out.width, 240);
    assert.equal(out.height, 240);
  });

  it('does not throw on undecodable bytes — returns nothing', async () => {
    const out = await extractBrandColors(Buffer.from('not an image at all'));
    assert.deepEqual(out, {});
  });
});
