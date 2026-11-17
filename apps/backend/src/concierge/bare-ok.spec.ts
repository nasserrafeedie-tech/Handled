import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { lastMessageShowsDraft, STRONG_APPROVE_RE } from './concierge.service';

/**
 * QA round 1 (Nov 17): the owner answered "ok will do" to the declined-card
 * text, and that approved and scheduled a draft shown hours earlier. A bare
 * "ok" answers whatever we said last.
 */
describe('which message a bare "ok" answers', () => {
  it('the draft presentation counts', () => {
    assert.ok(lastMessageShowsDraft('Draft for Thu 9:00 AM:\n\n“Fresh fades.”\n\nReply “yes” to schedule it.', 'Fresh fades.'));
  });

  it('a nudge that quotes the caption counts', () => {
    assert.ok(lastMessageShowsDraft('Still want “Fresh fades all week” to go out?', 'Fresh fades all week, walk-ins welcome'));
  });

  it('a billing notice or an upgrade text does not', () => {
    assert.equal(lastMessageShowsDraft("Heads up, your card was declined. I'll keep posting as normal.", 'Fresh fades.'), false);
    assert.equal(lastMessageShowsDraft("You're on Pro now: you'll get a post every day.", 'Fresh fades.'), false);
  });

  it('with nothing sent yet, the draft is the only reading', () => {
    assert.ok(lastMessageShowsDraft(null, 'Fresh fades.'));
  });

  it('approvals that name the post hold whatever came last; acknowledgements do not', () => {
    for (const s of ['post it', 'send it', 'schedule it', 'approved', 'looks good', 'love it', 'lgtm']) {
      assert.ok(STRONG_APPROVE_RE.test(s), s);
    }
    for (const s of ['ok', 'ok will do', 'yes', 'sure', 'thanks', 'great']) {
      assert.equal(STRONG_APPROVE_RE.test(s), false, s);
    }
  });
});
