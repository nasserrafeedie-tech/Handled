import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConciergeService } from './concierge.service';

/**
 * The kill switch must fire on the bare opt-out keyword, and ONLY on it.
 *
 * The bug this guards: the old prefix match turned any message *starting* with
 * stop/pause/cancel/halt into a full-account pause — so an owner replying
 * "cancel that one" or "pause the promo" to a draft (which the prompt invites)
 * silently halted their whole account instead of rejecting one post.
 *
 * isStop is pure (regex on the body, no `this`), so a bare instance suffices.
 */
const svc = new ConciergeService(
  ...(Array(9).fill(undefined) as []),
) as unknown as { isStop(b: string): boolean };
const isStop = (b: string) => svc.isStop(b);

describe('kill-switch keyword detection', () => {
  it('fires on the standard carrier opt-out keywords', () => {
    for (const w of ['STOP', 'stop', 'Stop', 'stopall', 'unsubscribe', 'end', 'quit']) {
      assert.equal(isStop(w), true, `"${w}" alone should stop`);
    }
  });

  it('does NOT fire on bare "cancel"/"pause"/"halt" — those are draft actions', () => {
    // A bare "cancel"/"pause" is how an owner skips the draft in front of them;
    // routing it to a full-account stop is the wrong, destructive read.
    for (const w of ['cancel', 'Cancel', 'pause', 'halt']) {
      assert.equal(isStop(w), false, `"${w}" must reach draft-level intent, not the kill switch`);
    }
  });

  it('tolerates surrounding whitespace and trailing punctuation', () => {
    assert.equal(isStop('  stop '), true);
    assert.equal(isStop('STOP.'), true);
    assert.equal(isStop('stop!'), true);
  });

  it('does NOT fire on a sentence that merely starts with the word', () => {
    for (const s of [
      'cancel that one',
      'pause the promo till Friday',
      'stop posting on weekends please',
      'can you cancel the Tuesday post',
      'halt the discount post',
    ]) {
      assert.equal(isStop(s), false, `"${s}" must reach normal handling, not the kill switch`);
    }
  });
});
