import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { connectMessage } from './concierge.service';

describe('the connect-link text at the end of onboarding', () => {
  it('says the first week is on its way when nothing has said so yet', () => {
    const t = connectMessage('https://x.test', 'c1', false);
    assert.match(t, /x\.test\/connect\?c=c1/);
    assert.match(t, /writing your first week/);
  });

  it('does not promise the first week twice after the research note', () => {
    const t = connectMessage('https://x.test', 'c1', true);
    assert.match(t, /x\.test\/upload\?c=c1&kind=logo$/);
    assert.doesNotMatch(t, /first week/);
  });
});
