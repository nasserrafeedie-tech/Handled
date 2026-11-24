import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isPaidPriceQuestion, paidPriceText } from './concierge.service';

describe('a paying owner asking about plan prices', () => {
  it('reads plan price questions', () => {
    for (const t of ['how much is pro', 'what does growth cost?', 'how much to upgrade', 'what are your plans prices']) {
      assert.equal(isPaidPriceQuestion(t), true, t);
    }
  });
  it('leaves their strategy and their own prices alone', () => {
    for (const t of ["what's my plan again", 'how much should I charge for nail trims', 'post about our prices this week']) {
      assert.equal(isPaidPriceQuestion(t), false, t);
    }
  });
  it('names their plan and the next one up', () => {
    assert.match(paidPriceText('growth'), /You're on Growth\. Reply UPGRADE and I'll move you to Pro\./);
    assert.match(paidPriceText('starter'), /move you to Growth/);
    assert.match(paidPriceText('pro'), /top plan/);
    assert.match(paidPriceText('pro'), /\$699/);
  });
});
