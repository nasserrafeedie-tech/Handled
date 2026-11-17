import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Jimp } from 'jimp';

import { cropAlign, readPhoto, reviewPhotoLayout } from './photo-focus';
import { renderSlideSvg } from './slide-templates';

/** A 300×400 photo: flat grey, with a bright orange subject in one band. */
async function photoWithDetail(from: number, to: number): Promise<string> {
  const w = 300;
  const h = 400;
  const img = new Jimp({ width: w, height: h, color: 0x888888ff });
  for (let y = Math.round(from * h); y < Math.round(to * h); y++) {
    for (let x = 100; x < 200; x++) img.setPixelColor(0xff8800ff, x, y);
  }
  const png = await img.getBuffer('image/png');
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('photo review: keep the words off the subject', () => {
  it('finds a subject low in the photo, and one high in it', async () => {
    const low = await readPhoto(await photoWithDetail(0.6, 0.85));
    const high = await readPhoto(await photoWithDetail(0.05, 0.3));
    assert.ok(low && low.focusY > 0.6 && low.underWords > 0.9, `low subject read as ${JSON.stringify(low)}`);
    assert.ok(high && high.focusY < 0.3 && high.underWords < 0.1, `high subject read as ${JSON.stringify(high)}`);
  });

  it('moves the words above a low subject, or frames a subject that fills the photo', () => {
    const low = { focusY: 0.7, underWords: 0.8, overTop: 0.1 };
    const tall = { focusY: 0.5, underWords: 0.6, overTop: 0.5 };
    const high = { focusY: 0.3, underWords: 0.2, overTop: 0.8 };
    assert.equal(reviewPhotoLayout('card', low), 'top');
    assert.equal(reviewPhotoLayout('full', low), 'top');
    assert.equal(reviewPhotoLayout('card', tall), 'frame');
    assert.equal(reviewPhotoLayout('card', high), 'card');
    assert.equal(reviewPhotoLayout('band', low), 'band');
    assert.equal(reviewPhotoLayout('card', null), 'card', 'an unreadable photo keeps its layout');
  });

  it('reads a low subject as leaving the top clear', async () => {
    const low = await readPhoto(await photoWithDetail(0.6, 0.85));
    assert.ok(low && low.overTop < 0.05, JSON.stringify(low));
    assert.equal(reviewPhotoLayout('card', low), 'top');
  });

  it('crops toward the subject', () => {
    assert.equal(cropAlign(0.1), 'xMidYMin');
    assert.equal(cropAlign(0.5), 'xMidYMid');
    assert.equal(cropAlign(0.9), 'xMidYMax');
    assert.equal(cropAlign(undefined), 'xMidYMid');
    const svg = renderSlideSvg(
      { kind: 'body', headline: 'Fresh cuts', photo: 'data:image/png;base64,x', photoLayout: 'band', photoFocusY: 0.9 },
      { primary: '#141414', secondary: '#C9A227', brandName: 'Sharp & Co', style: 'modern' },
    );
    assert.match(svg, /preserveAspectRatio="xMidYMax slice"/);
  });

  it('a photo it cannot read gives no answer instead of a guess', async () => {
    assert.equal(await readPhoto('data:image/png;base64,iVBORw0KGgo='), null);
  });
});
