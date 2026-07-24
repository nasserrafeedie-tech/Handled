import { Injectable } from '@nestjs/common';

export interface ModerationInput {
  caption: string;
  hashtags: string[];
  blackoutTopics: string[];
  imageRefs?: string[];
}

export interface ModerationVerdict {
  passed: boolean;
  reasons: string[];
}

/**
 * §8: "Every generated caption + image passes a moderation check before going
 * live under a business's name. Fail → block + flag for review."
 *
 * This is the deterministic pre-filter: customer-defined blackout topics + a
 * baseline unsafe-content list. A hosted moderation model can be layered on top
 * in `screen` without changing callers.
 */
@Injectable()
export class ModerationService {
  private readonly baselineBlocked = [
    'hate',
    'violence',
    'self-harm',
    'sexual',
  ];

  async screen(input: ModerationInput): Promise<ModerationVerdict> {
    const haystack =
      `${input.caption} ${input.hashtags.join(' ')}`.toLowerCase();
    const reasons: string[] = [];

    for (const topic of input.blackoutTopics) {
      if (topic && haystack.includes(topic.toLowerCase())) {
        reasons.push(`blackout topic: "${topic}"`);
      }
    }
    for (const term of this.baselineBlocked) {
      // Match on a word boundary, not a raw substring. Substring matching
      // blocked innocent words that merely CONTAIN a flagged term — "chateau"
      // contains "hate", "grape" nearly, "class" contains no term but "sexual"
      // vs "sexuality" behaves — so a French restaurant or winery would have
      // every post flagged. Over-blocking is the safe direction (it routes to
      // owner review, never publishes something wrong), but it silently breaks
      // the product for a whole category of business.
      if (new RegExp(`\\b${term}\\b`, 'i').test(haystack)) {
        reasons.push(`baseline: "${term}"`);
      }
    }

    // Integration point: hosted image/text moderation model for nuance beyond
    // keyword matching. Fail-closed — any thrown error blocks the post.
    return { passed: reasons.length === 0, reasons };
  }
}
