import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PostArchetype } from '@smm/contracts';

import {
  ANGLES,
  pickAngle,
  captionBudget,
  craftRules,
  concreteAnchors,
  detectThin,
} from './post-craft';

const names = (c: string, o?: Parameters<typeof detectThin>[1]) =>
  detectThin(c, o).map((f) => f.name);

describe('angles', () => {
  it('every archetype has at least one angle', () => {
    for (const a of PostArchetype.options) assert.ok(ANGLES[a]?.length, a);
  });

  it('rotates with how many of that archetype were posted recently', () => {
    const first = pickAngle('educational_tip', []);
    const second = pickAngle('educational_tip', ['educational_tip', 'promo']);
    assert.notEqual(first.key, second.key);
    // Same history, same angle: a retry of the slot asks for the same shape.
    assert.equal(pickAngle('educational_tip', ['educational_tip']).key, second.key);
  });

  it('gives list angles room only on long-form surfaces', () => {
    const list = ANGLES.educational_tip.find((a) => a.list)!;
    const plain = ANGLES.educational_tip.find((a) => !a.list)!;
    assert.equal(captionBudget('instagram', list).target, 450);
    assert.equal(captionBudget('threads', list).target, 280);
    assert.equal(captionBudget('instagram', plain).target, 280);
  });

  it('the rules ask for a payload and forbid inventing one', () => {
    const r = craftRules(ANGLES.promo[0], { target: 280 });
    assert.match(r, /PAYLOAD/);
    assert.match(r, /never a number, result or event you\s+were not given/);
    assert.match(r, /THE OFFER, PLAIN/);
  });
});

describe('detectThin — the posts nobody stops for', () => {
  const weak = [
    'Did you know flossing matters?\nIt does.',
    'Looking for a great haircut? We have you.',
    'Happy Monday, neighbours! Coffee is on.',
    "It's Friday! Treat yourself.",
    'Fall is here and so are our seasonal drinks.',
    'Calling all dog owners: grooming slots are open.',
    "We're open! Come see us today.",
    'Fresh week, fresh vibes!\nCome in.',
  ];
  for (const c of weak) {
    it(`weak hook: ${c.split('\n')[0]}`, () => assert.ok(names(c).includes('weak-hook'), c));
  }

  it('flags a first sentence too long to survive the feed cut', () => {
    const c =
      'There are a lot of reasons people put off getting their furnace looked at before the cold weather really sets in for the season.';
    assert.ok(names(c).includes('long-hook'));
  });

  it('flags opening on the business name', () => {
    assert.ok(names("Rosa's Coffee has a new seasonal latte.", { businessName: "Rosa's Coffee" }).includes('name-open'));
  });

  it('flags two or more filler phrases', () => {
    const c = 'Our scones changed. Stop by this week — made with love. See you soon.';
    assert.ok(names(c).includes('generic-filler'));
  });

  it('flags a draft that touches nothing concrete the business gave us', () => {
    const anchors = concreteAnchors(['Cardamom bun $4.50', 'Sourdough loaf'], 'Open 7-3 Tue-Sun');
    const c = 'Mornings are better with something warm in your hands.\nStop by and say hi.';
    assert.ok(names(c, { anchors }).includes('no-payload'));
  });

  it('leaves an empty post with no stock phrasing to the scroll test', () => {
    const anchors = concreteAnchors(['Cardamom bun $4.50']);
    assert.deepEqual(names('Mornings are better with something warm in your hands.', { anchors }), []);
  });

  it('does not count the closing "stop by" as advice', () => {
    const anchors = concreteAnchors(['Cardamom bun $4.50']);
    assert.ok(names('Something warm for your morning. Stop by.', { anchors }).includes('no-payload'));
  });

  it('on a bare profile asks for know-how, not for specifics it never gave', () => {
    const c = 'Mornings are better with something warm in your hands. See you soon.';
    const f = detectThin(c, { anchors: new Set() }).find((x) => x.name === 'no-payload');
    assert.ok(f);
    assert.match(f!.fix, /know-how/);
    assert.match(f!.fix, /no invented numbers/);
  });

  // Hand-written in the style of the drafts the owner called boring: clean,
  // no AI tells, and nothing in them. All three passed the checks before.
  const boring: [string, string, string][] = [
    ['coffee', "Your morning deserves better than drive-thru coffee. Our espresso is pulled on beans roasted just eight blocks away. Grab the corner table by the window and stay a while.", 'weak-hook'],
    ['hvac', "Phoenix summers are no joke. Don't let a broken AC ruin your week. Regular maintenance keeps your system running smoothly all year. Text us to book your tune-up today.", 'weak-hook'],
    ['nails', "Behind every perfect set is a lot of love and care. We take pride in every detail so you can leave feeling your best. Come see us, we can't wait to pamper you!", 'generic-filler'],
    ['yoga', 'New to yoga? Still Point is a calm, welcoming space for every body. Our beginner classes are the perfect place to start your practice. Book your first class today!', 'weak-hook'],
  ];
  boring.push(['promo', "Big savings this week only! Don't miss out on our amazing deals.", 'generic-filler']);
  for (const [label, c, expect] of boring) {
    it(`catches the boring ${label} draft (${expect})`, () => assert.ok(names(c).includes(expect), names(c).join(',')));
  }
});

describe('detectThin — leaves real posts alone', () => {
  const bare = new Set<string>();
  const goodBare = [
    'Most July AC breakdowns start with a filter nobody changed in April.\nA clogged filter makes the unit run longer and hotter. Swap it every 1 to 3 months in summer.',
    "We never file a natural nail back and forth. One direction only.\nSawing splits the layers, and that's how a nail starts peeling a week later.",
  ];
  goodBare.push('Every cut here starts with a straight razor line-up, not clippers. A razor gets the edge sharper and it lasts a few days longer.');
  for (const c of goodBare) {
    it(`bare profile: ${c.slice(0, 40)}`, () => assert.deepEqual(names(c, { anchors: bare }), [], c));
  }

  const anchors = concreteAnchors(['Cardamom bun $4.50', 'Sourdough loaf'], 'Open 7-3 Tue-Sun');
  const good = [
    'Most people store sourdough in the fridge. That is what makes it stale by Wednesday.\nKeep it cut-side down on the board. Save this for your next loaf.',
    'The cardamom bun is $4.50 and the first tray goes fast. Text us to hold one.',
    'Stop rinsing your brush with hot water.\nIt splays the bristles. Cool water, then stand it upright to dry.',
    'If you have never had your gutters cleaned, start with the downspouts.\n1. Check for standing water\n2. Clear the elbow\n3. Run a hose through it',
    'Your furnace filter is the cheapest repair you will ever make. Swap it every season.',
  ];
  for (const c of good) {
    it(c.slice(0, 50), () => assert.deepEqual(names(c, { anchors }), [], c));
  }
});
