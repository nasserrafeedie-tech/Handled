/**
 * Turning token counts into dollars.
 *
 * Kept separate from the recording of usage on purpose. Token counts are facts
 * and never change; prices do. Deriving cost at read time means a rate
 * correction fixes every number ever reported, past and future, instead of
 * leaving a trail of rows priced under an old assumption.
 *
 * Rates are per million tokens, in US dollars, and are the published list
 * prices for the models this service routes between.
 */

export interface ModelRate {
  input: number;
  output: number;
  /** Writing to the prompt cache costs a premium over fresh input. */
  cacheWrite: number;
  /** Reading from it is a fraction of it — the reason caching is worth doing. */
  cacheRead: number;
}

/**
 * Per million tokens.
 *
 * The cache multipliers are Anthropic's standard ones: a cache write is 1.25x
 * base input and a cache read is 0.1x. If a rate here is ever found to be
 * wrong, correcting it is the only change needed — nothing stored depends on
 * it.
 */
export const MODEL_RATES: Record<string, ModelRate> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-8': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  // The voice default. Half Fable 5.1's price, standard cache multipliers.
  'claude-opus-5': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-5-5': { input: 4.0, output: 20.0, cacheWrite: 5.0, cacheRead: 0.2 },
  // The design default. Its cache reads are 0.025x input, not 0.1x.
  'claude-fable-5-2': { input: 8.0, output: 40.0, cacheWrite: 10.0, cacheRead: 0.2 },
  // Prompts of 100K tokens or fewer, which is every call this service makes.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

/**
 * Used when a model id is not in the table — a new model, or one swapped in by
 * env var. Deliberately the most expensive rate we know: a cost estimate that
 * errs low is worse than useless, because it tells you the margin is fine when
 * it may not be.
 */
const UNKNOWN_MODEL_RATE: ModelRate = MODEL_RATES['claude-fable-5-2'];

export interface TokenCounts {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** What one call cost, in dollars. */
export function costOf(u: TokenCounts): number {
  const rate = MODEL_RATES[u.model] ?? UNKNOWN_MODEL_RATE;
  const perMillion =
    u.inputTokens * rate.input +
    u.outputTokens * rate.output +
    u.cacheReadTokens * rate.cacheRead +
    u.cacheWriteTokens * rate.cacheWrite;
  return perMillion / 1_000_000;
}

/** What a set of calls cost together. */
export function totalCost(rows: TokenCounts[]): number {
  return rows.reduce((sum, r) => sum + costOf(r), 0);
}

/**
 * Format for a human. Sub-cent amounts are the normal case for a single call,
 * and rounding those to "$0.00" would make the whole table read as free.
 */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0';
  if (dollars < 0.01) return `<$0.01`;
  return `$${dollars.toFixed(2)}`;
}

/** True when a model id has a real rate rather than the pessimistic fallback. */
export function isKnownModel(model: string): boolean {
  return model in MODEL_RATES;
}
