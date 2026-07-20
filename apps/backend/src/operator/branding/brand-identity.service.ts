import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import type { BrandStyle } from '../graphics/slide-templates';
import { verticalFor } from '../llm/vertical-playbook';

/**
 * Gives every business its own look.
 *
 * This is the difference between a product and a template. Left alone, every
 * customer rendered with the same fallback navy in the same typeface, so a
 * barbershop in Detroit and a florist in Pasadena produced visually identical
 * feeds — which is exactly the moment an owner cancels.
 *
 * Identity is *derived, not asked*: the onboarding interview stays at five
 * questions, and we infer a palette and type personality from what the owner
 * already told us. Assigned once at the end of onboarding and then persisted,
 * so a brand looks the same every week — consistency is the whole point of a
 * brand, and a palette that drifted each Monday would be worse than a dull one.
 */

/** A curated look: nothing here is a default, and no two are close. */
interface Identity {
  primary: string;
  secondary: string;
  style: BrandStyle;
}

/**
 * Hand-picked pairings per category. Colours are chosen to sit well under the
 * scrim the graphics engine paints over photos, and the type personality is
 * matched to how the trade actually presents itself — a barbershop wants a
 * condensed poster face, a day spa wants airy roman capitals.
 */
const CATEGORIES: { match: RegExp; looks: Identity[] }[] = [
  {
    match: /coffee|cafe|café|espresso|roaster|tea ?house/i,
    looks: [
      { primary: '#6B3A24', secondary: '#E8B27D', style: 'bold' },
      { primary: '#4A3428', secondary: '#C9A227', style: 'editorial' },
      { primary: '#2F2A26', secondary: '#D98E5A', style: 'modern' },
    ],
  },
  {
    match: /bakery|baker|pastry|patisserie|bread|donut|cake/i,
    looks: [
      { primary: '#8B5A2B', secondary: '#F2D3A7', style: 'editorial' },
      { primary: '#7A4E3B', secondary: '#F0C987', style: 'luxe' },
    ],
  },
  {
    match: /flower|floral|florist|bouquet|garden|plant|nursery/i,
    looks: [
      { primary: '#2E4B3C', secondary: '#F0B429', style: 'luxe' },
      { primary: '#3B5D50', secondary: '#E4A0B7', style: 'editorial' },
    ],
  },
  {
    match: /barber|barbershop|men'?s grooming|shave/i,
    looks: [
      { primary: '#1F2933', secondary: '#C9A227', style: 'bold' },
      { primary: '#252220', secondary: '#B87333', style: 'bold' },
    ],
  },
  {
    match: /salon|hair|stylist|beauty|nail|lash|brow/i,
    looks: [
      { primary: '#4A2C4D', secondary: '#E0A9C4', style: 'luxe' },
      { primary: '#5C3A4E', secondary: '#DCC1A0', style: 'editorial' },
    ],
  },
  {
    match: /spa|massage|wellness|yoga|pilates|meditation|acupunct/i,
    looks: [
      { primary: '#3A5A55', secondary: '#C6B79B', style: 'luxe' },
      { primary: '#46564F', secondary: '#D8C3A5', style: 'luxe' },
    ],
  },
  {
    match: /gym|fitness|crossfit|training|athletic|boxing|martial/i,
    looks: [
      { primary: '#14213D', secondary: '#FCA311', style: 'bold' },
      { primary: '#1B1B1E', secondary: '#E63946', style: 'bold' },
    ],
  },
  {
    match: /restaurant|taqueria|taco|kitchen|bistro|diner|pizza|grill|bbq|sushi|ramen/i,
    looks: [
      { primary: '#7C2D12', secondary: '#FBBF24', style: 'bold' },
      { primary: '#3F2A1D', secondary: '#E9B44C', style: 'editorial' },
    ],
  },
  {
    match: /bar|brewery|pub|taproom|winery|cocktail|distiller/i,
    looks: [
      { primary: '#22303C', secondary: '#C89F5E', style: 'editorial' },
      { primary: '#2B1F1A', secondary: '#D4A017', style: 'bold' },
    ],
  },
  {
    match: /book|shop|boutique|store|retail|gift|vintage|thrift/i,
    looks: [
      { primary: '#3D2C4F', secondary: '#DDA15E', style: 'editorial' },
      { primary: '#2C3E50', secondary: '#D4A574', style: 'editorial' },
    ],
  },
  {
    match: /studio|photo|design|art|gallery|maker|ceramic|craft/i,
    looks: [
      { primary: '#26282B', secondary: '#D9A566', style: 'modern' },
      { primary: '#343A40', secondary: '#B8C4A9', style: 'editorial' },
    ],
  },
  {
    match: /pet|dog|groom|veterinar|animal/i,
    looks: [
      { primary: '#2F4858', secondary: '#F6AE2D', style: 'modern' },
      { primary: '#3C6E71', secondary: '#E8C07D', style: 'modern' },
    ],
  },
];

/** Used when nothing matches — still distinct per business, never the same navy. */
const FALLBACK: Identity[] = [
  { primary: '#2C3E50', secondary: '#D4A574', style: 'editorial' },
  { primary: '#3A5A55', secondary: '#C6B79B', style: 'luxe' },
  { primary: '#1F2933', secondary: '#C9A227', style: 'bold' },
  { primary: '#4A2C4D', secondary: '#DCC1A0', style: 'modern' },
  { primary: '#7C2D12', secondary: '#FBBF24', style: 'bold' },
  { primary: '#26463B', secondary: '#E0B04A', style: 'editorial' },
];

const LlmStrategy = z
  .object({
    mix: z.string().max(400),
    ideas: z.array(z.string().max(200)).min(4).max(8),
    photo_asks: z.array(z.string().max(200)).min(2).max(4),
    reel_clips: z.array(z.string().max(200)).length(3),
    reel_hook: z.string().max(80),
  })
  .strict();

const LlmIdentity = z
  .object({
    business_name: z.string().max(60).optional(),
    style: z.enum(['modern', 'editorial', 'bold', 'luxe']).optional(),
  })
  .strict();

@Injectable()
export class BrandIdentityService {
  private readonly log = new Logger(BrandIdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /**
   * Assign a look once onboarding is complete. Idempotent: if colours are
   * already set we leave them alone, so a brand never shifts under the owner.
   */
  async assign(customerId: string): Promise<void> {
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    if (!profile) return;
    if (profile.brandColors.length >= 2 && profile.visualStyle) return;

    const description = [profile.businessType, profile.voiceTone]
      .filter(Boolean)
      .join(' — ');
    const identity = this.derive(description || customerId, customerId);

    // The business's actual name makes a far better footer than the sentence
    // they typed. Pull it out if we can; harmless if we can't.
    const name = await this.extractName(profile.businessType ?? '');

    // Owner-stated colors and name always win over derived ones — "teal"
    // said in onboarding must survive this step (bug caught in live testing).
    await this.prisma.brandProfile.update({
      where: { customerId },
      data: {
        ...(profile.brandColors.length > 0
          ? {}
          : { brandColors: [identity.primary, identity.secondary] }),
        visualStyle: identity.style,
      },
    });
    const existing = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { businessName: true },
    });
    if (name && !existing?.businessName) {
      await this.prisma.customer.update({
        where: { id: customerId },
        data: { businessName: name },
      });
    }
    this.log.log(
      `identity for ${customerId}: ${identity.primary}/${identity.secondary} ${identity.style}${name ? ` "${name}"` : ''}`,
    );

    // The customer's own strategy file: Claude reads their exact onboarding
    // words plus our researched playbook for their trade, and writes a plan
    // specific to THEM — the late-night taco truck gets a different file than
    // the brunch taqueria. One call, stored, reused every week.
    await this.synthesizeStrategy(customerId);
  }

  async synthesizeStrategy(customerId: string): Promise<void> {
    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (!llmOn) return; // playbook fallback covers free mode
    const profile = await this.prisma.brandProfile.findUnique({
      where: { customerId },
    });
    if (!profile || profile.contentStrategy) return; // once per customer
    const v = verticalFor(profile.businessType);
    try {
      const strategy = await this.llm.completeJson(
        {
          tier: 'voice',
          cachedContext:
            'You are a social media strategist for one specific local business. ' +
            'Write a content strategy from the owner\'s own words. Return ONLY ' +
            'JSON: {"mix": one-line weekly mix, "ideas": 6 post ideas specific ' +
            'to THIS business (use their offers, audience, and voice — never ' +
            'generic), "photo_asks": 3 photo requests for authentic moments, ' +
            '"reel_clips": exactly 3 clip requests forming one coherent reel, ' +
            '"reel_hook": on-screen hook under 60 chars}. Authentic beats ' +
            'polished; transformations and process win; sends and saves are ' +
            'the goal.',
          prompt:
            `Owner's words — business: "${profile.businessType}" · voice: ` +
            `"${profile.voiceTone}" · audience: "${profile.targetCustomer}" · ` +
            `offers: ${profile.offers.join('; ')}\n` +
            `Researched baseline for this trade (improve on it, don't copy):\n` +
            `mix: ${v.mix}\nideas: ${v.ideas.join(' | ')}\n` +
            `reel: ${v.reelClips.join(' → ')} (hook: ${v.reelHook})`,
          maxTokens: 900,
        },
        LlmStrategy,
      );
      await this.prisma.brandProfile.update({
        where: { customerId },
        data: { contentStrategy: strategy },
      });
      this.log.log(`bespoke strategy written for ${customerId}`);
    } catch (err) {
      this.log.warn(`strategy synthesis failed (playbook fallback): ${String(err)}`);
    }
  }

  /**
   * Pick a look. Three inputs, in order of authority:
   *   1. the trade decides the palette family (a spa is not a gym),
   *   2. the voice the owner described decides the type personality — they
   *      literally told us "fun and loud" or "calm", so ignoring it and
   *      hashing would be throwing away the best signal we have,
   *   3. a stable hash breaks the remaining tie, so two coffee shops on the
   *      same street don't come out as twins.
   */
  private derive(description: string, seed: string): Identity {
    const category = CATEGORIES.find((c) => c.match.test(description));
    const pool = category?.looks ?? FALLBACK;

    const wanted = styleFromVoice(description);
    const onVoice = wanted ? pool.filter((l) => l.style === wanted) : [];
    const chosen = onVoice.length
      ? onVoice[hash(seed) % onVoice.length]
      : {
          // Nothing in this trade's family carries that personality — keep the
          // family's colours (they suit the trade), take the voice's type.
          ...pool[hash(seed) % pool.length],
          ...(wanted ? { style: wanted } : {}),
        };

    // Two coffee shops that both said "warm and poetic" would otherwise land
    // on the identical look. Nudging hue and lightness by a seeded amount
    // makes the palette space continuous instead of a handful of presets:
    // still unmistakably a coffee shop, still never the shop down the street.
    return {
      ...chosen,
      // The background can move further than the accent: it's a large, low
      // saturation field where a small hue shift just reads as "a different
      // brand". Accents are the opposite — gold sits right next to green, so
      // shifting brass even 14° turns it acid. Move it a third as far.
      primary: tint(chosen.primary, hash(seed + ':p'), 1),
      secondary: tint(chosen.secondary, hash(seed + ':s'), 0.35),
    };
  }

  /** "a little coffee shop called Rosa's" → "Rosa's". */
  private async extractName(businessType: string): Promise<string | null> {
    // Subsequent words may start with & so "Fade & Co" survives intact.
    const direct = /\b(?:called|named)\s+([A-Z][\w'&.-]*(?:\s+[A-Z&][\w'&.-]*){0,3})/.exec(
      businessType,
    );
    if (direct) return direct[1].replace(/[,.]$/, '').trim();

    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (!llmOn) return null;
    try {
      const out = await this.llm.completeJson(
        {
          tier: 'bulk',
          cachedContext:
            'Extract the trading name of a business from how its owner described ' +
            'it. Return ONLY {"business_name": string}. If no proper name is ' +
            'stated, omit the key. Never invent one.',
          prompt: `Owner's description: """${businessType}"""`,
          maxTokens: 100,
        },
        LlmIdentity,
      );
      return out.business_name?.trim() || null;
    } catch {
      return null;
    }
  }
}

/**
 * Deterministically shift a colour a little — enough that two businesses in
 * the same trade are visibly distinct, not so far that a spa turns into a gym.
 * Hue moves at most ~14°, lightness ~5%.
 */
function tint(hex: string, seed: number, spread = 1): string {
  const { h, s, l } = hexToHsl(hex);
  const dh = (((seed % 25) - 12) / 360) * spread; // up to ±12°
  const dl = ((((seed >> 5) % 9) - 4) / 100) * spread; // up to ±4%
  const ds = ((((seed >> 9) % 9) - 4) / 100) * spread; // up to ±4%
  return hslToHex(
    (h + dh + 1) % 1,
    clamp(s + ds, 0.05, 0.95),
    clamp(l + dl, 0.08, 0.62),
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/**
 * Map how an owner described their vibe onto a type personality. Ordered so
 * the loudest signal wins when someone says something like "fun but elegant".
 */
function styleFromVoice(description: string): BrandStyle | null {
  const d = description.toLowerCase();
  if (/\b(loud|bold|fun|energetic|playful|punchy|cheeky|lively|hype|gritty|sharp|confident)\b/.test(d))
    return 'bold';
  if (/\b(calm|serene|gentle|soothing|restorative|quiet|soft|tranquil|zen|natural)\b/.test(d))
    return 'luxe';
  if (/\b(elegant|refined|classic|timeless|editorial|poetic|literary|romantic|artisanal)\b/.test(d))
    return 'editorial';
  if (/\b(clean|modern|minimal|simple|crisp|contemporary|straightforward)\b/.test(d))
    return 'modern';
  return null;
}

/** Small stable string hash — same business, same look, every week. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
