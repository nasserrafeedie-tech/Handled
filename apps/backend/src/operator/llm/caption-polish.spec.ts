import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { capEmDashes, polishCaption } from './caption-polish';

const count = (s: string) => (s.match(/—/g) ?? []).length;

describe('capEmDashes', () => {
  it('leaves a caption with one em-dash alone', () => {
    const c = 'Rosa pulls shots at 6:45am — before anyone arrives.';
    assert.equal(capEmDashes(c), c);
  });

  it('leaves a caption with none alone', () => {
    const c = 'Open 7am to 4pm. The corner table is the good one.';
    assert.equal(capEmDashes(c), c);
  });

  it('caps a real generated caption at one', () => {
    // Taken from an actual generation during testing.
    const c =
      'Rosa pulls shots at 6:45am, before the first customer arrives. The beans—roasted eight blocks away—are still warm when they hit the portafilter.';
    const out = capEmDashes(c);
    assert.equal(count(out), 1);
    assert.match(out, /roasted eight blocks away, are still warm/);
  });

  it('never leaves more than one, however many it starts with', () => {
    const c = 'One — two — three — four — five.';
    assert.equal(count(capEmDashes(c)), 1);
  });

  it('never strands a subject in the previous sentence', () => {
    // The case that ruled out promoting extras to full stops: "are still warm"
    // has no subject of its own, so a period here breaks the sentence.
    const c = 'The beans—roasted eight blocks away—are still warm when they hit the portafilter.';
    const out = capEmDashes(c);
    assert.equal(count(out), 1);
    assert.ok(!/\.\s+[Aa]re still warm/.test(out), `stranded a subject: ${out}`);
  });

  it('keeps clause joins readable, accepting a splice over a broken sentence', () => {
    const c =
      'She grinds them fresh — the machine warms up in the dark — the light gets good at ten past seven.';
    const out = capEmDashes(c);
    assert.equal(count(out), 1);
    assert.match(out, /in the dark, the light gets good/);
  });

  it('does not touch hyphens in ordinary words', () => {
    const c = 'Half-price lattes, house-roasted beans, walk-ins welcome — all week.';
    assert.equal(capEmDashes(c), c);
  });

  it('handles empty input', () => {
    assert.equal(capEmDashes(''), '');
  });

  it('is idempotent', () => {
    const once = capEmDashes('a — b — c — d.');
    assert.equal(capEmDashes(once), once);
  });
});

describe('polishCaption', () => {
  it('applies the em-dash cap', () => {
    assert.equal(count(polishCaption('a — b — c.')), 1);
  });
});
