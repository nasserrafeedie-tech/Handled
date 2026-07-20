import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { BrandProfile } from '@prisma/client';
import type { UpdateBrandProfilePayload } from '@smm/contracts';
import { LlmService } from '../operator/llm/llm.service';

/**
 * §6 onboarding as a checklist of profile fields, NOT a step counter — so an
 * hours-long gap resumes cleanly at the next empty field, and one answer that
 * fills several fields skips ahead. The Concierge asks one question per text.
 *
 * This module owns three things: *which* field to ask about next, the human
 * phrasing of each question, and *interpreting* the owner's answer into a
 * brand-profile patch. Interpretation runs through Haiku when a key is set
 * (one answer may fill several fields at once); offline it falls back to
 * deterministic per-field parsing so the whole flow works for free.
 *
 * Hard-won rules from live testing (July 2026): every detail the owner gives
 * must land somewhere real (a business NAME goes to business_name, "teal" goes
 * to brand_colors — never stuffed into voice_tone); the interview must
 * acknowledge what it captured; and it must read the profile back at the end
 * so a wrong guess gets caught while the owner is still paying attention.
 */

export type ProfileField =
  | 'business_type'
  | 'voice_tone'
  | 'target_customer'
  | 'offers'
  | 'dos_and_donts'
  | 'posting_frequency';

type Patch = UpdateBrandProfilePayload['patch'];

/** Fields required before we consider onboarding complete and plan week 1. */
const REQUIRED: ProfileField[] = [
  'business_type',
  'voice_tone',
  'target_customer',
  'offers',
  'posting_frequency',
];

/** What the LLM may return: any subset of patchable profile fields. */
const LlmPatch = z
  .object({
    business_name: z.string().max(120).optional(),
    business_type: z.string().max(200).optional(),
    voice_tone: z.string().max(300).optional(),
    target_customer: z.string().max(300).optional(),
    offers: z.array(z.string().max(200)).max(20).optional(),
    dos_and_donts: z.array(z.string().max(300)).max(20).optional(),
    brand_colors: z.array(z.string().max(24)).max(6).optional(),
    posting_frequency: z.number().int().min(1).max(21).optional(),
  })
  .strict();

/** "hi", "hey there", "start" — a greeting, not information. */
const GREETING =
  /^\s*(hi+|hey+( there)?|hello+|howdy|yo|sup|good (morning|afternoon|evening)|start|(i )?just signed up.?)\s*[!.…]*\s*$/i;

@Injectable()
export class OnboardingService {
  private readonly log = new Logger(OnboardingService.name);

  constructor(private readonly llm: LlmService) {}

  /** The next unanswered required field, or null when we can start posting. */
  nextField(profile: BrandProfile | null): ProfileField | null {
    if (!profile) return 'business_type';
    for (const field of REQUIRED) {
      if (this.isEmpty(profile, field)) return field;
    }
    return null;
  }

  isComplete(profile: BrandProfile | null): boolean {
    return this.nextField(profile) === null;
  }

  /** Is this first message just a hello, or does it actually say something? */
  isGreetingOnly(text: string): boolean {
    return GREETING.test(text) || text.trim().length < 12;
  }

  /** Would applying `patch` to `profile` finish the checklist? */
  wouldComplete(profile: BrandProfile | null, patch: Patch): boolean {
    const filled = (field: ProfileField): boolean => {
      switch (field) {
        case 'business_type':
          return Boolean(patch.business_type ?? profile?.businessType);
        case 'voice_tone':
          return Boolean(patch.voice_tone ?? profile?.voiceTone);
        case 'target_customer':
          return Boolean(patch.target_customer ?? profile?.targetCustomer);
        case 'offers':
          return (patch.offers ?? profile?.offers ?? []).length > 0;
        case 'dos_and_donts':
          return (patch.dos_and_donts ?? profile?.dosAndDonts ?? []).length > 0;
        case 'posting_frequency':
          return Boolean(patch.posting_frequency ?? profile?.postingFrequency);
      }
    };
    return REQUIRED.every(filled);
  }

  /** The welcome + question one, for a first contact that told us nothing yet. */
  welcome(): string {
    return (
      'Hey — this is Handled ✳ From here on out I plan, write, design, and ' +
      'post your social media, and you mostly just reply to my texts. ' +
      "First things first: tell me about your business — what do you do, " +
      "what's it called, and where are you?"
    );
  }

  /** One-question-per-text prompts. Kept short: this is SMS, not a form. */
  question(field: ProfileField): string {
    switch (field) {
      case 'business_type':
        return (
          "Tell me about your business — what do you do, what's it called, " +
          'and where are you?'
        );
      case 'voice_tone':
        return (
          'How should your posts sound? Describe it like a person — warm, ' +
          'playful, expert, luxe… If you\'re not sure, say "you pick" and ' +
          "I'll go warm-but-polished."
        );
      case 'target_customer':
        return 'Who are we trying to reach? Picture your favorite customer — who are they?';
      case 'offers':
        return 'What should I show off? Best sellers, services, specials — whatever you want more people seeing.';
      case 'dos_and_donts':
        return 'Anything I should always mention — or never mention?';
      case 'posting_frequency':
        return 'Last one: how often should I post? Most owners do 3–4 a week. Say a number, or "you pick".';
    }
  }

  /**
   * A short, specific acknowledgment of the details worth confirming —
   * "Got it — South Bay Dental Smiles, teal colors ✓" beats a silent jump to
   * the next question, and surfaces extraction mistakes while the owner is
   * still watching.
   */
  ack(patch: Patch): string {
    const bits: string[] = [];
    if (patch.business_name) bits.push(patch.business_name);
    if (patch.brand_colors?.length)
      bits.push(`${patch.brand_colors.join(' + ')} colors`);
    if (bits.length === 0) return 'Got it.';
    return `Got it — ${bits.join(', ')} ✓`;
  }

  /**
   * The end-of-interview read-back. The single cheapest way to catch a wrong
   * extraction: say what we heard while the owner is still in the thread.
   */
  summary(
    profile: BrandProfile,
    businessName: string | null | undefined,
  ): string {
    const lines = [
      `Here's what I've got ✳`,
      `${businessName ? `${businessName} — ` : ''}${profile.businessType ?? 'your business'}`,
      profile.voiceTone ? `Sound: ${profile.voiceTone}` : null,
      profile.targetCustomer ? `For: ${profile.targetCustomer}` : null,
      profile.offers.length
        ? `Showing off: ${profile.offers.join(', ')}`
        : null,
      // Derived palettes are hexes; only read back colors the owner SAID.
      profile.brandColors.some((c) => !c.startsWith('#'))
        ? `Colors: ${profile.brandColors.filter((c) => !c.startsWith('#')).join(', ')}`
        : null,
      `${profile.postingFrequency ?? 3} posts a week`,
    ].filter(Boolean);
    return `${lines.join('\n')}\n\nAnything wrong there, just tell me and I'll fix it.`;
  }

  /**
   * Interpret the owner's answer to `asked` into a profile patch.
   * With an Anthropic key: Haiku extracts every field the answer covers.
   * Offline (or on any LLM failure): deterministic parsing of just the asked
   * field, so onboarding always moves forward.
   */
  async interpret(
    asked: ProfileField,
    answer: string,
    profile: BrandProfile | null,
    businessName?: string | null,
  ): Promise<Patch> {
    const text = answer.trim();
    if (!text) return {};

    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (llmOn) {
      try {
        return await this.interpretWithLlm(asked, text, profile, businessName);
      } catch (err) {
        this.log.warn(`LLM interpret failed, falling back: ${String(err)}`);
      }
    }
    return this.interpretOffline(asked, text);
  }

  private async interpretWithLlm(
    asked: ProfileField,
    answer: string,
    profile: BrandProfile | null,
    businessName?: string | null,
  ): Promise<Patch> {
    const known = JSON.stringify({
      business_name: businessName ?? null,
      business_type: profile?.businessType ?? null,
      voice_tone: profile?.voiceTone ?? null,
      target_customer: profile?.targetCustomer ?? null,
      offers: profile?.offers ?? [],
      brand_colors: profile?.brandColors ?? [],
      posting_frequency: profile?.postingFrequency ?? null,
    });
    const patch = await this.llm.completeJson(
      {
        tier: 'bulk',
        cachedContext: [
          "You extract brand-profile fields from a small-business owner's SMS",
          'during onboarding. Return ONLY a JSON object. Keys you may use —',
          'definitions are strict:',
          '- business_name: the PROPER NAME of the business, only if the',
          '  owner states one. Owners type names in lowercase and drop the',
          '  word "called": "im a florist in pasadena, fieldnote florals" has',
          '  business_name "Fieldnote Florals" (title-case it).',
          '- business_type: what the business IS, including city/area if given',
          '  ("dental office in Torrance"). Not the name.',
          '- voice_tone: ONLY how the writing should sound — personality words',
          '  ("warm, playful, no slang"). NEVER colors, products, or audiences.',
          '- target_customer: who the posts should reach.',
          '- offers: string[] of concrete products/services/specials to promote.',
          '- dos_and_donts: string[] of standing rules the owner states.',
          '- brand_colors: string[] of color words/hexes the owner mentions',
          '  ("teal"). Colors are NEVER voice_tone.',
          '- posting_frequency: integer posts/week (1-21).',
          'Fill every field the answer genuinely covers, not just the one',
          'asked. If the owner accepts a suggestion ("yes", "sure", "you',
          'pick") for the asked field, use the suggested value. When unsure',
          'about a field, OMIT it — never guess. Only include information',
          'that is NEW in this answer: never re-emit a value already present',
          'in Current profile. No prose.',
        ].join('\n'),
        prompt:
          `Current profile: ${known}\n` +
          `Field asked about: ${asked}` +
          (asked === 'voice_tone'
            ? ' (suggested default: "warm but polished")'
            : '') +
          (asked === 'posting_frequency' ? ' (suggested default: 3)' : '') +
          `\nOwner's answer: """${answer}"""`,
        maxTokens: 400,
      },
      LlmPatch,
    );
    // An empty patch would stall the interview — fall back to offline parsing.
    return Object.keys(patch).length > 0
      ? patch
      : this.interpretOffline(asked, answer);
  }

  /** Free-mode parsing: fill exactly the field we asked about. */
  private interpretOffline(asked: ProfileField, answer: string): Patch {
    const agreed =
      /^\s*(y(es|ep|eah|up)?|sure|sounds good|that works|perfect|ok(ay)?|you pick|do (?:it|that))\b/i;
    switch (asked) {
      case 'business_type':
        return { business_type: answer.slice(0, 200) };
      case 'voice_tone':
        // A bare "yes"/"you pick" takes the suggestion; a longer agreement
        // ("yeah, but playful too") carries flavor — keep the owner's words.
        return {
          voice_tone:
            agreed.test(answer) && answer.length <= 24
              ? 'warm but polished'
              : answer.slice(0, 300),
        };
      case 'target_customer':
        return { target_customer: answer.slice(0, 300) };
      case 'offers':
        return { offers: splitList(answer).map((s) => s.slice(0, 200)) };
      case 'dos_and_donts':
        return { dos_and_donts: splitList(answer).map((s) => s.slice(0, 300)) };
      case 'posting_frequency': {
        const num = /(\d{1,2})\s*(?:x|times?|posts?|\/)?/i.exec(answer);
        let n = 3; // the suggested default
        if (/daily|every ?day/i.test(answer)) n = 7;
        else if (num) n = Number(num[1]);
        else if (!agreed.test(answer)) n = 3;
        return { posting_frequency: Math.max(1, Math.min(21, n)) };
      }
    }
  }

  private isEmpty(profile: BrandProfile, field: ProfileField): boolean {
    switch (field) {
      case 'business_type':
        return !profile.businessType;
      case 'voice_tone':
        return !profile.voiceTone;
      case 'target_customer':
        return !profile.targetCustomer;
      case 'offers':
        return profile.offers.length === 0;
      case 'dos_and_donts':
        return profile.dosAndDonts.length === 0;
      case 'posting_frequency':
        return !profile.postingFrequency;
    }
  }
}

/** "lattes, pastries and our patio" → ["lattes", "pastries", "our patio"] */
function splitList(answer: string): string[] {
  return answer
    .split(/,|\band\b|\n|;/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}
