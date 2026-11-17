import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { DesignerService, designPrompt } from './designer.service';
import { GraphicsService } from './graphics.service';

const gfx = new GraphicsService();
const theme = { primary: '#1F3A2E', secondary: '#D9A441', brandName: 'Sharp & Co', style: 'bold' as const };
const copy = { headline: 'Fresh fade Friday', body: 'Walk-ins welcome all day.' };

const GOOD =
  "<svg viewBox='0 0 1080 1350'><rect width='1080' height='1350' fill='#1F3A2E'/>" +
  "<text x='80' y='500' font-family='Anton' font-size='120' fill='#F4EFE6'>FRESH FADE FRIDAY</text></svg>";
const OFF_EDGE = GOOD.replace("font-size='120'", "font-size='300'");

function world(replies: Array<string | Error>) {
  const prompts: Array<{ tier: string; prompt: string }> = [];
  const llm = {
    completeJson: async (req: { tier: string; prompt: string }) => {
      prompts.push(req);
      const r = replies.shift();
      if (r instanceof Error) throw r;
      return { concept: 'type as the picture', svg: r ?? GOOD };
    },
  };
  return { svc: new DesignerService(llm as never, gfx), prompts };
}

const saved = { ...process.env };
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test';
  delete process.env.LLM_FAKE;
  delete process.env.DESIGN_POSTS;
});
afterEach(() => {
  for (const k of ['ANTHROPIC_API_KEY', 'LLM_FAKE', 'DESIGN_POSTS']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = { customerId: 'c1', role: 'graphic' as const, copy, theme };

describe('the post designer', () => {
  it('stays off without a real model, so offline runs keep the templates', async () => {
    process.env.LLM_FAKE = '1';
    const w = world([]);
    assert.equal(await w.svc.design(req), null);
    assert.equal(w.prompts.length, 0);
    process.env.LLM_FAKE = '0';
    process.env.DESIGN_POSTS = '0';
    assert.equal(w.svc.live(), false);
  });

  it('returns a rendered design on the design tier', async () => {
    const w = world([GOOD]);
    const d = await w.svc.design(req);
    assert.ok(d);
    assert.equal(d.png.subarray(1, 4).toString(), 'PNG');
    assert.match(d.drawnText, /FRESH FADE FRIDAY/);
    assert.equal(w.prompts[0].tier, 'design');
  });

  it('sends a turned-back design back with the reason, once', async () => {
    const w = world([OFF_EDGE, GOOD]);
    const d = await w.svc.design(req);
    assert.ok(d);
    assert.equal(w.prompts.length, 2);
    assert.match(w.prompts[1].prompt, /turned back: .*past the right margin/);
    assert.match(w.prompts[1].prompt, /font-size='300'/);
  });

  it('gives up after two misses or a failed call', async () => {
    const twice = world([OFF_EDGE, OFF_EDGE, GOOD]);
    assert.equal(await twice.svc.design(req), null);
    assert.equal(twice.prompts.length, 2);
    const down = world([new Error('overloaded')]);
    assert.equal(await down.svc.design(req), null);
  });

  it('tells the model the copy, the brand and the rules', () => {
    const p = designPrompt(
      { ...req, role: 'carousel_cover', slides: 5, businessType: 'barbershop', photo: 'data:x' },
      { copy: { ...copy, brandName: 'Sharp & Co' }, palette: ['#1F3A2E', '#D9A441'], photo: { dataUri: 'data:x', read: { focusY: 0.3, underWords: 0, overTop: 1 } } },
      { focusY: 0.3, underWords: 0, overTop: 1 },
    );
    assert.match(p, /cover of a 5-slide carousel/);
    assert.match(p, /Headline: Fresh fade Friday/);
    assert.match(p, /#1F3A2E, #D9A441/);
    assert.match(p, /headline face is Anton, set in capitals/);
    assert.match(p, /\{\{PHOTO\}\}/);
    assert.match(p, /30% of the way down/);
    assert.match(p, /no numbers, prices/);
  });
});
