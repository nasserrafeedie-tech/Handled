import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseTask } from '@smm/contracts';

import { GraphicsService } from '../../graphics/graphics.service';
import { contrast, wrapTo } from './kit';
import { reelLook } from './look';
import { inventedNumbers, layoutSpec, onScreenText, type PromoReelSpec } from './spec';
import { afterZoom, beforeZoom, frameAt, revealExpressions, wipeAt } from './frames';
import {
  buildSpec,
  checkSpec,
  fittedOfflineSpec,
  offlinePromoSpec,
  offlineRevealSpec,
  pickOffer,
  type SpecContext,
  type SpecWriter,
} from './copy';
import { animatedReelsOn } from './flag';
import { animatedReelAsk } from '../../../concierge/animated-reel-ask';
import { buildReelTask } from '../../../scheduler/reel.worker';

const look = reelLook({ primary: '#1F3B2D', secondary: '#E8B4C8', brandName: 'Pawsh Grooming', style: 'luxe' });
const boldLook = reelLook({ primary: '#111111', secondary: '#C9A227', brandName: 'Sharp & Co', style: 'bold' });

const ctx = (source: string, extra: Partial<SpecContext> = {}): SpecContext => ({
  kind: 'promo',
  source,
  businessName: 'Sharp & Co',
  businessType: 'barber shop',
  websiteUrl: 'sharpandco.com',
  ...extra,
});

const goodPromo: PromoReelSpec = {
  kind: 'promo',
  kicker: 'This week only',
  headline: 'Fade + beard',
  price: '$35',
  was_price: '$45',
  details: ['Tuesday to Thursday'],
  end_headline: 'Book your chair',
  end_body: 'sharpandco.com',
  cta_label: 'Book now',
};

describe('animated reels: the owner\'s own words, offline', () => {
  it('turns "kids cuts are $20 on weekdays" into a promo', () => {
    const s = offlinePromoSpec(ctx('kids cuts are $20 on weekdays'));
    assert.equal(s.headline, 'Kids cuts');
    assert.equal(s.price, '$20');
    assert.deepEqual(s.details, ['On weekdays']);
    assert.equal(s.kicker, 'Weekday special');
    assert.equal(s.was_price, undefined);
  });

  it('keeps a usual price only when the owner gave one', () => {
    const s = offlinePromoSpec(ctx('Fade and beard $35, usually $45, Tuesday to Thursday'));
    assert.equal(s.price, '$35');
    assert.equal(s.was_price, '$45');
    assert.match(s.headline, /^Fade and beard/);
  });

  it('takes the ask off the front of a text', () => {
    const s = offlinePromoSpec(ctx('make a promo reel for teeth whitening $99 for new patients'));
    assert.equal(s.headline, 'Teeth whitening');
    assert.equal(s.price, '$99');
    assert.equal(s.kicker, 'For new clients');
  });

  it('handles an offer with no price', () => {
    const s = offlinePromoSpec(ctx('free coffee with any pastry this weekend'));
    assert.equal(s.price, undefined);
    assert.equal(s.kicker, 'This weekend');
    assert.ok(checkSpec(s, ctx('free coffee with any pastry this weekend'), look).ok);
  });

  it('never says the same thing twice on the end card', () => {
    const s = offlinePromoSpec(ctx('kids cuts $20', { websiteUrl: null }));
    assert.ok(!s.end_body || !s.end_body.toLowerCase().startsWith(s.end_headline.toLowerCase()), `${s.end_headline} / ${s.end_body}`);
  });

  it('words a reveal for the trade', () => {
    assert.equal(offlineRevealSpec(ctx('', { kind: 'before_after', businessType: 'dog groomer' })).before_caption, 'Came in scruffy');
    assert.equal(offlineRevealSpec(ctx('', { kind: 'before_after', businessType: 'florist' })).after_caption, 'After');
  });

  it('shortens a long offer until it fits rather than failing', () => {
    const long = ctx('our deluxe signature hot towel straight razor shave with full beard sculpting and conditioning treatment is $60');
    const c = fittedOfflineSpec(long, boldLook);
    assert.ok(c.ok, c.ok ? '' : c.problems.join('; '));
  });

  it('picks the priced profile offer when the owner asked for none', () => {
    assert.equal(pickOffer(undefined, ['Walk-ins welcome', 'Kids cuts $20']), 'Kids cuts $20');
    assert.equal(pickOffer('  ', ['Walk-ins welcome']), 'Walk-ins welcome');
    assert.equal(pickOffer(undefined, []), null);
    assert.equal(pickOffer('half off color', ['Kids cuts $20']), 'half off color');
    // Naming a profile offer without its figure uses the offer as written.
    assert.equal(pickOffer('our first groom offer', ['Nail trims', 'first groom 20% off this month']), 'first groom 20% off this month');
    assert.equal(pickOffer('kids cuts $15', ['Kids cuts $20']), 'kids cuts $15');
  });
});

describe('animated reels: the checks', () => {
  it('refuses a number the owner never gave', () => {
    assert.deepEqual(inventedNumbers(goodPromo, 'fade + beard $35, usually $45'), []);
    assert.deepEqual(inventedNumbers({ ...goodPromo, price: '$29' }, 'fade + beard $35'), ['29', '45']);
    const c = checkSpec({ ...goodPromo, price: '$29' }, ctx('fade + beard $35, usually $45'), boldLook);
    assert.equal(c.ok, false);
  });

  it('counts the owner\'s website as theirs', () => {
    const c = checkSpec({ ...goodPromo, end_body: 'shop247.com' }, ctx('fade + beard $35, usually $45', { websiteUrl: 'shop247.com' }), boldLook);
    assert.ok(c.ok);
  });

  it('refuses words that do not fit the frame', () => {
    const c = checkSpec(
      { ...goodPromo, headline: 'Supercalifragilisticexpialidocious' },
      ctx('fade + beard $35, usually $45'),
      boldLook,
    );
    assert.equal(c.ok, false);
    assert.ok(!c.ok && c.problems.some((p) => p.startsWith('headline')));
  });

  it('refuses the wrong kind and junk', () => {
    assert.equal(checkSpec({ kind: 'promo' }, ctx('x'), look).ok, false);
    assert.equal(checkSpec(offlineRevealSpec(ctx('', { kind: 'before_after' })), ctx('$35'), look).ok, false);
  });

  it('drops a "was" price that is not higher than the price', () => {
    const r = layoutSpec({ ...goodPromo, was_price: '$30' }, boldLook);
    assert.ok(r.ok && r.layout.kind === 'promo' && !r.layout.wasPrice);
  });

  it('puts every visible word in front of the risk gate', () => {
    const t = onScreenText(goodPromo);
    for (const w of ['This week only', 'Fade + beard', '$35', '$45', 'Tuesday to Thursday', 'Book now']) {
      assert.ok(t.includes(w), w);
    }
  });
});

describe('animated reels: the model writes, the checks decide', () => {
  const writer = (replies: unknown[]): SpecWriter & { prompts: string[] } => {
    const prompts: string[] = [];
    return {
      prompts,
      async completeJson(req: { prompt: string }) {
        prompts.push(req.prompt);
        const r = replies.shift();
        if (r instanceof Error) throw r;
        return r as never;
      },
    } as never;
  };
  const source = ctx('fade + beard $35, usually $45, Tuesday to Thursday');

  it('uses a good spec from the model', async () => {
    const b = await buildSpec(writer([goodPromo]), source, boldLook, 'brand');
    assert.equal(b.source, 'model');
    assert.equal(b.spec.kind === 'promo' && b.spec.price, '$35');
  });

  it('sends the problems back once, then uses the fix', async () => {
    const w = writer([{ ...goodPromo, price: '$29' }, goodPromo]);
    const b = await buildSpec(w, source, boldLook, 'brand');
    assert.equal(b.source, 'model');
    assert.equal(w.prompts.length, 2);
    assert.match(w.prompts[1], /the number 29 is not in what the owner said/);
  });

  it('falls back to the owner\'s words after two misses or an error', async () => {
    const b1 = await buildSpec(writer([{ ...goodPromo, price: '$29' }, { ...goodPromo, price: '$19' }]), source, boldLook, 'brand');
    assert.equal(b1.source, 'offline');
    assert.equal(b1.spec.kind === 'promo' && b1.spec.price, '$35');
    const b2 = await buildSpec(writer([new Error('LLM output was not valid JSON')]), source, boldLook, 'brand');
    assert.equal(b2.source, 'offline');
    const b3 = await buildSpec(null, source, boldLook, 'brand');
    assert.equal(b3.source, 'offline');
  });
});

describe('animated reels: look and layout', () => {
  it('keeps text readable on any brand colour', () => {
    for (const primary of ['#FFFFFF', '#FFF200', '#7FDBFF', '#FF4136', '#2ECC40', '#000000', 'navy', 'not-a-colour', '#F5F5DC']) {
      for (const style of ['modern', 'editorial', 'bold', 'luxe'] as const) {
        const l = reelLook({ primary, secondary: '#FFDC00', brandName: 'X', style });
        assert.ok(contrast(l.ink, l.bg) >= 4.5, `${primary}/${style}: ink ${l.ink} on ${l.bg}`);
        assert.ok(contrast(l.onAccent, l.accent) >= 3, `${primary}/${style}: button ${l.onAccent} on ${l.accent}`);
      }
    }
  });

  it('balances wrapped lines so none is left stranded', () => {
    const lines = wrapTo('Left feeling brand new', look.head, 88, 888, 2)!;
    assert.equal(lines.length, 2);
    assert.ok(lines.every((l) => l.split(' ').length >= 2), lines.join(' / '));
  });

  it('draws the same frame for the same moment', () => {
    const r = layoutSpec(goodPromo, boldLook);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(frameAt(r.layout, boldLook, 3.2, { seed: 4 }), frameAt(r.layout, boldLook, 3.2, { seed: 4 }));
    assert.notEqual(frameAt(r.layout, boldLook, 0.5, { seed: 4 }), frameAt(r.layout, boldLook, 9.5, { seed: 4 }));
  });

  it('every frame is an SVG the engine can draw', () => {
    const gfx = new GraphicsService();
    const r = layoutSpec(goodPromo, boldLook);
    assert.ok(r.ok);
    if (!r.ok) return;
    for (const t of [0, 1.5, 4, 8.4, 11]) {
      const img = gfx.rasterize(frameAt(r.layout, boldLook, t, { seed: 1 }), 216);
      assert.equal(img.width, 216);
      assert.equal(img.height, 384);
    }
  });
});

/** Evaluates the small part of ffmpeg's expression language the reveal uses. */
function ffEval(expr: string, t: number): number {
  const fns = {
    clip: (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x)),
    pow: Math.pow,
    lt: (a: number, b: number) => (a < b ? 1 : 0),
    if: (c: number, a: number, b: number) => (c ? a : b),
    trunc: Math.trunc,
  };
  assert.ok(/^[\d\s.+\-*/(),a-z]+$/.test(expr), expr);
  const js = expr.replace(/\bif\(/g, 'iff(');
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('t', 'clip', 'pow', 'lt', 'iff', 'trunc', `return ${js};`)(t, fns.clip, fns.pow, fns.lt, fns.if, fns.trunc);
}

describe('animated reels: the reveal photo layer', () => {
  it("ffmpeg's photo motion matches the frames'", () => {
    const e = revealExpressions();
    for (let t = 0; t <= 11.5; t += 0.1) {
      assert.ok(Math.abs(ffEval(e.wipe, t) - wipeAt(t)) < 1e-9, `wipe at ${t}`);
      assert.ok(Math.abs(ffEval(e.beforeZoom, t) - beforeZoom(t)) < 1e-9, `before zoom at ${t}`);
      assert.ok(Math.abs(ffEval(e.afterZoom, t) - afterZoom(t)) < 1e-9, `after zoom at ${t}`);
    }
  });

  it('the overlay leaves the photos out and the background clear', () => {
    const fit = fittedOfflineSpec(ctx('', { kind: 'before_after', businessType: 'dog grooming' }), look);
    assert.ok(fit.ok);
    if (!fit.ok) return;
    const svg = frameAt(fit.layout, look, 2, { photos: null });
    assert.ok(!svg.includes('<image'));
    const img = new GraphicsService().rasterize(svg, 216);
    // Bottom middle is photo in a reveal: clear in the overlay.
    const at = (x: number, y: number) => img.pixels[(y * img.width + x) * 4 + 3];
    assert.equal(at(108, 370), 0);
    // The end card covers the photos, so it is opaque.
    const end = new GraphicsService().rasterize(frameAt(fit.layout, look, 11, { photos: null }), 216);
    assert.equal(end.pixels[(370 * end.width + 108) * 4 + 3], 255);
  });
});

describe('animated reels: asking for one', () => {
  it('reads an ask for a promo or a reveal', () => {
    assert.deepEqual(animatedReelAsk('make a promo reel for kids cuts $20 on weekdays'), {
      kind: 'promo',
      offerText: 'kids cuts $20 on weekdays',
    });
    assert.deepEqual(animatedReelAsk('can you do a before and after reel'), { kind: 'before_after' });
    assert.deepEqual(animatedReelAsk('Make an animated video of our usual special'), { kind: 'promo', offerText: undefined });
    assert.equal(animatedReelAsk('make a reel')?.kind, undefined);
    assert.equal(animatedReelAsk('can I see the promo reel?'), null);
    assert.equal(animatedReelAsk('make a promo graphic for $20 cuts'), null);
  });

  it('is off unless ANIMATED_REELS=1', () => {
    assert.equal(animatedReelsOn({}), false);
    assert.equal(animatedReelsOn({ ANIMATED_REELS: 'true' }), false);
    assert.equal(animatedReelsOn({ ANIMATED_REELS: '1' }), true);
  });

  it('a queued reel becomes a valid task', () => {
    const id = randomUUID();
    const promo = parseTask(buildReelTask({ customerId: id, platform: 'instagram', animated: { kind: 'promo', offerText: '$20 cuts' } }));
    assert.equal(promo.type, 'ANIMATED_REEL');
    const reveal = parseTask(
      buildReelTask({ customerId: id, platform: 'instagram', animated: { kind: 'before_after', mediaAssetIds: [randomUUID(), randomUUID()] } }),
    );
    assert.equal(reveal.type, 'ANIMATED_REEL');
    // No photos named: the handler takes the newest ones tagged before and after.
    assert.equal(parseTask(buildReelTask({ customerId: id, platform: 'instagram', animated: { kind: 'before_after' } })).type, 'ANIMATED_REEL');
    const cut = parseTask(buildReelTask({ customerId: id, platform: 'instagram' }));
    assert.equal(cut.type, 'ASSEMBLE_REEL');
  });
});
