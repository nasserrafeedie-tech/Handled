/**
 * What the last second of a reel says. It used to be the same for everyone,
 * "We saved you a spot." over a "Visit us" button, which tells a viewer who
 * just watched the whole reel nothing about where to go. The end card is the
 * one frame whose only job is the next step, so it names one: the shop's own
 * site when the owner gave one, and a button that fits how this kind of
 * business is actually used (you book a barber, you drop by a café).
 */

/** Appointment businesses: the next step is booking, not walking in. */
const BOOKED =
  /barber|salon|hair|nail|spa|massage|dent|ortho|clinic|chiro|physio|therap|groom|vet|tattoo|lash|brow|wax|facial|esthetic|studio|fitness|gym|yoga|pilates|trainer|tutor|lesson|photograph|clean|plumb|electric|repair|mechanic|auto|landscap|contractor/i;
/** Food and drink: you drop by, even a "coffee studio". */
const FOOD = /caf|coffee|bak|restaurant|pizza|taco|deli|\bbar\b|brew|\btea\b|juice|ice cream|donut|bistro|diner/i;
/** Shops: a visit, unless the shop is one you book ("barbershop", "nail shop"). */
const RETAIL = /boutique|shop|store|market|florist|gallery/i;

export interface EndCardCopy {
  headline: string;
  body: string;
  ctaLabel: string;
}

/**
 * The site's host, readable on a phone ("sharpandco.com"), or undefined when
 * the owner said they have no site or gave something that isn't a web address.
 */
export function displayHost(websiteUrl?: string | null): string | undefined {
  const raw = (websiteUrl ?? '').trim();
  if (!raw || raw.toLowerCase() === 'none') return undefined;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    // A bare word ("instagram", "n/a") parses as a host with no dot.
    if (!host.includes('.') || host.length > 32) return undefined;
    // Social profiles are better named by the handle the reel already shows.
    if (/(^|\.)(instagram|facebook|tiktok|linktr)\./.test(host)) return undefined;
    return host;
  } catch {
    return undefined;
  }
}

export function endCardCopy(opts: {
  businessName?: string | null;
  businessType?: string | null;
  websiteUrl?: string | null;
}): EndCardCopy {
  const type = opts.businessType ?? '';
  const booked = BOOKED.test(type) && !FOOD.test(type);
  const visited = !booked && (FOOD.test(type) || RETAIL.test(type));
  const host = displayHost(opts.websiteUrl);
  const ctaLabel = booked ? 'Book now' : visited ? 'Come by' : 'Visit us';
  const body = host ?? (booked ? 'Book your spot today.' : visited ? 'See you soon.' : 'We saved you a spot.');
  return { headline: opts.businessName?.trim() || 'Come see us', body, ctaLabel };
}
