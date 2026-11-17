import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  CANVAS,
  CANVAS_H,
  leadNumber,
  photoLayoutFor,
  renderSlideSvg,
  textLayoutFor,
  type BrandStyle,
  type BrandTheme,
  type SlideKind,
  type TextLayout,
} from './slide-templates';
import { capHeight, textWidth } from './text-metrics';

/**
 * The owner's complaint was that every post looked the same. These tests hold
 * the two promises that answer it — neighbouring posts never share a layout,
 * and no layout ever lets a word run off the frame.
 */

const theme = (style: BrandStyle): BrandTheme => ({
  primary: '#141414',
  secondary: '#C9A227',
  brandName: 'Sharp & Co',
  style,
});

/** First number in an attribute string, or `dflt`. */
const attr = (tag: string, name: string, dflt?: number): number | undefined => {
  const m = new RegExp(`\\s${name}="([-\\d.]+)"`).exec(tag);
  return m ? Number(m[1]) : dflt;
};

const unescape = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#8220;/g, '“');

/**
 * Every run of text in the SVG with its measured horizontal extent. Reads the
 * same attributes the rasteriser does (x, anchor, family, size, weight,
 * letter-spacing) and measures with the bundled fonts.
 */
function textRuns(svg: string): { text: string; left: number; right: number; y: number; size: number }[] {
  const runs: { text: string; left: number; right: number; y: number; size: number }[] = [];
  for (const m of svg.matchAll(/<text([^>]*)>([\s\S]*?)<\/text>/g)) {
    const tag = m[1];
    const family = /font-family="([^"]+)"/.exec(tag)?.[1] ?? 'Poppins';
    const size = attr(tag, 'font-size', 16)!;
    const weight = attr(tag, 'font-weight', 400)!;
    const tracking = attr(tag, 'letter-spacing', 0)!;
    const middle = /text-anchor="middle"/.test(tag);
    const end = /text-anchor="end"/.test(tag);
    const spans = [...m[2].matchAll(/<tspan([^>]*)>([\s\S]*?)<\/tspan>/g)].map((s) => ({
      x: attr(s[1], 'x')!,
      y: attr(s[1], 'y')!,
      text: unescape(s[2]),
    }));
    const pieces = spans.length ? spans : [{ x: attr(tag, 'x', 0)!, y: attr(tag, 'y', 0)!, text: unescape(m[2]) }];
    for (const p of pieces) {
      if (!p.text.trim()) continue;
      const w = textWidth(p.text, family, size, weight, tracking) ?? 0;
      const left = middle ? p.x - w / 2 : end ? p.x - w : p.x;
      runs.push({ text: p.text, left, right: left + w, y: p.y, size });
    }
  }
  return runs;
}

const SHORT = 'Fresh fade Friday';
const LONG = 'Our most requested weekend appointment slots are now open for every single client';
const WORD = 'Unbelievablyunforgettable';
const NUM = 'Kids cuts are $18';

describe('neighbouring posts never share a text layout', () => {
  for (const headline of [SHORT, NUM]) {
    it(`over 200 consecutive posts (cover: "${headline}")`, () => {
      for (let seed = 0; seed < 200; seed++) {
        assert.notEqual(
          textLayoutFor(seed, headline),
          textLayoutFor(seed + 1, headline),
          `seeds ${seed} and ${seed + 1} matched`,
        );
      }
    });
  }

  it('uses all five layouts across a feed, and the numeral one only with a number', () => {
    const withNum = new Set<TextLayout>();
    const without = new Set<TextLayout>();
    for (let seed = 0; seed < 20; seed++) {
      withNum.add(textLayoutFor(seed, NUM));
      without.add(textLayoutFor(seed, SHORT));
    }
    assert.equal(withNum.size, 5);
    assert.equal(without.has('numeral'), false);
    assert.equal(without.size, 4);
  });

  it('photo posts in a row never share a cover treatment', () => {
    for (let seed = 0; seed < 100; seed++) {
      assert.notEqual(photoLayoutFor(seed, 0), photoLayoutFor(seed + 1, 0));
      assert.notEqual(photoLayoutFor(seed, 1), photoLayoutFor(seed + 1, 1));
    }
  });
});

describe('leadNumber finds the number a numeral layout can show', () => {
  it('reads prices, counts and percentages, and keeps the words around them', () => {
    assert.deepEqual(leadNumber('Kids cuts are $18'), { before: 'Kids cuts are', num: '$18', after: '' });
    assert.deepEqual(leadNumber('3 ways to order oat milk'), { before: '', num: '3', after: 'ways to order oat milk' });
    assert.deepEqual(leadNumber('2 minutes, twice a day'), { before: '', num: '2', after: 'minutes, twice a day' });
    assert.equal(leadNumber('Save 20% this week')?.num, '20%');
  });

  it('ignores headlines with no number and numbers too long to be a design', () => {
    assert.equal(leadNumber('Fresh fade Friday'), null);
    assert.equal(leadNumber('Call 5551234'), null);
    assert.equal(leadNumber('Open since 2026'), null);
  });
});

describe('no layout lets text leave the frame', () => {
  const layouts: TextLayout[] = ['stack', 'poster', 'highlight', 'split', 'numeral'];
  const styles: BrandStyle[] = ['modern', 'editorial', 'bold', 'luxe'];
  const kinds: SlideKind[] = ['title', 'body', 'promo', 'cta', 'quote'];

  for (const tl of layouts) {
    for (const style of styles) {
      it(`${tl} / ${style}`, () => {
        for (const kind of kinds) {
          for (const headline of [SHORT, LONG, WORD, NUM]) {
            const svg = renderSlideSvg(
              { kind, headline, body: LONG, seed: 3, variant: kind === 'body' ? 2 : 0, total: 5, textLayout: tl },
              theme(style),
            );
            for (const r of textRuns(svg)) {
              const where = `${tl}/${style}/${kind} "${headline}" → "${r.text}"`;
              assert.ok(r.left >= 0 && r.right <= CANVAS, `${where} spans ${r.left.toFixed(0)}..${r.right.toFixed(0)}`);
              assert.ok(r.y > 0 && r.y < CANVAS_H, `${where} at y=${r.y}`);
            }
          }
        }
      });
    }
  }

  it('a photo slide in every photo layout keeps its words inside the frame', () => {
    const photo = 'data:image/png;base64,iVBORw0KGgo=';
    for (const photoLayout of ['full', 'card', 'band', 'frame', 'top'] as const) {
      for (const headline of [SHORT, LONG, WORD]) {
        const svg = renderSlideSvg(
          { kind: 'title', headline, body: LONG, photo, photoLayout, seed: 0 },
          theme('editorial'),
        );
        for (const r of textRuns(svg)) {
          assert.ok(r.left >= 0 && r.right <= CANVAS, `${photoLayout} "${r.text}" spans ${r.left}..${r.right}`);
        }
      }
    }
  });
});

describe('the layouts actually look different', () => {
  it('each layout draws its signature element', () => {
    const r = (tl: TextLayout, headline = SHORT) =>
      renderSlideSvg({ kind: 'title', headline, body: 'Walk-ins welcome.', seed: 0, textLayout: tl }, theme('modern'));
    // highlight: a colour bar per headline line.
    assert.ok((r('highlight').match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="\d+" rx="\d+" fill="#C9A227"\/>/g) ?? []).length >= 1);
    // split: a full-width block across the top.
    assert.match(r('split'), /<rect width="1080" height="\d+" fill="/);
    // numeral: the number set on its own, huge.
    const num = r('numeral', NUM);
    assert.match(num, />\$18<\/text>/);
    assert.ok(Number(/font-size="(\d+)"[^>]*>\$18</.exec(num)![1]) >= 250);
    // poster: the headline is far bigger than the stack's.
    const size = (svg: string) => Math.max(...[...svg.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1])));
    assert.ok(size(r('poster')) > size(r('stack')));
  });

  it('a numeral cover with no number to show falls back instead of drawing nothing', () => {
    const svg = renderSlideSvg({ kind: 'title', headline: SHORT, seed: 0, textLayout: 'numeral' }, theme('bold'));
    assert.match(svg, /FRESH FADE/);
  });

  it('quote slides take a look from the post: centred, side or on the accent', () => {
    const q = (tl: TextLayout) =>
      renderSlideSvg({ kind: 'quote', headline: 'Best fade in town.', footer: 'Dev', seed: 0, textLayout: tl }, theme('modern'));
    const quoteText = (svg: string) => /<text([^>]*)font-style="italic"|<text([^>]*font-size="7\d")/.exec(svg)?.[0] ?? '';
    assert.match(quoteText(q('stack')), /text-anchor="middle"/);
    assert.doesNotMatch(quoteText(q('poster')), /text-anchor="middle"/, 'the side look is left-aligned');
    assert.match(q('split'), /<rect width="1080" height="1350" fill="#[0-9A-Fa-f]{6}"\/>/, 'the block look sets the quote on the accent');
    assert.doesNotMatch(q('stack'), /<rect width="1080" height="1350" fill="#/);
  });

  it('a CTA on a poster post sits on the left with the brand line above', () => {
    const c = (tl: TextLayout) =>
      renderSlideSvg({ kind: 'cta', headline: 'Book this week', ctaLabel: 'Book now', seed: 0, textLayout: tl }, theme('modern'));
    assert.match(c('poster'), /<text x="110" y="124"[^>]*>SHARP &amp; CO</);
    assert.doesNotMatch(c('stack'), /y="124"[^>]*>SHARP/);
  });

  it('inside slides are numbered in every layout, and only the cover says swipe', () => {
    for (const tl of ['stack', 'poster', 'highlight', 'split'] as TextLayout[]) {
      const inside = renderSlideSvg(
        { kind: 'body', headline: 'Floss first', body: 'It loosens what is stuck.', seed: 0, variant: 2, total: 5, textLayout: tl },
        theme('modern'),
      );
      assert.match(inside, />02<\/text>/, `${tl} inside slide shows its number`);
      assert.doesNotMatch(inside, /3 \/ 5/, `${tl} inside slide does not also show "3 / 5"`);
      assert.doesNotMatch(inside, />SWIPE</);
    }
    const cover = renderSlideSvg({ kind: 'title', headline: 'Floss before or after?', seed: 0, variant: 0, total: 5 }, theme('modern'));
    assert.match(cover, />SWIPE</);
    assert.match(cover, /1 \/ 5/);
  });

  it('a quote carries its attribution with the initial in a circle', () => {
    const q = renderSlideSvg({ kind: 'quote', headline: 'Best fade in town.', footer: 'Dev, regular', seed: 0, textLayout: 'stack' }, theme('modern'));
    assert.match(q, /<circle[^>]*\/>\s*<text[^>]*>D<\/text>/);
    assert.match(q, />Dev, regular</);
  });

  it('a light accent puts the CTA on a dark brand surface, with the accent on the button', () => {
    const light: BrandTheme = { primary: '#0E7C86', secondary: '#F4B860', brandName: 'Bright Smile', style: 'modern' };
    for (let seed = 0; seed < 6; seed++) {
      const svg = renderSlideSvg({ kind: 'cta', headline: 'Book a cleaning', ctaLabel: 'Book online', seed }, light);
      assert.match(svg, /<rect x="[\d.-]+" y="[\d.-]+" width="[\d.]+" height="92" rx="46" fill="#F4B860"\/>/, `seed ${seed}`);
    }
  });

  it('a "top" photo slide keeps its words in the upper half', () => {
    const photo = 'data:image/png;base64,iVBORw0KGgo=';
    const svg = renderSlideSvg({ kind: 'title', headline: 'Big dogs welcome', body: 'Double coats, done gently', photo, photoLayout: 'top', seed: 0 }, theme('luxe'));
    for (const r of textRuns(svg)) assert.ok(r.y < CANVAS_H * 0.55, `"${r.text}" at y=${r.y}`);
  });

  it('inside slides of a numeral deck are numbered steps', () => {
    const svg = renderSlideSvg({ kind: 'body', headline: 'Warm the oil first', seed: 0, variant: 2, textLayout: 'numeral' }, theme('modern'));
    assert.match(svg, />02<\/text>/);
  });
});

describe('text-metrics reads real widths from the fonts', () => {
  it('measures wider type wider, and tracking adds per glyph', () => {
    const a = textWidth('MMMM', 'Poppins', 100, 400)!;
    const b = textWidth('iiii', 'Poppins', 100, 400)!;
    assert.ok(a > b * 2);
    assert.equal(Math.round(textWidth('abc', 'Poppins', 100, 400, 10)! - textWidth('abc', 'Poppins', 100, 400)!), 30);
  });

  it('knows a condensed display face is taller than a text face', () => {
    assert.ok(capHeight('Anton') > capHeight('Poppins'));
  });
});
