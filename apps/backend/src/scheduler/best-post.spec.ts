import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { bestPostLine, captionHint } from './best-post';

const tue = new Date('2026-11-17T20:00:00Z'); // Tuesday in Los Angeles
const wed = new Date('2026-11-18T20:00:00Z');

describe('Friday check-in: best post of the week', () => {
  it('names the top post by views, with its day and first words', () => {
    const line = bestPostLine(
      [
        { caption: 'Fresh bread at 7. Come early.', publishedAt: tue, impressions: 900, likes: 30, saves: 2 },
        { caption: 'Croissants come out at 7 every single morning, get there early', publishedAt: wed, impressions: 1500, likes: 40, saves: 12 },
      ],
      'America/Los_Angeles',
    );
    assert.equal(line, 'Best one: Wednesday\'s post ("Croissants come out at 7 every…") with 1,500 views and 12 saves.');
  });

  it('says nothing when there are no numbers yet', () => {
    assert.equal(bestPostLine([], 'America/Los_Angeles'), null);
    assert.equal(bestPostLine([{ caption: 'x', publishedAt: tue, impressions: 0, likes: 0, saves: 0 }], 'America/Los_Angeles'), null);
  });

  it('falls back to likes when a platform reports no views', () => {
    const line = bestPostLine([{ caption: 'Hi', publishedAt: tue, impressions: 0, likes: 8, saves: 0 }], 'America/Los_Angeles');
    assert.equal(line, 'Best one: Tuesday\'s post ("Hi") with 8 likes.');
  });

  it('caption hints stop at a word and drop trailing punctuation', () => {
    assert.equal(captionHint('Three cortados, one table, zero laptops open.'), 'Three cortados, one table, zero laptops…');
    assert.equal(captionHint('Short one!'), 'Short one');
    assert.equal(captionHint(null), '');
  });
});
