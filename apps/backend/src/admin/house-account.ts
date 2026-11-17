import type { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/phone';

/**
 * Handled's own account: the product runs Handled's Instagram the way it runs
 * any customer's. It plans the week, drafts and designs the posts, texts each
 * one to the owner's phone for a yes, and publishes after that yes.
 *
 * It is a normal customer row with three differences. It is marked paid
 * without a Stripe charge (HOUSE_STRIPE_ID), it is left out of MRR and
 * customer counts, and its profile is filled in from the site's own copy, so
 * there is no interview.
 */
export const HOUSE_STRIPE_ID = 'house_handled';

/** Prisma filter that leaves the house account out of business numbers. */
export const NOT_HOUSE = {
  OR: [{ stripeCustomerId: null }, { stripeCustomerId: { not: HOUSE_STRIPE_ID } }],
};

export const HOUSE_PROFILE = {
  businessType: 'done-for-you social media service for local small businesses, run entirely over text',
  voiceTone: 'warm, plain-spoken and a little dry; talks like a helpful neighbour who happens to be good at this, never like a marketer',
  targetCustomer:
    'owners of local service businesses (barbers, groomers, cafes, dentists, salons) who know they should post but never have the time',
  offers: [
    'Starter $95/mo: 3 posts a week, written and posted for you',
    'Growth $349/mo: 5 posts a week plus designed carousels',
    'Pro $699/mo: a post every day plus reels cut from your own clips',
    'Free taste: text us your business and get a post written on the spot',
    'You approve every post by replying yes; nothing posts without it',
  ],
  dosAndDonts: [
    'Do show the product working: real drafts, real text threads, before and after feeds',
    'Do say plainly that every post needs the owner’s yes',
    'Do not invent testimonials, customer names, follower counts or results',
    'Do not claim guaranteed growth or quote engagement numbers we have not measured',
    'Do not knock named competitors or agencies by name',
  ],
  blackoutTopics: ['politics', 'religion'],
  postingFrequency: 5,
  // The site's palette: wax-seal red on cream stock with espresso ink.
  brandColors: ['#8C2F39', '#EFE7D8', '#1A140D'],
  visualStyle: 'editorial',
  websiteUrl: 'https://texthandled.com',
  businessResearch:
    'From texthandled.com: "Your social media, handled." Every week Handled writes and designs the posts and texts them to the owner, who replies yes between customers. ' +
    'An agency charges about $1,500 a month for the same job. Plans: Starter $95/mo (3 a week), Growth $349/mo (5 a week plus carousels), Pro $699/mo (daily plus reels). ' +
    'Owners can try it free by texting their business and getting a post back on the spot.',
  // Each becomes its own slot in the next weekly plans (plan-week assigns
  // postRequests in order), so the first weeks sell by showing.
  postRequests: [
    'how it works in three texts: you get a draft, you reply yes, it posts',
    'this post was planned, written and designed over text, and approved with one word',
    'the free taste: text us what your business is and get a post written on the spot',
    'what an agency charges for a month of posts compared with Handled from $95',
    'a week of posts for a local barbershop, start to finish, from a few replies',
  ],
  onboardingComplete: true,
};

export type HouseSetup =
  | { error: 'bad_phone' | 'phone_in_use'; detail: string }
  | { created: boolean; customerId: string; phone: string };

/**
 * Creates or refreshes the house account on the owner's phone. Approvals go to
 * that phone by text, so it must be a real number that isn't already a
 * paying customer's.
 */
export async function setUpHouseAccount(prisma: PrismaService, rawPhone: string): Promise<HouseSetup> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { error: 'bad_phone', detail: `"${rawPhone}" is not a phone number we can text.` };

  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing?.stripeCustomerId && existing.stripeCustomerId !== HOUSE_STRIPE_ID) {
    return {
      error: 'phone_in_use',
      detail: `${phone} already belongs to a paying customer (${existing.businessName ?? existing.id}). Use another number for the Handled account.`,
    };
  }
  // A number can hold only one account. If the house account already lives on
  // another number, move it rather than make a second one.
  const house = await prisma.customer.findFirst({ where: { stripeCustomerId: HOUSE_STRIPE_ID } });
  if (house && house.phone !== phone && existing) {
    return { error: 'phone_in_use', detail: `${phone} already has an account. Use another number, or remove that one first.` };
  }

  const fields = {
    businessName: 'Handled',
    planTier: 'pro',
    status: 'active' as const,
    pausedReason: null,
    stripeCustomerId: HOUSE_STRIPE_ID,
    timezone: 'America/Los_Angeles',
    trustLevel: 'approve_all' as const,
    freeDraftUsedAt: new Date(),
  };
  const customer = house
    ? await prisma.customer.update({ where: { id: house.id }, data: { ...fields, phone } })
    : existing
      ? await prisma.customer.update({ where: { id: existing.id }, data: fields })
      : await prisma.customer.create({ data: { ...fields, phone, conversation: { create: {} }, brandProfile: { create: {} } } });

  await prisma.brandProfile.upsert({
    where: { customerId: customer.id },
    create: { customerId: customer.id, ...HOUSE_PROFILE },
    update: HOUSE_PROFILE,
  });
  await prisma.conversation.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id }, update: {} });

  return { created: !house && !existing, customerId: customer.id, phone };
}
