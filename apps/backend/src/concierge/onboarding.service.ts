import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { BrandProfile } from '@prisma/client';
import type { UpdateBrandProfilePayload } from '@smm/contracts';
import { LlmService } from '../operator/llm/llm.service';
import { NO_DOS_DONTS } from '../operator/llm/brand-context';

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
  | 'website'
  | 'voice_tone'
  | 'target_customer'
  | 'offers'
  | 'dos_and_donts'
  | 'posting_frequency';

/** Stored in websiteUrl when the owner says they have no web presence. */
export const NO_WEBSITE = 'none';

type Patch = UpdateBrandProfilePayload['patch'];

/**
 * Fields required before we consider onboarding complete and plan week 1.
 *
 * dos_and_donts is here on purpose: it is the one moment we ask what to always
 * or never mention, and for a food business that is where allergens, claims to
 * avoid, and off-limits topics get captured — before we ever post on their
 * behalf. Asked just before posting_frequency so "last one" stays true.
 */
const REQUIRED: ProfileField[] = [
  'business_type',
  // Right after "what are you": a link lets the research pass run in the
  // background WHILE the rest of the interview proceeds, so the findings are
  // ready by the time week one is planned.
  'website',
  'voice_tone',
  'target_customer',
  'offers',
  'dos_and_donts',
  'posting_frequency',
];

/** What the LLM may return: any subset of patchable profile fields, plus an
 *  optional follow-up question when the answer is too thin to act on. */
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
    website: z.string().max(300).optional(),
    clarify: z.string().max(200).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

/** Bespoke follow-ups Opus writes for THIS business at interview's end. */
const FollowUpsOut = z.object({
  questions: z.array(z.string().min(1).max(200)).max(3).default([]),
});

/** interpret() result: a profile patch, possibly with a follow-up question
 *  and/or a website answer (handled by the concierge, not the task bus). */
export type InterpretResult = Patch & { clarify?: string; website?: string };

/** "hi", "hey there", "start" — a greeting, not information. */
const GREETING =
  /^\s*(hi+|hey+( there)?|hello+|howdy|yo|sup|good (morning|afternoon|evening)|start|(i )?just signed up.?)\s*[!.…]*\s*$/i;

/**
 * "nope", "no nothing special", "not really", "can't think of any" — a real
 * answer that there are no standing rules. Tested against a comma-normalized
 * string (see `isNoRules`), so "no, nothing special" reads as one negation and
 * not as the rule "no". A substantive answer ("no peanuts, ever") is NOT this —
 * it carries a real directive after the "no".
 */
const NO_RULES =
  /^\s*(?:no+|nope|nah|none|not really|not at all|not much|no rules|nothing off limits?|all good|we'?re good|(?:no |not )?nothing(?: (?:special|much|really|in particular|comes to mind|i can think of))?|(?:no )?not that i can think of|can'?t think of (?:any|anything))\s*[.!]*\s*$/i;

/** A negation-only answer to "any rules?", tolerant of commas and spacing. */
function isNoRules(answer: string): boolean {
  const norm = answer.replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  return NO_RULES.test(norm);
}

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
    if (this.nextField(profile) !== null) return false;
    // Core checklist done. New signups then owe the bespoke follow-up round:
    // complete only once it ran and its queue drained. onboardingComplete
    // grandfathers customers who finished before follow-ups existed.
    if (!profile || profile.onboardingComplete) return true;
    const fu = profile.followUps as { pending?: string[] } | null;
    return fu != null && (fu.pending ?? []).length === 0;
  }

  /** Is this first message just a hello, or does it actually say something? */
  isGreetingOnly(text: string): boolean {
    // Match the greeting shape, or an all-but-empty message. The old `< 12`
    // length gate discarded real short business answers — "gym", "bakery",
    // "car wash" — as if they were greetings, re-asking and reading as not
    // listening. A genuine business name/type can be tiny; only a near-empty
    // token (a stray "k", "ok") is treated as a non-answer.
    return GREETING.test(text) || text.trim().length < 3;
  }

  /** Would applying `patch` to `profile` finish the checklist? */
  wouldComplete(profile: BrandProfile | null, patch: InterpretResult): boolean {
    const filled = (field: ProfileField): boolean => {
      switch (field) {
        case 'business_type':
          return Boolean(patch.business_type ?? profile?.businessType);
        case 'website':
          return Boolean(patch.website ?? profile?.websiteUrl);
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
    // Tester feedback (Nasser's mom, Aug 2026): say how long the tunnel is
    // BEFORE the first question. An interview with no stated bound reads as
    // "how many of these are coming?" — the count up front plus a running
    // "n of 7" on each question turns it into a short checklist being
    // ticked off.
    return (
      'Hey — this is Handled ✳ From here on out I plan, write, design, and ' +
      'post your social media, and you mostly just reply to my texts. ' +
      'Save me as a contact so you always know it\'s me: ' +
      'texthandled.com/contact\n\n' +
      'Setup is seven quick questions — plus one or two tailored to your ' +
      'answers at the end. A few minutes by text, then I get to work.\n\n' +
      this.question('business_type')
    );
  }

  /**
   * One-question-per-text prompts. Kept short: this is SMS, not a form.
   *
   * `postsCap` is the plan's posts-per-week allowance. When known, the cadence
   * question offers exactly that instead of a generic "3–4 a week" — a Starter
   * (cap 3) must not be invited to pick 4 and then be under-served or over-served.
   */
  question(field: ProfileField, postsCap?: number): string {
    // "n of 7:" on every prompt (tester feedback — Nasser's mom): the reader
    // always knows where they are in the tunnel. The number is the field's
    // checklist position, so a question skipped because the owner already
    // answered it early just advances the count — which reads as progress.
    const tag = `${REQUIRED.indexOf(field) + 1} of ${REQUIRED.length}: `;
    switch (field) {
      case 'business_type':
        return (
          `${tag}Tell me about your business — what do you do, what's it ` +
          'called, and where are you?'
        );
      case 'website':
        return (
          `${tag}Got a website, Instagram, or Google listing? Drop me a link ` +
          "and I'll go look you up so you don't have to type it all — or " +
          'say "no site".'
        );
      case 'voice_tone':
        return (
          `${tag}How should your posts sound? Describe it like a person — ` +
          'warm, playful, expert, luxe… If you\'re not sure, say "you pick" ' +
          "and I'll go warm-but-polished."
        );
      case 'target_customer':
        return `${tag}Who are we trying to reach? Picture your favorite customer — who are they?`;
      case 'offers':
        return `${tag}What should I show off? Best sellers, services, specials — whatever you want more people seeing.`;
      case 'dos_and_donts':
        return `${tag}Anything I should always mention — or never mention?`;
      case 'posting_frequency':
        return postsCap
          ? `${tag}Last one — how often should I post? Your plan includes ${postsCap} a week. ` +
              `Want all ${postsCap}, or fewer? Say a number, or "you pick".`
          : `${tag}Last one — how often should I post? Most owners do 3–4 a week. Say a number, or "you pick".`;
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
      // Standing rules are the one field where a wrong reading is dangerous —
      // an allergen we DON'T flag, a competitor we DO. Read it back too (but
      // never the "no rules" sentinel, which isn't a rule).
      (() => {
        const rules = profile.dosAndDonts.filter((r) => r !== NO_DOS_DONTS);
        return rules.length ? `Rules: ${rules.join('; ')}` : null;
      })(),
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
    postsCap?: number,
    /** May the model ask ONE follow-up? False once this field was already
     *  clarified, so a twice-vague owner gets best-effort, never a loop. */
    allowClarify = true,
  ): Promise<InterpretResult> {
    const text = answer.trim();
    if (!text) return {};

    // "no, nothing special" is a valid answer meaning no rules — settle it
    // before the LLM, which otherwise extracts the literal words ("no; nothing
    // special") and stores them as brand rules that then feed captions.
    if (asked === 'dos_and_donts' && isNoRules(text)) {
      return { dos_and_donts: [NO_DOS_DONTS] };
    }

    const patch = await this.interpretRaw(asked, text, profile, businessName, allowClarify);
    // Never store a cadence above what the plan sells. An owner who asks for 4
    // on Starter (cap 3) is capped to 3 here, at the source, so the planner and
    // every read-back downstream see the honest number.
    if (patch.posting_frequency && postsCap) {
      patch.posting_frequency = Math.min(patch.posting_frequency, postsCap);
    }
    return patch;
  }

  private async interpretRaw(
    asked: ProfileField,
    text: string,
    profile: BrandProfile | null,
    businessName?: string | null,
    allowClarify = true,
  ): Promise<InterpretResult> {
    const answer = text;
    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (llmOn) {
      try {
        return await this.interpretWithLlm(asked, text, profile, businessName, allowClarify);
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
    allowClarify = true,
  ): Promise<InterpretResult> {
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
        // 'voice' (Sonnet), not 'bulk' (Haiku). This runs a handful of times per
        // customer, once, at signup — and the profile it extracts is the
        // foundation every later strategy, plan, and caption is built on. A
        // dropped business name or city here ("Rise in Pasadena" → just
        // "bakery") propagates into everything. It is the highest-stakes,
        // lowest-volume LLM call in the system, so it gets the better model.
        // Drafting stays on 'bulk' — that runs several times a week forever.
        tier: 'voice',
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
          '- website: a URL the owner shares (their site, Instagram, or',
          '  Google listing — normalize to include https://). If they say',
          '  they have no site/page, the literal string "none".',
          'Fill every field the answer genuinely covers, not just the one',
          'asked. If the owner accepts a suggestion ("yes", "sure", "you',
          'pick") for the asked field, use the suggested value. When unsure',
          'about a field, OMIT it — never guess. Only include information',
          'that is NEW in this answer: never re-emit a value already present',
          'in Current profile. No prose.',
          '',
          'DISTILL, never transcribe. The owner talks like a person texting;',
          'you store clean profile data. Strip conversational filler ("well,',
          '"I guess", "all I have is") and rewrite each value as the crisp,',
          'concrete thing it names. "Well all I have is this service and',
          'there are 3 different tiers" → offers: ["The service (3 plan',
          'tiers)"]. "It should be polished, expert, but also like friendly"',
          '→ voice_tone: "polished, expert, friendly". Every stored value',
          'must read well when quoted back in a profile summary. Never store',
          'a sentence-shaped echo of the message.',
          '',
          'clarify: if posts written from this answer would come out generic',
          'or force the writer to GUESS, ALSO return "clarify" — one short,',
          'friendly follow-up question (under 160 chars) asking for the one',
          'missing detail. The canonical case: "we have 3 different tiers"',
          'without saying what the tiers ARE — store what was said AND ask',
          '"What are the three tiers — what does each one cover, roughly?".',
          'Most answers need no follow-up; a thin-but-usable answer is',
          'stored, not interrogated. Never more than one question.',
        ].join('\n'),
        prompt:
          `Current profile: ${known}\n` +
          `Field asked about: ${asked}` +
          (asked === 'voice_tone'
            ? ' (suggested default: "warm but polished")'
            : '') +
          (asked === 'posting_frequency' ? ' (suggested default: 3)' : '') +
          (allowClarify
            ? ''
            : '\nFollow-ups are NOT allowed for this answer — do not return ' +
              'clarify; store your best interpretation instead.') +
          `\nOwner's answer: """${answer}"""`,
        maxTokens: 400,
      },
      LlmPatch,
    );
    // The clarify budget is enforced here, not just requested: a model that
    // clarifies anyway after being told not to would loop the interview.
    if (!allowClarify) delete patch.clarify;
    // An empty patch would stall the interview — fall back to offline parsing.
    const { clarify, ...fields } = patch;
    return Object.keys(fields).length > 0 || clarify
      ? patch
      : this.interpretOffline(asked, answer);
  }

  /**
   * The bespoke round (§ adaptive onboarding): given everything we now know —
   * interview answers plus any web research — what are the 1-3 questions whose
   * answers would most change this business's posts? Generated fresh per
   * business, so a dentist is asked about insurance and a taco truck about its
   * schedule. Empty when the profile is already rich enough (or offline).
   */
  async generateFollowUps(
    profile: BrandProfile,
    businessName?: string | null,
  ): Promise<string[]> {
    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (!llmOn) return [];
    try {
      const { questions } = await this.llm.completeJson(
        {
          tier: 'voice',
          cachedContext: [
            'You just finished a short SMS onboarding interview with a small-',
            'business owner for a social-media service. Decide whether any',
            'follow-up questions are worth one more text each — questions',
            'SPECIFIC to this business whose answers would materially change',
            'what gets posted (a dentist: insurance accepted, new-patient',
            'offers; a taco truck: where and when to find it; a tiered',
            'service: what each tier includes).',
            'Rules:',
            '- 0 to 3 questions. Zero is a good answer when the profile and',
            '  research already cover it.',
            '- Never ask what the profile or research already answers.',
            '- Each question is one SMS: short, friendly, concrete.',
            '- No generic questions ("tell me more about your business").',
            'Return JSON: {"questions": string[]}',
          ].join('\n'),
          prompt:
            `Business: ${businessName ?? 'unnamed'}\n` +
            `Profile: ${JSON.stringify({
              businessType: profile.businessType,
              voiceTone: profile.voiceTone,
              targetCustomer: profile.targetCustomer,
              offers: profile.offers,
              dosAndDonts: profile.dosAndDonts,
            })}\n` +
            `Web research: ${profile.businessResearch ?? '(none)'}\n\n` +
            'Return the JSON.',
          maxTokens: 400,
        },
        FollowUpsOut,
      );
      return questions;
    } catch (err) {
      this.log.warn(`follow-up generation failed: ${String(err)}`);
      return [];
    }
  }

  /**
   * Distill a follow-up answer into profile fields and/or a research note.
   * Anything that fits a structured field goes there; the rest lands as a
   * note appended to businessResearch so the drafter still sees it.
   */
  async enrichFromFollowUp(
    question: string,
    answer: string,
    profile: BrandProfile | null,
    businessName?: string | null,
  ): Promise<{ patch: Patch; note?: string }> {
    const llmOn =
      Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1';
    if (!llmOn) return { patch: {}, note: `${question} — ${answer.slice(0, 300)}` };
    try {
      const { clarify: _c, website: _w, note, ...patch } = await this.llm.completeJson(
        {
          tier: 'voice',
          cachedContext: [
            "You distill a small-business owner's answer to a follow-up",
            'question into clean profile data. Use the same field definitions',
            'and DISTILL rules as onboarding extraction: offers are concrete',
            'noun phrases, dos_and_donts are standing rules, never store',
            'conversational filler. Anything factual that fits NO structured',
            'field goes into "note" — one tight sentence a caption writer can',
            'use. Only NEW information. Return ONLY JSON with any of:',
            'business_name, business_type, voice_tone, target_customer,',
            'offers[], dos_and_donts[], brand_colors[], posting_frequency,',
            'note.',
          ].join('\n'),
          prompt:
            `Current profile: ${JSON.stringify({
              businessType: profile?.businessType,
              offers: profile?.offers,
              dosAndDonts: profile?.dosAndDonts,
            })}\n` +
            `Question we asked: "${question}"\n` +
            `Owner's answer: """${answer}"""`,
          maxTokens: 400,
        },
        LlmPatch,
      );
      return { patch, note };
    } catch (err) {
      this.log.warn(`follow-up enrich failed: ${String(err)}`);
      return { patch: {}, note: `${question} — ${answer.slice(0, 300)}` };
    }
  }

  /** Free-mode parsing: fill exactly the field we asked about. */
  private interpretOffline(asked: ProfileField, answer: string): InterpretResult {
    const agreed =
      /^\s*(y(es|ep|eah|up)?|sure|sounds good|that works|perfect|ok(ay)?|you pick|do (?:it|that))\b/i;
    switch (asked) {
      case 'business_type':
        return { business_type: answer.slice(0, 200) };
      case 'website': {
        // A bare domain counts ("texthandled.com", "@handled" does not) —
        // normalize to https. Negative answers store the sentinel so the
        // checklist moves on and never re-asks.
        const url = /((?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+(?:\/\S*)?)/i.exec(answer);
        if (url) {
          const raw = url[1];
          return { website: raw.startsWith('http') ? raw : `https://${raw}` };
        }
        return isNoRules(answer) || /\bno\b|\bdon'?t\b|\bnope\b/i.test(answer)
          ? { website: NO_WEBSITE }
          : {};
      }
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
        // "nope", "not really", "cant think of any" — a real answer that the
        // owner has no standing rules. Mark it answered with the sentinel so
        // onboarding completes, rather than storing "nope" as a brand rule or
        // re-asking forever.
        return isNoRules(answer)
          ? { dos_and_donts: [NO_DOS_DONTS] }
          : { dos_and_donts: splitList(answer).map((s) => s.slice(0, 300)) };
      case 'posting_frequency': {
        const lower = answer.toLowerCase();
        const WORDS: Record<string, number> = {
          once: 1, twice: 2, thrice: 3,
          one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
        };
        // A digit that is actually about cadence — "3", "3x", "3 times",
        // "3 posts", "3/week", "3 a week" — not a stray "20% off" or "$5".
        const cued =
          /(\d{1,2})\s*(?:x\b|times?\b|posts?\b|\/|(?:a|per)\s*week)/i.exec(answer) ??
          /^\s*(\d{1,2})\s*$/.exec(answer);
        const word = new RegExp(`\\b(${Object.keys(WORDS).join('|')})\\b`, 'i').exec(lower);
        let n = 3; // the suggested default
        if (/daily|every ?day/i.test(lower)) n = 7;
        else if (cued) n = Number(cued[1]);
        else if (word) n = WORDS[word[1].toLowerCase()];
        // else: an agreement ("you pick") or anything with no readable number
        // keeps the default of 3.
        return { posting_frequency: Math.max(1, Math.min(21, n)) };
      }
    }
  }

  private isEmpty(profile: BrandProfile, field: ProfileField): boolean {
    switch (field) {
      case 'business_type':
        return !profile.businessType;
      case 'website':
        return !profile.websiteUrl;
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
