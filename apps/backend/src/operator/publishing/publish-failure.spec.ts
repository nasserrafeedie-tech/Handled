import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  classifyPublishFailure,
  isRetryable,
  MAX_DETAIL,
  truncateDetail,
} from './publish-failure';

const classify = (msg: string) =>
  classifyPublishFailure(new Error(msg), 'Instagram', 'https://x.test/connect');

describe('classifyPublishFailure — auth', () => {
  const cases = [
    'Post for Me POST /v1/posts → 401 Unauthorized',
    'Error validating access token: session has been invalidated',
    'invalid_token: the token expired',
    'REVOKED_ACCESS_TOKEN',
    '403 Forbidden: insufficient scope',
  ];
  for (const msg of cases) {
    it(msg.slice(0, 45), () => {
      const f = classify(msg);
      assert.equal(f.kind, 'auth');
      assert.equal(isRetryable(f.kind), false, 'auth failures must not be retried');
      assert.match(f.ownerMessage ?? '', /disconnected/);
    });
  }

  it('tells the owner their post is waiting, not lost', () => {
    // The fear on seeing "your post failed" is that the work is gone.
    assert.match(classify('401').ownerMessage ?? '', /waiting rather than lost/);
  });

  it('includes the reconnect link when there is one', () => {
    assert.match(classify('401').ownerMessage ?? '', /https:\/\/x\.test\/connect/);
  });

  it('still reads properly without a link', () => {
    const f = classifyPublishFailure(new Error('401'), 'Instagram');
    assert.ok(!/undefined/.test(f.ownerMessage ?? ''));
    assert.match(f.ownerMessage ?? '', /say the word/);
  });
});

describe('classifyPublishFailure — content', () => {
  const cases = [
    'caption too long: 2400 characters',
    'Invalid aspect ratio, must be between 4:5 and 1.91:1',
    'Photos should be smaller than 4 MB',
    'unsupported media format',
    'duplicate photos detected',
    'post violates community standards',
  ];
  for (const msg of cases) {
    it(msg.slice(0, 45), () => {
      const f = classify(msg);
      assert.equal(f.kind, 'content');
      assert.equal(isRetryable(f.kind), false, 'identical bytes get an identical refusal');
      assert.ok(f.ownerMessage, 'the owner should hear about a rejected post');
    });
  }
});

describe('classifyPublishFailure — transient', () => {
  const cases = [
    '429 rate_limit_exceeded',
    '503 Service Unavailable',
    'ETIMEDOUT connecting to graph.facebook.com',
    'temporarily unavailable, please try again',
  ];
  for (const msg of cases) {
    it(msg.slice(0, 45), () => {
      const f = classify(msg);
      assert.equal(f.kind, 'transient');
      assert.equal(isRetryable(f.kind), true);
      assert.equal(f.ownerMessage, null, 'a self-healing problem should stay quiet');
    });
  }
});

describe('classifyPublishFailure — precedence and defaults', () => {
  it('reads a 401 that also mentions a rate limit as auth', () => {
    // Retrying would never fix it, so the auth reading has to win.
    assert.equal(classify('401 Unauthorized (rate limit also exceeded)').kind, 'auth');
  });

  it('defaults an unrecognised failure to transient rather than abandoning it', () => {
    const f = classify('something nobody has seen before');
    assert.equal(f.kind, 'transient');
    assert.equal(isRetryable(f.kind), true);
  });

  it('handles a non-Error thrown value', () => {
    const f = classifyPublishFailure('plain string failure', 'TikTok');
    assert.equal(f.kind, 'transient');
    assert.equal(f.detail, 'plain string failure');
  });

  it('uses the platform name the owner knows', () => {
    const f = classifyPublishFailure(new Error('401'), 'TikTok');
    assert.match(f.ownerMessage ?? '', /TikTok/);
  });
});

describe('truncateDetail', () => {
  it('leaves a short message alone', () => {
    assert.equal(truncateDetail('short failure'), 'short failure');
  });

  it('caps a full HTML error page', () => {
    // Platform errors routinely echo the request body or a whole error page.
    const huge = '<html>' + 'x'.repeat(50_000) + '</html>';
    const out = truncateDetail(huge);
    assert.ok(out.length <= MAX_DETAIL, `got ${out.length}`);
    assert.ok(out.endsWith('…'));
  });

  it('flattens newlines so one failure is one log line', () => {
    assert.equal(truncateDetail('line one\n\tline two'), 'line one line two');
  });

  it('is applied to the stored detail, not just available separately', () => {
    const f = classifyPublishFailure(new Error('y'.repeat(50_000)), 'Instagram');
    assert.ok(f.detail.length <= MAX_DETAIL, `stored ${f.detail.length} chars`);
  });
});
