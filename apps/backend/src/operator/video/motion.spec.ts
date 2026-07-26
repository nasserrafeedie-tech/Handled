import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { pickBestWindow, parseMotionSamples, type MotionSample } from './motion';

/**
 * Motion analysis feeds the reel's dynamic cold-open. The window-picker is pure,
 * so its judgement — which moment stands out, and whether anything stands out at
 * all — is asserted here without a video fixture.
 */

const samples = (spec: Array<[number, number]>): MotionSample[] =>
  spec.map(([time, mafd]) => ({ time, mafd }));

describe('picking the most dynamic window', () => {
  it('finds the window over the burst of motion', () => {
    // Quiet, quiet, then a spike at ~1s.
    const s = samples([
      [0.0, 0.1], [0.2, 0.1], [0.4, 0.1], [0.6, 0.1],
      [1.0, 5.0], [1.2, 5.0], [1.4, 5.0],
      [2.0, 0.1], [2.2, 0.1],
    ]);
    const w = pickBestWindow(s, 0.6);
    assert.ok(w, 'a window should be found');
    assert.ok(Math.abs(w!.start - 1.0) < 1e-9, `opened at ${w!.start}, expected the spike at 1.0`);
    assert.ok(w!.ratio > 2, 'the spike should stand out from the baseline');
  });

  it('reports a low ratio when the footage is uniformly static', () => {
    // A talking head: motion is low and even, nothing stands out.
    const s = samples([
      [0, 0.5], [0.2, 0.5], [0.4, 0.5], [0.6, 0.5], [0.8, 0.5], [1.0, 0.5],
    ]);
    const w = pickBestWindow(s, 0.6);
    assert.ok(w, 'still returns a window');
    assert.ok(w!.ratio < 1.2, `ratio ${w!.ratio} — nothing should stand out`);
  });

  it('returns null without enough signal', () => {
    assert.equal(pickBestWindow(samples([[0, 1]]), 1), null);
    assert.equal(pickBestWindow([], 1), null);
  });
});

describe('parsing scdet metadata', () => {
  it('pairs each pts_time with its mafd', () => {
    const text = [
      'frame:0    pts:0    pts_time:0',
      'lavfi.scd.mafd=0.000',
      'lavfi.scd.score=0.000',
      'frame:1    pts:512  pts_time:0.0333333',
      'lavfi.scd.mafd=1.716',
      'lavfi.scd.score=1.689',
    ].join('\n');
    const out = parseMotionSamples(text);
    assert.equal(out.length, 2);
    assert.equal(out[1].mafd, 1.716);
    assert.ok(Math.abs(out[1].time - 0.0333333) < 1e-6);
  });
});
