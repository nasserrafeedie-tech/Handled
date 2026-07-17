import { Injectable } from '@nestjs/common';
import type { BrandProfile } from '@prisma/client';

/**
 * §6 onboarding as a checklist of profile fields, NOT a step counter — so an
 * hours-long gap resumes cleanly at the next empty field, and one answer that
 * fills several fields skips ahead. The Concierge asks one question per text.
 *
 * This module owns *which* field to ask about next and the human phrasing. The
 * actual interpretation of a free-text answer (which may fill several fields at
 * once, §6) is done by the Concierge's LLM step, which emits UPDATE_BRAND_PROFILE.
 */

export type ProfileField =
  | 'business_type'
  | 'voice_tone'
  | 'target_customer'
  | 'offers'
  | 'dos_and_donts'
  | 'posting_frequency';

/** Fields required before we consider onboarding complete and plan week 1. */
const REQUIRED: ProfileField[] = [
  'business_type',
  'voice_tone',
  'target_customer',
  'offers',
  'posting_frequency',
];

@Injectable()
export class OnboardingService {
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

  /** One-question-per-text prompts, adapted where possible to what we know. */
  question(field: ProfileField, profile: BrandProfile | null): string {
    switch (field) {
      case 'business_type':
        return "Hey! I'm going to run your social media for you — mostly you'll just reply to my texts. First: tell me about your business in a sentence, what do you do?";
      case 'voice_tone': {
        const bt = profile?.businessType ? ` for ${profile.businessType}` : '';
        return `Got it. I'm picturing posts${bt} that feel warm but polished — is that right, or do you want a different vibe?`;
      }
      case 'target_customer':
        return 'Who are you mainly trying to reach? (your ideal customer)';
      case 'offers':
        return "What's worth showing off — your best products, services, or anything you want more people to know about?";
      case 'dos_and_donts':
        return 'Anything I should always mention, or never mention?';
      case 'posting_frequency':
        return 'How often should I post? Most businesses do 3–4× a week — want me to start there?';
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
