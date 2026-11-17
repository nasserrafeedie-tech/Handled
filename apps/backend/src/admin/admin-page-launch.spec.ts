import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

describe('admin page launch check', () => {
  it('shows the key check from /health/launch, with the token header and no values', async () => {
    const { ADMIN_PAGE_HTML: html } = await import('./admin-page');
    assert.match(html, /id="launch"/);
    assert.match(html, /api\('\/health\/launch'\)/);
    assert.match(html, /Missing/);
  });
});
