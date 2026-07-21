import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { normalizePhone, requirePhone } from './phone';

describe('normalizePhone', () => {
  it('passes through what Twilio sends', () => {
    assert.equal(normalizePhone('+14244098341'), '+14244098341');
  });

  it('collapses the spellings that split one owner into three customers', () => {
    // The three records actually found in production, all the same number.
    assert.equal(normalizePhone('+14244098341'), '+14244098341');
    assert.equal(normalizePhone('4244098341'), '+14244098341');
    assert.equal(normalizePhone('14244098341'), '+14244098341');
  });

  it('accepts the shapes people type into a form', () => {
    for (const typed of [
      '(424) 409-8341',
      '424-409-8341',
      '424.409.8341',
      '1 424 409 8341',
      '+1 (424) 409-8341',
    ]) {
      assert.equal(normalizePhone(typed), '+14244098341', typed);
    }
  });

  it('strips stray whitespace rather than storing it', () => {
    // A leading space is how ` 15551230000` ended up in the database.
    assert.equal(normalizePhone('  424 409 8341  '), '+14244098341');
  });

  it('rejects wrong-length numbers instead of padding or truncating', () => {
    assert.equal(normalizePhone('42440989341'), null); // the typo'd 11-digit
    assert.equal(normalizePhone('424409834'), null); // one short
    assert.equal(normalizePhone('+4244098341'), null); // missing country code
  });

  it('rejects numbers NANP does not allow', () => {
    assert.equal(normalizePhone('0244098341'), null); // area code starts with 0
    assert.equal(normalizePhone('1244098341'), null); // area code starts with 1
    assert.equal(normalizePhone('4240098341'), null); // exchange starts with 0
    assert.equal(normalizePhone('4241098341'), null); // exchange starts with 1
  });

  it('rejects non-US numbers rather than mangling them into +1', () => {
    assert.equal(normalizePhone('+442071838750'), null);
    assert.equal(normalizePhone('+33142685300'), null);
  });

  it('handles empty and missing input', () => {
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone(null), null);
    assert.equal(normalizePhone(undefined), null);
    assert.equal(normalizePhone('not a phone'), null);
  });

  it('is idempotent — normalizing twice changes nothing', () => {
    const once = normalizePhone('(424) 409-8341');
    assert.equal(normalizePhone(once), once);
  });

  it('accepts the reserved-for-fiction numbers used for testing', () => {
    // Real fictional numbers are NXX-555-01XX: a real area code, the 555
    // exchange, and a line number in the reserved 0100-0199 block. The dev
    // simulator uses these so nothing can ever ring a real phone.
    assert.equal(normalizePhone('+14245550199'), '+14245550199');
    assert.equal(normalizePhone('+16265550101'), '+16265550101');
  });

  it('rejects 555-123-xxxx, which looks fake but is not a valid number', () => {
    // The dev simulator used to default to this. The 123 exchange is invalid
    // NANP, so it would never have survived a round-trip through Twilio.
    assert.equal(normalizePhone('+15551230099'), null);
  });
});

describe('requirePhone', () => {
  it('returns the normalized number', () => {
    assert.equal(requirePhone('424-409-8341'), '+14244098341');
  });

  it('throws on input it cannot be sure about', () => {
    assert.throws(() => requirePhone('nope'), /not a valid US phone number/);
  });
});
