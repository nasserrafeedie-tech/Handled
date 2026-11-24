import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { IntentService } from './intent.service';

/** Without the model, the patterns still read everyday approvals. */
const offline = (text: string) =>
  (new IntentService(undefined as never) as unknown as { classifyOffline(t: string): { intent: string } }).classifyOffline(text).intent;

describe('offline approvals', () => {
  it('reads "that\'s perfect" and friends as a yes', () => {
    for (const t of ["That's perfect", 'thats great', 'this is awesome', 'that works', 'works for me', 'all good', "it's fire"]) {
      assert.equal(offline(t), 'approve', t);
    }
  });
  it('still reads an edit or a skip first', () => {
    assert.equal(offline("that's perfect but make it shorter"), 'revise');
    assert.equal(offline("that's fine, skip it"), 'cancel');
  });
});
