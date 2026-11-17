import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { fakeSample } from './fake-sample';

describe('offline answers for any shape', () => {
  it('gives a value every schema accepts', () => {
    const S = z.object({
      slides: z.array(z.object({ kind: z.enum(['title', 'body']), headline: z.string().min(3).max(12), body: z.string().optional() })).min(3).max(6),
      score: z.number().int().min(1).max(10),
      tone: z.union([z.literal('warm'), z.literal('bold')]),
      notes: z.string().transform((s) => s.slice(0, 5)),
      flag: z.boolean().default(true),
      who: z.discriminatedUnion('t', [z.object({ t: z.literal('a'), n: z.string() }), z.object({ t: z.literal('b') })]),
    });
    const v = S.parse(fakeSample(S));
    assert.equal(v.slides.length, 3);
    assert.ok(v.slides[0].headline.length <= 12);
    assert.equal(v.score, 1);
  });
});
