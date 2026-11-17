/**
 * What each plan bills per month, in whole US dollars.
 *
 * One table, read by everything that needs a price on the backend: revenue
 * metrics and the referral credit. If these drift apart, a "free month" stops
 * being one. Keep in step with the Stripe Price objects and the public plans
 * in apps/web/app/billing/page.tsx — Stripe Prices are immutable, so a price
 * change means new Price IDs in env AND an edit here, together.
 */
export const PLAN_MONTHLY_USD: Record<string, number> = {
  starter: 95,
  growth: 349,
  pro: 699,
};

/** A month of this plan in cents, or null for a tier we don't price. */
export function monthlyCents(planTier: string | null | undefined): number | null {
  const usd = PLAN_MONTHLY_USD[(planTier ?? '').toLowerCase()];
  return typeof usd === 'number' ? usd * 100 : null;
}
