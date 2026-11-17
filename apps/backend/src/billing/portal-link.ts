import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "update your card" link we text.
 *
 * The payment-failed and paused-for-billing texts used to say "update your
 * card" with nowhere to do it — the owner had to go hunting, and most never
 * would. Now the text carries a link to texthandled.com/billing/manage, which
 * opens Stripe's customer portal for exactly that customer.
 *
 * The portal can change the card and cancel the plan, so the link is a signed,
 * expiring token rather than the bare customer id. The signing key is derived
 * from STRIPE_SECRET_KEY: the portal only exists when Stripe does, and this
 * way there's no new secret for anyone to set.
 *
 * Pure functions, no DI — the Concierge builds links and BillingService checks
 * them, and the two modules can't import each other.
 */

/** Long enough to fix a card over a weekend; short enough to age out of a forwarded text. */
export const PORTAL_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function key(): string {
  return createHmac('sha256', process.env.STRIPE_SECRET_KEY ?? 'offline-dev')
    .update('handled-billing-portal-link-v1')
    .digest('hex');
}

function mac(payload: string): string {
  // 128 bits of HMAC is plenty for a week-long link, and keeps the texted
  // URL short enough to read (every character is SMS we pay for).
  return createHmac('sha256', key()).update(payload).digest().subarray(0, 16).toString('base64url');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID packs into 22 characters; anything else rides as plain base64url. */
function packId(id: string): string {
  return UUID.test(id)
    ? 'u' + Buffer.from(id.replace(/-/g, ''), 'hex').toString('base64url')
    : 's' + Buffer.from(id).toString('base64url');
}

function unpackId(packed: string): string | null {
  const body = packed.slice(1);
  if (packed[0] === 'u') {
    const hex = Buffer.from(body, 'base64url').toString('hex');
    if (hex.length !== 32) return null;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  if (packed[0] === 's') return Buffer.from(body, 'base64url').toString() || null;
  return null;
}

export function signPortalToken(customerId: string, now = Date.now()): string {
  const exp = Math.floor((now + PORTAL_LINK_TTL_MS) / 1000).toString(36);
  const head = `${packId(customerId)}.${exp}`;
  return `${head}.${mac(head)}`;
}

/** The customer id the token was issued for, or null if forged, garbled or expired. */
export function verifyPortalToken(token: string | undefined | null, now = Date.now()): string | null {
  if (!token || token.length > 300) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [packed, exp, sig] = parts;
  const want = Buffer.from(mac(`${packed}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const expMs = parseInt(exp, 36) * 1000;
  if (!Number.isFinite(expMs) || expMs < now) return null;
  return unpackId(packed);
}

export function portalLink(customerId: string): string {
  const site = (process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com').replace(/\/+$/, '');
  return `${site}/billing/manage?t=${signPortalToken(customerId)}`;
}
