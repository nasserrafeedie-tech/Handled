import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { plainQuotes } from './plain-quotes';
import { isReelLook } from './animated-reel-ask';

describe('plainQuotes', () => {
  it('turns curly apostrophes and quotes straight', () => {
    assert.equal(plainQuotes('what’s up, I‘ll “post it”'), `what's up, I'll "post it"`);
  });
  it('leaves straight text alone', () => {
    assert.equal(plainQuotes("don't post it"), "don't post it");
  });
  it('lets a phone-typed look match', () => {
    assert.equal(isReelLook('where’s the video?'), false);
    assert.equal(isReelLook(plainQuotes('where’s the video?')), true);
  });
});
