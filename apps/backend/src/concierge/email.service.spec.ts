import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { renderHtml } from './email.service';

/**
 * The HTML email body carries owner- and model-authored text, so escaping is a
 * security property, not a nicety: unescaped text is an injection into every
 * inbox we send to.
 */
describe('email HTML rendering', () => {
  it('escapes HTML so text can never inject markup', () => {
    const out = renderHtml('<script>alert(1)</script> & "quotes"');
    assert.ok(!out.includes('<script>'), 'raw script tag reached the HTML');
    assert.ok(out.includes('&lt;script&gt;'), 'angle brackets not escaped');
    assert.ok(out.includes('&amp;'), 'ampersand not escaped');
  });

  it('turns a link into a clickable anchor', () => {
    const out = renderHtml('Watch it: https://pub.r2.dev/x/reel.mp4');
    assert.match(out, /<a href="https:\/\/pub\.r2\.dev\/x\/reel\.mp4"/);
  });

  it('carries the unsubscribe line', () => {
    assert.match(renderHtml('hi'), /STOP/);
  });

  it('preserves line breaks as <br>', () => {
    assert.match(renderHtml('line one\nline two'), /line one<br>line two/);
  });
});
