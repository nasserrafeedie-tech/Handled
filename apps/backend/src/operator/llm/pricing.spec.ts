import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  costOf,
  formatCost,
  isKnownModel,
  MODEL_RATES,
  totalCost,
  type TokenCounts,
} from './pricing';

const counts = (over: Partial<TokenCounts> = {}): TokenCounts => ({
  model: 'claude-haiku-4-5',
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...over,
});

describe('costOf', () => {
  it('prices input at the published rate', () => {
    // 1M Haiku input tokens at $1.00.
    assert.equal(costOf(counts({ inputTokens: 1_000_000 })), 1.0);
  });

  it('prices output at the published rate', () => {
    assert.equal(costOf(counts({ outputTokens: 1_000_000 })), 5.0);
  });

  it('charges the cheaper rate for cached reads', () => {
    // The whole reason the service caches the brand profile.
    const fresh = costOf(counts({ inputTokens: 1_000_000 }));
    const cached = costOf(counts({ cacheReadTokens: 1_000_000 }));
    assert.ok(cached < fresh, 'a cache read must be cheaper than fresh input');
    assert.equal(cached, 0.1);
  });

  it('charges a premium for writing the cache', () => {
    assert.ok(costOf(counts({ cacheWriteTokens: 1_000_000 })) > costOf(counts({ inputTokens: 1_000_000 })));
  });

  it('adds every component together', () => {
    const c = costOf(
      counts({
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      }),
    );
    assert.ok(Math.abs(c - (1.0 + 5.0 + 0.1 + 1.25)) < 1e-9);
  });

  it('prices Sonnet above Haiku for identical usage', () => {
    const usage = { inputTokens: 100_000, outputTokens: 10_000 };
    assert.ok(
      costOf(counts({ ...usage, model: 'claude-sonnet-5' })) >
        costOf(counts({ ...usage, model: 'claude-haiku-4-5' })),
    );
  });

  it('assumes the worst for a model it does not know', () => {
    // Erring cheap would report a healthy margin that might not exist.
    const unknown = costOf(counts({ model: 'some-future-model', inputTokens: 1_000_000 }));
    const known = costOf(counts({ model: 'claude-haiku-4-5', inputTokens: 1_000_000 }));
    assert.ok(unknown > known, 'an unknown model must not be priced optimistically');
    assert.equal(unknown, Math.max(...Object.values(MODEL_RATES).map((r) => r.input)));
  });

  it('costs nothing when nothing was used', () => {
    assert.equal(costOf(counts()), 0);
  });
});

describe('totalCost', () => {
  it('sums a set of calls', () => {
    const rows = [
      counts({ inputTokens: 1_000_000 }),
      counts({ outputTokens: 1_000_000 }),
    ];
    assert.equal(totalCost(rows), 6.0);
  });

  it('is zero for no calls', () => {
    assert.equal(totalCost([]), 0);
  });

  it('reflects a realistic month for one customer', () => {
    // ~12 drafts, each caching a brand profile and writing a caption.
    const month = Array.from({ length: 12 }, () =>
      counts({ inputTokens: 800, outputTokens: 400, cacheReadTokens: 2_000 }),
    );
    const c = totalCost(month);
    // Sanity, not a fixed expectation: a month of drafting should be cents,
    // not dollars. If this ever fails the margin assumption needs revisiting.
    assert.ok(c > 0 && c < 0.5, `a month of drafting cost $${c}`);
  });
});

describe('formatCost', () => {
  it('does not round a real cost down to nothing', () => {
    // "$0.00" across the table would read as free and hide the real number.
    assert.equal(formatCost(0.004), '<$0.01');
  });

  it('shows exact zero as zero', () => {
    assert.equal(formatCost(0), '$0');
  });

  it('shows ordinary amounts to the cent', () => {
    assert.equal(formatCost(1.234), '$1.23');
    assert.equal(formatCost(12), '$12.00');
  });
});

describe('isKnownModel', () => {
  it('recognises the models this service routes between', () => {
    assert.ok(isKnownModel('claude-haiku-4-5'));
    assert.ok(isKnownModel('claude-sonnet-5'));
  });

  it('flags anything else so a fallback rate is visible', () => {
    assert.ok(!isKnownModel('gpt-something'));
  });
});
