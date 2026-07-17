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
      if (haystack.includes(term)) reasons.push(`baseline: "${term}"`);
    }

    // Integration point: hosted image/text moderation model for nuance beyond
    // keyword matching. Fail-closed — any thrown error blocks the post.
    return { passed: reasons.length === 0, reasons };
  }
}
