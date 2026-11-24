import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ConciergeService } from './concierge.service';
import { OnboardingService, tallyTag, toldTotal } from './onboarding.service';
import { mergeFindings } from './business-research.service';

/**
 * Setup asks for the link first (Nov 2026). Before, a new owner answered all
 * seven questions even when their website already said what the business is,
 * how it talks, who it's for and what it sells. Now the link is read first,
 * what it turned up is read back for a quick correction, and only the rest is
 * asked: always the rules and how often to post, which no website can answer
 * safely. "No site" gets every question, as before.
 */

type Row = Record<string, any>;
const onboarding = new OnboardingService({} as never);

const emptyProfile = (): Row => ({
  businessType: null,
  voiceTone: null,
  targetCustomer: null,
  offers: [],
  dosAndDonts: [],
  postingFrequency: null,
  websiteUrl: null,
  brandColors: [],
  followUps: null,
  onboardingComplete: false,
});

function world(opts: { lookUp?: (profile: Row, customer: Row) => Row | null } = {}) {
  const profile = emptyProfile();
  const customer: Row = { id: 'c1', phone: '+13105550100', email: null, preferredChannel: 'sms', businessName: null };
  const messages: { direction: string; body: string; createdAt: Date }[] = [];
  let clock = Date.now();
  const stamp = () => new Date((clock += 1000));
  const text = (body: string) => void messages.push({ direction: 'outbound', body, createdAt: stamp() });
  let pendingLookup: Promise<unknown> | undefined;

  const camel: Record<string, string> = {
    business_type: 'businessType', voice_tone: 'voiceTone', target_customer: 'targetCustomer',
    offers: 'offers', dos_and_donts: 'dosAndDonts', posting_frequency: 'postingFrequency',
  };
  const prisma = {
    message: {
      count: async ({ where }: Row) => messages.filter((m) => m.direction === where.direction).length,
      findMany: async ({ where }: Row) =>
        messages
          .filter((m) => m.direction === where.direction && (!where.createdAt?.gt || m.createdAt > where.createdAt.gt))
          .slice()
          .reverse(),
    },
    conversation: { findUnique: async () => ({ pendingIntent: null }), update: async () => ({}) },
    brandProfile: {
      findUnique: async () => ({ ...profile }),
      update: async ({ data }: Row) => Object.assign(profile, data),
    },
    customer: { findUnique: async () => ({ ...customer }) },
  };
  const bus = {
    emit: async (t: Row) => {
      if (t.type === 'UPDATE_BRAND_PROFILE') {
        for (const [k, v] of Object.entries(t.payload.patch as Row)) {
          if (k === 'business_name') customer.businessName = v;
          else if (camel[k]) profile[camel[k]] = v;
        }
      }
      return { status: 'done' };
    },
  };
  const lookup = {
    pending: () => pendingLookup,
    lookUp: async () => {
      const found = opts.lookUp ? opts.lookUp(profile, customer) : null;
      pendingLookup = undefined;
      return found;
    },
  };
  const svc = new ConciergeService(
    prisma as never, bus as never, {} as never, {} as never, onboarding, lookup as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  (svc as any).reply = async (_to: string, _c: string, body: string) => text(body);
  (svc as any).notify = async (_id: string, body: string) => text(body);
  let after: Promise<void> | undefined;
  const realAfter = (svc as any).afterLookUp.bind(svc);
  (svc as any).afterLookUp = (...a: unknown[]) => {
    pendingLookup = Promise.resolve();
    return (after = realAfter(...a));
  };
  const answer = async (body: string) => {
    messages.push({ direction: 'inbound', body, createdAt: stamp() });
    await (svc as any).continueOnboarding('c1', customer.phone, 'conv1', body, { ...profile }, customer.businessName, 'pro');
    if (after) await after;
    after = undefined;
  };
  const sent = () => messages.filter((m) => m.direction === 'outbound').map((m) => m.body);
  return { svc, profile, customer, answer, sent, text, setPending: (p?: Promise<unknown>) => (pendingLookup = p) };
}

/** What a dentist's website gives the research pass. */
function dentistSite(profile: Row, customer: Row) {
  const merged = mergeFindings(profile as never, customer.businessName, {
    summary: 'Family dental office in Torrance.',
    offers: ['Membership plan from $33 a month', 'Whitening', 'Invisalign'],
    highlights: [],
    business_name: 'South Bay Dental Smiles',
    business_type: 'family dental office in Torrance',
    voice_tone: 'warm, reassuring, plain-spoken',
    target_customer: 'South Bay families, including nervous patients',
  });
  Object.assign(profile, merged.profile);
  Object.assign(customer, merged.customer);
  return { filled: merged.filled };
}

describe('setup asks for the link first', () => {
  it('opens with the link, before anything else, with no number yet', () => {
    assert.equal(onboarding.nextField(null), 'website');
    const hello = onboarding.welcome(null);
    assert.match(hello, /First: what's the business called, and do you have a website, Instagram or Google listing\?/);
    assert.match(hello, /only what I couldn't find/);
    assert.doesNotMatch(hello, /\d of \d|seven/);
    assert.match(onboarding.question('website', undefined, 'Rise Bakery'), /^First: does Rise Bakery have a website/);
  });

  it('numbers later questions against the shorter list', () => {
    assert.equal(tallyTag('dos_and_donts', { total: 3, remaining: 2 }), '2 of 3: ');
    assert.equal(tallyTag('posting_frequency', { total: 3, remaining: 1 }), '3 of 3: ');
    assert.equal(tallyTag('business_type'), '2 of 7: ', 'no tally: its place in the full list');
    assert.equal(toldTotal('Read up on you\n\n2 of 3: Anything I should always mention'), 3);
    assert.equal(toldTotal('What I’d show off: 2 of our best'), null);
  });
});

describe('what the link fills in', () => {
  it('fills only empty fields, never the rules or how often to post', () => {
    const m = mergeFindings(
      { businessType: 'dentist', voiceTone: null, targetCustomer: null, offers: ['Cleanings'] },
      'Bright Smiles',
      {
        summary: 's', offers: ['Whitening'], highlights: [],
        business_name: 'Something Else', business_type: 'dental office', voice_tone: 'warm', target_customer: null,
      },
    );
    assert.deepEqual(m.filled, { voice_tone: 'warm' }, "the owner's own words always win");
    assert.equal(m.profile.businessType, undefined);
    assert.equal(m.profile.offers, undefined);
    assert.deepEqual(m.customer, {});
    assert.ok(!('dosAndDonts' in m.profile) && !('postingFrequency' in m.profile));
  });

  it('reads back what it found and asks for corrections', () => {
    const t = onboarding.foundReadBack({ business_type: 'bakery in Pasadena', offers: ['sourdough', 'croissants'] });
    assert.match(t, /What you do: bakery in Pasadena/);
    assert.match(t, /What I'd show off: sourdough, croissants/);
    assert.match(t, /If any of that's off, just tell me/);
    assert.equal(onboarding.foundReadBack({}), '');
  });
});

describe('a new owner, start to finish', () => {
  it('with a website: link, read-back, then only the rules and how often', async () => {
    const w = world({ lookUp: dentistSite });
    w.text(onboarding.welcome(null));
    await w.answer('southbaydentalsmiles.com');
    const [, reading, found] = w.sent();
    assert.match(reading, /reading up on you now/);
    assert.doesNotMatch(reading, /\d of \d/, 'no question while it reads');
    assert.match(found, /Name: South Bay Dental Smiles/);
    assert.match(found, /What you do: family dental office in Torrance/);
    assert.match(found, /How you sound: warm, reassuring/);
    assert.match(found, /2 of 3: Anything I should always mention — or never mention\?/);
    assert.equal(w.profile.websiteUrl, 'https://southbaydentalsmiles.com');

    await w.answer('never promise pain-free');
    assert.match(w.sent().at(-1)!, /3 of 3: Last one — how often should I post\? Your plan includes 7 a week/);
  });

  it('with no site: every question, counted out of 7', async () => {
    const w = world();
    w.text(onboarding.welcome(null));
    await w.answer('no site');
    assert.equal(w.profile.websiteUrl, 'none');
    assert.match(w.sent().at(-1)!, /No problem.*2 of 7: Tell me about your business/s);
    await w.answer('taco truck in SLO called El Toro');
    assert.match(w.sent().at(-1)!, /3 of 7: How should your posts sound/);
  });

  it('when the link turns up nothing, says so and asks as usual', async () => {
    const w = world({ lookUp: () => null });
    w.text(onboarding.welcome(null));
    await w.answer('https://example.com');
    assert.match(w.sent().at(-1)!, /couldn't find much on that link.*2 of 7: Tell me about your business/s);
  });

  it('if they kept going while it read, only the findings follow, not a second question', async () => {
    let w!: ReturnType<typeof world>;
    w = world({
      lookUp: (p, c) => {
        w.text('Got it. 2 of 7: Tell me about your business');
        return dentistSite(p, c);
      },
    });
    w.text(onboarding.welcome(null));
    await w.answer('southbaydentalsmiles.com');
    const last = w.sent().at(-1)!;
    assert.match(last, /Here's what I found/);
    assert.doesNotMatch(last, /\d of \d/);
  });

  it('a bare "ok" while it reads gets a word, not a stored answer', async () => {
    const w = world();
    w.text(onboarding.welcome(null));
    w.setPending(new Promise(() => {}));
    await w.answer('ok');
    assert.match(w.sent().at(-1)!, /Still reading up on you/);
    assert.equal(w.profile.businessType, null);
  });
});
