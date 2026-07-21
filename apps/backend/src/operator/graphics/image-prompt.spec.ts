import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildImagePrompt,
  claimsSpecificPlace,
  NEGATIVE_PROMPT,
  stripOwnershipClaims,
  subjectInstruction,
  type ImageBrief,
} from './image-prompt';

const BRIEF: ImageBrief = {
  businessType: 'coffee shop',
  visualStyle: 'warm and unfussy',
  caption: "Rosa pulls the first shot at 6:45, before anyone else is in.",
  brandColors: ['#6B2737'],
};

describe('stripOwnershipClaims', () => {
  it('removes wording that claims a specific place', () => {
    assert.equal(stripOwnershipClaims('our espresso machine'), 'espresso machine');
    assert.equal(stripOwnershipClaims('their corner table'), 'corner table');
    assert.equal(stripOwnershipClaims("the shop's counter"), 'counter');
  });

  it('removes storefront and exterior framing', () => {
    // An exterior is the single most identifying shot there is.
    assert.ok(!/storefront/i.test(stripOwnershipClaims('a storefront at golden hour')));
    assert.ok(!/exterior/i.test(stripOwnershipClaims('exterior of the building')));
  });

  it('leaves an already-generic subject untouched', () => {
    const subject = 'a cortado on a worn wooden counter';
    assert.equal(stripOwnershipClaims(subject), subject);
  });

  it('does not leave double spaces behind', () => {
    assert.ok(!/\s{2,}/.test(stripOwnershipClaims('a photo of our lovely counter')));
  });
});

describe('claimsSpecificPlace', () => {
  it('flags possessive and location claims', () => {
    for (const s of [
      'our patio in the morning',
      'their front window',
      'the storefront on a rainy day',
      "the salon's front desk",
    ]) {
      assert.ok(claimsSpecificPlace(s), `should have flagged: ${s}`);
    }
  });

  it('gives the same answer every time it is asked', () => {
    // A shared /g/ regex carries lastIndex between calls, which makes .test()
    // alternate true/false on identical input — the gate would pass every
    // other claim. Ten identical calls must agree.
    const claim = 'our storefront at golden hour';
    for (let i = 0; i < 10; i++) {
      assert.equal(claimsSpecificPlace(claim), true, `disagreed on call ${i + 1}`);
    }
  });

  it('passes generic subjects', () => {
    for (const s of [
      'a cortado on a worn wooden counter',
      'coffee beans spilling from a paper bag',
      'a set of nail polish bottles in a row',
    ]) {
      assert.ok(!claimsSpecificPlace(s), `false positive: ${s}`);
    }
  });
});

describe('buildImagePrompt', () => {
  it('never contains the business name', () => {
    // The name is not a parameter at all — this asserts the shape of the API,
    // so a future refactor that adds one has to break this test first.
    const prompt = buildImagePrompt(BRIEF, 'a cortado on a worn wooden counter');
    assert.ok(!/rosa/i.test(prompt), `leaked a business name: ${prompt}`);
  });

  it('carries every hard constraint', () => {
    const prompt = buildImagePrompt(BRIEF, 'a cortado');
    for (const rule of ['no text', 'no logos', 'no faces', 'no identifiable people']) {
      assert.ok(prompt.includes(rule), `missing constraint "${rule}"`);
    }
  });

  it('strips a claim that arrives in the subject', () => {
    // The subject is model-written, so it is treated as untrusted.
    const prompt = buildImagePrompt(BRIEF, 'our storefront at golden hour');
    assert.ok(!/storefront/i.test(prompt), `claim survived: ${prompt}`);
    assert.ok(!/\bour\b/i.test(prompt), `possessive survived: ${prompt}`);
  });

  it('describes the business generically, not specifically', () => {
    const prompt = buildImagePrompt(BRIEF, 'a cortado');
    assert.match(prompt, /an independent coffee shop/);
  });

  it('uses the owner visual style when there is one, and a neutral default otherwise', () => {
    assert.match(buildImagePrompt(BRIEF, 'a cortado'), /warm and unfussy styling/);
    assert.match(
      buildImagePrompt({ ...BRIEF, visualStyle: null }, 'a cortado'),
      /natural, unstyled/,
    );
  });
});

describe('NEGATIVE_PROMPT', () => {
  it('excludes text and people, which is the whole point', () => {
    assert.match(NEGATIVE_PROMPT, /text/);
    assert.match(NEGATIVE_PROMPT, /watermark/);
    assert.match(NEGATIVE_PROMPT, /human face/);
  });
});

describe('subjectInstruction', () => {
  it('forbids the specific business and its exterior', () => {
    const instr = subjectInstruction(BRIEF);
    assert.match(instr, /Never the specific business/);
    assert.match(instr, /no storefront/);
  });

  it('includes the caption so the subject matches the post', () => {
    assert.ok(subjectInstruction(BRIEF).includes('Rosa pulls the first shot'));
  });

  it('works with no caption', () => {
    const instr = subjectInstruction({ ...BRIEF, caption: null });
    assert.ok(instr.length > 0);
    assert.ok(!instr.includes('The post says'));
  });
});
