import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isBlockedFromPublishing, type PublishGateInput } from './publish-due.handler';

/**
 * The publish-time gate is the last thing between a draft and the public, and
 * it had no test. Every case here is a way something could wrongly go out under
 * a customer's name — a paused account, un-moderated content, a post the owner
 * never approved, or one already cancelled — plus the one shape that SHOULD
 * publish, so the gate can't drift to blocking everything either.
 */
const READY: PublishGateInput = {
  status: 'scheduled',
  moderationState: 'passed',
  approvalState: 'approved',
  publishStartedAt: null,
  customer: { status: 'active' },
};

describe('isBlockedFromPublishing — the last gate before a post goes public', () => {
  it('lets a fully cleared post through', () => {
    assert.equal(isBlockedFromPublishing(READY), false);
  });

  it('also clears a not_required approval (autopilot low-risk)', () => {
    assert.equal(
      isBlockedFromPublishing({ ...READY, approvalState: 'not_required' }),
      false,
    );
  });

  it('blocks a paused account, whatever the post says', () => {
    assert.equal(
      isBlockedFromPublishing({ ...READY, customer: { status: 'paused' } }),
      true,
    );
  });

  it('blocks anything that did not pass moderation', () => {
    for (const moderationState of ['pending', 'blocked']) {
      assert.equal(isBlockedFromPublishing({ ...READY, moderationState }), true, moderationState);
    }
  });

  it('blocks a post still awaiting the owner, or rejected by them', () => {
    assert.equal(isBlockedFromPublishing({ ...READY, approvalState: 'awaiting_owner' }), true);
    assert.equal(isBlockedFromPublishing({ ...READY, approvalState: 'rejected' }), true);
  });

  it('never resurrects a cancelled, failed, or already-published post', () => {
    for (const status of ['cancelled', 'failed', 'published']) {
      assert.equal(isBlockedFromPublishing({ ...READY, status }), true, status);
    }
  });

  it('blocks a post already claimed by another publisher (publishStartedAt set)', () => {
    // The atomic claim: once one runner stamps publishStartedAt, a second must
    // not also send it.
    assert.equal(
      isBlockedFromPublishing({ ...READY, publishStartedAt: new Date() }),
      true,
    );
  });

  it('fails toward blocking on an unexpected moderation value', () => {
    // The predicate checks moderationState !== 'passed', so any value the query
    // hands us that isn't literally "passed" is held rather than sent.
    assert.equal(isBlockedFromPublishing({ ...READY, moderationState: 'weird' }), true);
  });
});
