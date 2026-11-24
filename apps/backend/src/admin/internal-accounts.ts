import { NOT_HOUSE } from './house-account';

/**
 * Accounts we made ourselves and are not customers: Handled's own account and
 * the demo accounts (demo-week.ts). They are left out of customer counts, MRR
 * and the owner-approval queue, so a demo week never reads as seven customers'
 * drafts waiting on a yes.
 */
export const DEMO_STRIPE_PREFIX = 'demo_';

/** Prisma filter that leaves demo accounts out. */
export const NOT_DEMO = {
  OR: [{ stripeCustomerId: null }, { NOT: { stripeCustomerId: { startsWith: DEMO_STRIPE_PREFIX } } }],
};

/** Neither the house account nor a demo. */
export const NOT_INTERNAL = { AND: [NOT_HOUSE, NOT_DEMO] };
