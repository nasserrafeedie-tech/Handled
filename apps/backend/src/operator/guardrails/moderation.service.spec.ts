import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ModerationService } from './moderation.service';

/**
 * The moderation screen decides what is safe to publish under a business's
 * name, and it had no test. The cases that matter most are the two failure
 * directions: letting genuinely unsafe content through (dangerous), and
 * blocking innocent content that merely contains a flagged substring (silently
 * breaks the product for real businesses — the "chateau" bug this pins).
 */
const svc = new ModerationService();
const screen = (caption: string, blackoutTopics: string[] = [], hashtags: string[] = []) =>
  svc.screen({ caption, hashtags, blackoutTopics });

describe('moderation baseline safety', () => {
  it('passes ordinary business copy', async () => {
    const v = await screen('Fresh sourdough out of the oven this morning');
    assert.equal(v.passed, true);
    assert.deepEqual(v.reasons, []);
  });

  it('blocks a real baseline term used as a word', async () => {
    const v = await screen('a post full of hate');
    assert.equal(v.passed, false);
    assert.ok(v.reasons.some((r) => r.includes('hate')));
  });

  it('does NOT block an innocent word that merely contains a term', async () => {
    // The regression: "chateau" contains "hate". A winery or French restaurant
    // must not have every post flagged.
    for (const caption of [
      'Dinner at the chateau tonight',
      'New wines from Chateau Margaux',
      'Our classic grape soda is back', // "grape" — near-miss on nothing, sanity
    ]) {
      const v = await screen(caption);
      assert.equal(v.passed, true, `wrongly blocked: "${caption}" (${v.reasons.join(', ')})`);
    }
  });

  it('is case-insensitive on baseline terms', async () => {
    assert.equal((await screen('VIOLENCE has no place here… actually it does: violence')).passed, false);
  });

  it('blocks a hyphenated term in its spaced and solid spellings too', async () => {
    // "self-harm" must also catch "self harm" and "selfharm" — a separator
    // shouldn't be a trivial bypass.
    for (const caption of ['self-harm', 'about self harm', 'selfharm content']) {
      assert.equal((await screen(caption)).passed, false, caption);
    }
  });
});

describe('customer blackout topics', () => {
  it('blocks a caption that mentions a blackout topic', async () => {
    const v = await screen('Our take on the election', ['election', 'politics']);
    assert.equal(v.passed, false);
    assert.ok(v.reasons.some((r) => r.includes('election')));
  });

  it('ignores an empty blackout topic rather than blocking everything', async () => {
    // A stray '' in the list must not match every caption (it would if passed
    // to includes()).
    const v = await screen('A totally normal post', ['']);
    assert.equal(v.passed, true, `empty blackout topic blocked a clean post: ${v.reasons.join(', ')}`);
  });

  it('also screens hashtags, not just the caption', async () => {
    const v = await screen('Great night', ['casino'], ['casinonight']);
    // Substring match on the hashtag catches the blackout topic embedded in it.
    assert.equal(v.passed, false);
  });

  it('accumulates every reason it finds', async () => {
    const v = await screen('hate and violence', ['drugs']);
    assert.ok(v.reasons.length >= 2, `expected multiple reasons, got ${v.reasons.length}`);
  });
});
