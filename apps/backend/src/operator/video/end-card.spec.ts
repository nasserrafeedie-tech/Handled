import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { displayHost, endCardCopy } from './end-card';

describe('reel end card copy', () => {
  it('sends appointment businesses to book, and shows their site', () => {
    const c = endCardCopy({ businessName: 'Sharp & Co', businessType: 'barbershop', websiteUrl: 'https://www.SharpAndCo.com/book?x=1' });
    assert.deepEqual(c, { headline: 'Sharp & Co', body: 'sharpandco.com', ctaLabel: 'Book now' });
    assert.equal(endCardCopy({ businessType: 'family dentist' }).ctaLabel, 'Book now');
    assert.equal(endCardCopy({ businessType: 'dog grooming' }).ctaLabel, 'Book now');
  });

  it('invites people to drop by a café or shop', () => {
    const c = endCardCopy({ businessName: "Rosa's Coffee", businessType: 'coffee shop', websiteUrl: 'none' });
    assert.equal(c.ctaLabel, 'Come by');
    assert.equal(c.body, 'See you soon.');
    assert.equal(endCardCopy({ businessType: 'bakery and cafe' }).ctaLabel, 'Come by');
    assert.equal(endCardCopy({ businessType: 'flower shop' }).ctaLabel, 'Come by');
    // A shop you book is still somewhere you book.
    assert.equal(endCardCopy({ businessType: 'nail shop' }).ctaLabel, 'Book now');
  });

  it('falls back to the old card when nothing is known', () => {
    assert.deepEqual(endCardCopy({}), { headline: 'Come see us', body: 'We saved you a spot.', ctaLabel: 'Visit us' });
  });

  it('only prints a site that reads as a site', () => {
    assert.equal(displayHost('rosascoffee.com'), 'rosascoffee.com');
    assert.equal(displayHost('none'), undefined);
    assert.equal(displayHost('n/a'), undefined);
    assert.equal(displayHost('instagram.com/rosas'), undefined);
    assert.equal(displayHost(''), undefined);
    assert.equal(displayHost('a-really-long-subdomain.someplatform-hosting.example.com'), undefined);
  });
});
