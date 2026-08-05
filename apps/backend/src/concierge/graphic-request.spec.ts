import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConciergeService } from './concierge.service';

/**
 * A graphic must be COMMISSIONED, not merely mentioned.
 *
 * The bug this guards: "Can I see the full carousel?" — a request to LOOK at
 * an existing draft — matched the old bare-noun regex, generated a nonsense
 * graphic from the question's own words, and replied "Made your graphic" with
 * nothing attached. Viewing words must never read as making words.
 *
 * isGraphicRequest is pure (regex on the body), so a bare instance suffices.
 */
const svc = new ConciergeService(
  ...(Array(12).fill(undefined) as []),
) as unknown as { isGraphicRequest(b: string): boolean };
const isMake = (b: string) => svc.isGraphicRequest(b);

describe('graphic request detection', () => {
  it('fires on genuine commissions', () => {
    for (const b of [
      'can you make a graphic about our happy hour',
      'Make me a carousel on spring cleaning tips',
      'I need a promo flyer for the weekend',
      'create a quote card from that review',
      'can I get a graphic for the sale',
      'make me a post about closing early friday',
    ]) {
      assert.equal(isMake(b), true, `"${b}" should commission a graphic`);
    }
  });

  it('never fires on requests to VIEW an existing draft or its media', () => {
    for (const b of [
      'Can I see the full carousel?',
      'show me the carousel',
      'can you resend the graphic',
      'where is the carousel you mentioned',
      'send the slides again',
      'I want to look at the graphic first',
    ]) {
      assert.equal(isMake(b), false, `"${b}" is a view, not a make`);
    }
  });

  it('ignores captions that merely mention the words', () => {
    for (const b of ['yes', 'love the carousel, schedule it', 'that promo looks great']) {
      assert.equal(isMake(b), false, `"${b}" should not commission anything`);
    }
  });
});
