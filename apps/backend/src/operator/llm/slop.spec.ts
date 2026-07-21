import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { detectSlop, shouldRegenerate, slopFeedback } from './slop';

const names = (c: string) => detectSlop(c).map((f) => f.name).sort();
const fires = (c: string, name: string) => names(c).includes(name);

describe('detectSlop — catches the tells', () => {
  const cases: [string, string][] = [
    ['not-just', "It's not just coffee, it's a morning ritual."],
    ['not-just', 'More than just a barbershop.'],
    ['without-the', 'Great espresso — without the attitude.'],
    ['whether-youre', "Whether you're a regular or a first-timer, there's a seat."],
    ['discovery-verbs', 'Discover our new seasonal menu.'],
    ['discovery-verbs', 'Elevate your morning routine.'],
    ['marketing-cliche', 'This blend is a game-changer.'],
    ['marketing-cliche', 'Looking for good coffee? Look no further.'],
    ['nestled', 'Nestled in the heart of Highland Park.'],
    ['fast-paced-world', "In today's fast-paced world, slow coffee matters."],
    ['isnt-about-its-about', "It isn't about the beans. It's about the people."],
    ['superlative-open', 'The best latte in Los Angeles, full stop.'],
    ['superlative-open', "We're excited to announce our new hours!"],
    ['superlative-open', 'Introducing our winter menu.'],
    ['essay-connector', 'We roast weekly. Moreover, we grind to order.'],
  ];

  for (const [pattern, caption] of cases) {
    it(`${pattern}: ${caption.slice(0, 40)}`, () => {
      assert.ok(fires(caption, pattern), `expected ${pattern} in: ${caption}`);
    });
  }
});

describe('detectSlop — leaves real writing alone', () => {
  // Captions written the way an owner actually talks. Every one of these must
  // come back clean; a detector that fires on these would be worse than none.
  const clean = [
    'Rosa pulls the first shot at 6:45, before anyone else is in.',
    'Corner table by the window is open. It will not be in twenty minutes.',
    'We roast eight blocks from here. That is the whole trick.',
    'Half-price lattes Friday, 7am to 4pm. Bring a friend.',
    'Nine years on this corner. Same grinder, same Rosa.',
    'Eggs, flour, and butter. That is the entire ingredient list.',
    'Send this to whoever still thinks we close at three.',
    'New beans in. They taste like plum and something darker underneath.',
    'The machine broke Tuesday. It is fixed. We are sorry about Tuesday.',
    'Save this for the next time someone asks where to go.',
  ];

  for (const caption of clean) {
    it(`clean: ${caption.slice(0, 40)}`, () => {
      assert.deepEqual(detectSlop(caption), [], `false positive on: ${caption}`);
    });
  }
});

describe('adjective-triple', () => {
  it('fires on three adjectives in a row', () => {
    assert.ok(fires('Fresh, local, and honest coffee.', 'adjective-triple'));
  });

  it('does not fire on a real list of things', () => {
    assert.ok(!fires('Eggs, flour, and butter. That is it.', 'adjective-triple'));
  });

  it('does not fire on a two-item list', () => {
    assert.ok(!fires('Fresh and local.', 'adjective-triple'));
  });
});

describe('shouldRegenerate', () => {
  it('regenerates on a single unmistakable tell', () => {
    assert.equal(shouldRegenerate(detectSlop('Discover our new menu.')), true);
  });

  it('tolerates one texture hit', () => {
    const f = detectSlop('Ever wonder how we roast? We do it eight blocks away.');
    assert.equal(f.length, 1);
    assert.equal(shouldRegenerate(f), false);
  });

  it('regenerates once texture stacks up', () => {
    const f = detectSlop('Ever wonder why? ✨ Fresh, local, and honest coffee.');
    assert.ok(f.length >= 2);
    assert.equal(shouldRegenerate(f), true);
  });

  it('does not regenerate a clean caption', () => {
    assert.equal(shouldRegenerate(detectSlop('We open at seven.')), false);
  });
});

describe('slopFeedback', () => {
  it('names only what the draft actually did', () => {
    const draft = 'Discover our new menu.';
    const fb = slopFeedback(detectSlop(draft), draft);
    assert.match(fb, /"discover"/);
    assert.ok(!/nestled/.test(fb), 'named a problem the draft did not have');
  });

  it('includes the draft, so the model can actually see what to rewrite', () => {
    // Without this the model replies asking to be shown the draft, and the
    // response fails to parse — a wasted generation. Caught in an eval run.
    const draft = 'Discover our new menu.';
    const fb = slopFeedback(detectSlop(draft), draft);
    assert.ok(fb.includes(draft), 'feedback omitted the draft it refers to');
  });

  it('is empty-safe', () => {
    assert.ok(slopFeedback([], 'anything').length > 0);
  });
});
