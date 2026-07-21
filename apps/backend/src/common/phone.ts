/**
 * One spelling of a phone number, everywhere.
 *
 * Every number that enters the system — Twilio's webhook, the signup form, the
 * admin page, the simulator — has to end up as the same string, because we look
 * customers up by exact match on it. Before this existed, one owner's number was
 * sitting in the database three ways (`+14244098341`, `+4244098341`,
 * `42440989341`) and each spelling was a separate customer. The failure is
 * invisible and lands mid-conversation: an owner texts in, we don't recognise
 * the number, and they get dropped into a fresh onboarding.
 *
 * Handled is US-only today (TCPA, NANP, quiet hours), so this is deliberately a
 * NANP normalizer rather than a general one. It returns null instead of guessing
 * when it can't be confident — a rejected signup is recoverable, a silently
 * wrong number is not. If we ever sell outside the US, swap in libphonenumber-js
 * rather than widening the rules here.
 */

/** E.164 for the US/Canada: `+1` then exactly 10 digits. */
const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

/**
 * Normalize to E.164, or null if it isn't a number we can be sure about.
 *
 * Accepts the shapes people actually type — `(424) 409-8341`, `424-409-8341`,
 * `1 424 409 8341`, `+14244098341` — and the shape Twilio sends.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');

  // A leading "+" is a claim that the country code is already present, so we
  // hold it to that: it has to be a +1 number. Dropping the "+" and retrying as
  // a bare US number would turn a genuine 10-digit foreign number — Singapore's
  // +65 9123 4567, say — into an American one, which is precisely the kind of
  // silent guess this function exists to avoid.
  let national: string;
  if (trimmed.startsWith('+')) {
    if (digits.length !== 11 || !digits.startsWith('1')) return null;
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    national = digits.slice(1);
  } else {
    return null;
  }

  const e164 = `+1${national}`;
  // NANP forbids 0 or 1 as the first digit of an area code or an exchange, so
  // this also catches transposed and truncated typos.
  return NANP.test(e164) ? e164 : null;
}

/**
 * Same, but throws. For paths where a bad number is a bug rather than user
 * input we should be forgiving about.
 */
export function requirePhone(input: string | null | undefined): string {
  const normalized = normalizePhone(input);
  if (!normalized) throw new Error(`not a valid US phone number: ${String(input)}`);
  return normalized;
}
