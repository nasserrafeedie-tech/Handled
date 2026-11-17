import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GraphicsService } from './graphics.service';
import { checkDesign, onBrand, type DesignInput } from './design-check';
import { parseSvg, SvgRejected } from './svg-guard';

const gfx = new GraphicsService();
const raster = (svg: string, w: number) => gfx.rasterize(svg, w);

const BRAND = ['#1F3A2E', '#D9A441'];
const base: DesignInput = {
  copy: { headline: 'Fresh fade Friday', body: 'Walk-ins welcome all day.', brandName: 'Sharp & Co' },
  palette: BRAND,
};

const svg = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1350" width="1080" height="1350">` +
  `<rect width="1080" height="1350" fill="#1F3A2E"/>${inner}</svg>`;

const GOOD = svg(
  `<text x="80" y="420" font-family="Anton" font-size="150" fill="#F4EFE6">FRESH FADE</text>` +
    `<text x="80" y="580" font-family="Anton" font-size="150" fill="#D9A441">FRIDAY</text>` +
    `<text x="80" y="700" font-family="Poppins" font-size="44" fill="#F4EFE6">Walk-ins welcome all day.</text>` +
    `<text x="80" y="1250" font-family="Poppins" font-weight="600" font-size="34" letter-spacing="4" fill="#F4EFE6">SHARP &amp; CO</text>`,
);

const reason = (src: string, input: DesignInput = base) => {
  const v = checkDesign(src, input, raster);
  return v.ok ? 'ok' : v.reason;
};

describe('reading a design', () => {
  it('refuses anything outside the poster subset', () => {
    const bad = [
      '<svg><script>alert(1)</script></svg>',
      '<svg><foreignObject/></svg>',
      '<svg><image href="https://evil.example/x.png"/></svg>',
      '<svg><image href="data:image/png;base64,AAAA"/></svg>',
      '<svg><rect onload="x()"/></svg>',
      '<svg><rect style="fill:red"/></svg>',
      '<svg><rect fill="url(https://x.example/#a)"/></svg>',
      '<!DOCTYPE svg><svg/>',
      '<svg><![CDATA[x]]></svg>',
      '<svg><rect></svg>',
      '<svg/><svg/>',
    ];
    for (const b of bad) assert.throws(() => parseSvg(b), SvgRejected, b);
  });

  it('reads a fenced reply and keeps comments out', () => {
    const n = parseSvg('```svg\n<svg><!-- a note --><rect width="1"/></svg>\n```');
    assert.equal(n.name, 'svg');
    assert.equal(n.children.length, 1);
  });
});

describe('a design has to keep the template promises', () => {
  it('passes a clean, on-brand design', () => {
    const v = checkDesign(GOOD, base, raster);
    assert.ok(v.ok, v.ok ? '' : v.reason);
    assert.match(v.svg, /^<svg xmlns=/);
    assert.equal(v.lines.length, 4);
  });

  it('turns back words that run off the canvas, with the measurement', () => {
    const r = reason(GOOD.replace('font-size="150" fill="#F4EFE6">FRESH FADE', 'font-size="260" fill="#F4EFE6">FRESH FADE'));
    assert.match(r, /FRESH FADE.*past the right margin/);
  });

  it('needs the headline as written', () => {
    assert.match(reason(GOOD.replace('FRIDAY', 'SATURDAY')), /headline/);
  });

  it("won't let a design invent a number", () => {
    const r = reason(GOOD.replace('SHARP &amp; CO', 'ONLY $15 TODAY'));
    assert.match(r, /\$15|15/);
  });

  it('keeps added words to a few', () => {
    const r = reason(GOOD.replace('SHARP &amp; CO', 'THE BEST CUTS IN TOWN FOR EVERY STYLE AND AGE'));
    assert.match(r, /adds \d+ words/);
  });

  it('wants the body whole or not at all', () => {
    assert.match(reason(GOOD.replace('Walk-ins welcome all day.', 'Walk-ins welcome.')), /body text/);
    assert.equal(reason(GOOD.replace(/<text x="80" y="700"[^]*?<\/text>/, '')), 'ok');
  });

  it('sticks to the brand colours and neutrals', () => {
    assert.match(reason(GOOD.replace('fill="#D9A441">FRIDAY', 'fill="#E0218A">FRIDAY')), /isn't one of the brand's/);
    assert.ok(onBrand([245, 239, 230], []), 'paper cream counts as a neutral');
    assert.ok(onBrand([60, 110, 85], [[31, 58, 46]]), 'a lighter version of the brand green');
  });

  it('only uses the bundled fonts', () => {
    assert.match(reason(GOOD.replace('font-family="Anton"', 'font-family="Comic Sans MS"')), /font/);
  });

  it('turns back text that is hard to read', () => {
    assert.match(reason(GOOD.replace('fill="#F4EFE6">FRESH FADE', 'fill="#2A4A3B">FRESH FADE')), /hard to read/);
  });

  it('turns back tiny text and overlapping lines', () => {
    assert.match(reason(GOOD.replace('font-size="34"', 'font-size="18"')), /smallest/);
    assert.match(reason(GOOD.replace('y="580"', 'y="440"')), /overlap/);
  });

  it('turns back words with a shape drawn over them', () => {
    const covered = GOOD.replace('</svg>', `<rect x="250" y="440" width="400" height="160" fill="#1F3A2E"/></svg>`);
    assert.match(reason(covered), /FRIDAY.*hidden under/);
  });

  it('reads tspan lines', () => {
    const v = checkDesign(
      svg(
        `<text font-family="Playfair Display" font-weight="800" font-size="120" fill="#F4EFE6">` +
          `<tspan x="80" y="400">Fresh fade</tspan><tspan x="80" dy="140">Friday</tspan></text>`,
      ),
      { ...base, copy: { headline: 'Fresh fade Friday' } },
      raster,
    );
    assert.ok(v.ok, v.ok ? '' : v.reason);
    assert.equal(v.lines.length, 2);
    assert.equal(Math.round(v.lines[1].bottom - v.lines[0].bottom), 140);
  });

  it('needs the canvas filled', () => {
    assert.match(reason(GOOD.replace('<rect width="1080" height="1350" fill="#1F3A2E"/>', '<rect width="1080" height="700" fill="#1F3A2E"/>')), /fill the whole canvas|hard to read/);
  });
});

describe("a design shows the owner's photo", () => {
  const photo = `data:image/png;base64,${gfx
    .renderSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#8a7a6a"/><circle cx="200" cy="150" r="90" fill="#222"/></svg>`, 400)
    .toString('base64')}`;
  const withPhoto: DesignInput = { ...base, photo: { dataUri: photo, read: { focusY: 0.3, underWords: 0.1, overTop: 0.8 } } };
  const framed = (img: string, words = 'y="1000"') =>
    svg(
      img +
        `<rect x="0" y="900" width="1080" height="450" fill="#1F3A2E"/>` +
        `<text x="80" ${words} font-family="Anton" font-size="120" fill="#F4EFE6">FRESH FADE FRIDAY</text>`,
    );
  const FULL = '<image href="{{PHOTO}}" x="0" y="0" width="1080" height="900" preserveAspectRatio="xMidYMid slice"/>';

  it('passes with the photo up top and the words below it', () => {
    assert.equal(reason(framed(FULL), withPhoto), 'ok');
  });

  it('needs the photo when there is one, and refuses one when there is not', () => {
    assert.match(reason(GOOD, withPhoto), /photo has to be in/);
    assert.match(reason(framed(FULL), base), /no photo/);
  });

  it('keeps words off the subject', () => {
    assert.match(reason(framed(FULL, 'y="330"'), withPhoto), /subject/);
  });

  it('turns back a photo that barely shows', () => {
    const tiny = '<image href="{{PHOTO}}" x="80" y="80" width="200" height="200"/>';
    assert.match(reason(framed(tiny), withPhoto), /only shows/);
  });

  it("won't stretch the photo", () => {
    assert.match(reason(framed(FULL.replace('xMidYMid slice', 'none')), withPhoto), /fill its frame/);
  });
});
