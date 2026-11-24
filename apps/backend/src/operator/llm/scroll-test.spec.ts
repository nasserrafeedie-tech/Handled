import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { scrollTest, scrollFeedback, scrollTestPrompt } from './scroll-test';

describe('scroll test', () => {
  it('asks a skeptical reader for a hook and one concrete thing', () => {
    const p = scrollTestPrompt('Your smile is our priority.', 'dental practice');
    assert.match(p, /skeptical local/);
    assert.match(p, /ONE concrete thing/);
    assert.match(p, /dental practice/);
  });

  it('is skipped offline, so tests and keyless runs cost nothing', async () => {
    let called = false;
    const llm = { offline: true, completeJson: async () => ((called = true), { stops: false }) };
    assert.equal(await scrollTest(llm as never, 'x', 'cafe'), null);
    assert.equal(called, false);
  });

  it('never blocks a draft on a failure or a bad reply', async () => {
    const boom = { completeJson: async () => { throw new Error('overloaded'); } };
    assert.equal(await scrollTest(boom as never, 'x', 'cafe'), null);
    const odd = { completeJson: async () => ({ caption: 'not a verdict' }) };
    assert.equal(await scrollTest(odd as never, 'x', 'cafe'), null);
  });

  it('turns a fail into one line of feedback and a pass into none', () => {
    assert.equal(scrollFeedback({ stops: true }), null);
    assert.equal(scrollFeedback(null), null);
    assert.match(scrollFeedback({ stops: false, problem: 'Say what to order.' })!, /scroll past this: Say what to order/);
  });
});
