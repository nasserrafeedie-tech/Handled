import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

import { LlmService } from '../llm/llm.service';
import { GraphicsService } from './graphics.service';
import { checkDesign, type DesignCopy, type DesignInput } from './design-check';
import { readPhoto, type PhotoRead } from './photo-focus';
import { CANVAS, CANVAS_H, typeSet, type BrandTheme } from './slide-templates';
import { LOGO_SLOT, PHOTO_SLOT } from './svg-guard';

/**
 * Designs one post graphic from scratch, the way a designer would for this
 * post alone, instead of filling in a template.
 *
 * Claude draws the post as SVG within the brand's colours and the bundled
 * fonts. Every design goes through design-check before anyone sees it, and a
 * design that's turned back gets one more try with the reason. If that misses
 * too, or the model can't be reached, the caller keeps its template render, so
 * a post never waits on this and never ships worse than it did before.
 */

export interface DesignRequest {
  customerId: string;
  /** What the graphic is: a carousel's cover, or a standalone graphic. */
  role: 'carousel_cover' | 'graphic';
  copy: DesignCopy;
  theme: BrandTheme;
  /** The photo for this post, as a data URI, when there is one. */
  photo?: string;
  businessType?: string;
  /** The post's archetype, e.g. "behind_the_scenes", for the idea behind it. */
  archetype?: string;
  /** How many slides follow a cover, so it can promise a swipe honestly. */
  slides?: number;
}

export interface Designed {
  png: Buffer;
  svg: string;
  /** Every word drawn, for the caller's copy checks. */
  drawnText: string;
  concept: string;
}

const DesignOut = z.object({
  concept: z.string().max(400),
  svg: z.string().min(40).max(80_000),
});

const ATTEMPTS = 2;

/**
 * What the design pass is told good looks like. Distilled from design-led
 * brand feeds: type as the picture (Oatly), block colour around one subject
 * (Halo Top), a quiet photo given room (Blue Bottle Coffee), small drawn
 * devices taken from the subject itself, and stickers set at a slight angle
 * (Graza, Fishwife).
 */
export const DESIGN_GUIDE = `How the best small-brand feeds design a post:
- One idea per post. Decide the single thing a follower should get in one second, then make the layout serve only that.
- Type is the picture. Set the headline big (often 110 to 240px), tight, and left-aligned or deliberately centred. Let one word carry the weight if the line allows it. Never set everything the same size.
- Block colour. Use the brand colours as large flat fields, not thin accents. A light paper neutral (like #F4EFE6) or near-black is the third colour. Two brand colours plus one neutral is plenty.
- A drawn device from the subject itself makes the post feel made for this business: a ticket stub for a price, a ruler for a "how often", a clock face for opening times, a cup outline, a pole stripe, a week strip. Simple shapes, flat fills, no clip-art.
- Small labels can sit on a rounded rect or a circle like a sticker, tilted a few degrees.
- When there's a photo, give it real room (at least a third of the post), crop it tight, and put the words in their own colour field or in clear space, never over the subject.
- Generous margins and a clear grid. Line things up on shared edges.
- Leave out drop shadows, glows, bevels, rainbow gradients, emoji, stock icons, "swipe" pills that the copy didn't ask for, and fake UI.`;

@Injectable()
export class DesignerService {
  private readonly log = new Logger(DesignerService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly graphics: GraphicsService,
  ) {}

  /** Only with a real model: offline mode keeps the templates, as before. */
  live(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY) && process.env.LLM_FAKE !== '1' && process.env.DESIGN_POSTS !== '0';
  }

  async design(req: DesignRequest): Promise<Designed | null> {
    if (!this.live()) return null;
    const read = req.photo ? await readPhoto(req.photo) : null;
    const palette = [req.theme.primary, req.theme.secondary].filter((c): c is string => Boolean(c));
    const input: DesignInput = {
      copy: { ...req.copy, brandName: req.copy.brandName ?? req.theme.brandName },
      palette,
      photo: req.photo ? { dataUri: req.photo, read } : undefined,
      logo: req.theme.logoDataUri,
    };

    let feedback = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let out: z.infer<typeof DesignOut>;
      try {
        out = await this.llm.completeJson(
          { tier: 'design', customerId: req.customerId, cachedContext: DESIGN_GUIDE, prompt: designPrompt(req, input, read) + feedback },
          DesignOut,
        );
      } catch (e) {
        this.log.warn(`design call failed for ${req.customerId}: ${String(e)}`);
        return null;
      }
      const verdict = checkDesign(out.svg, input, (svg, w) => this.graphics.rasterize(svg, w));
      if (verdict.ok) {
        return { png: this.graphics.renderSvg(verdict.svg), svg: verdict.svg, drawnText: verdict.drawnText, concept: out.concept };
      }
      this.log.warn(`design ${attempt} for ${req.customerId} turned back: ${verdict.reason}`);
      feedback =
        `\n\nYour last design was turned back: ${verdict.reason}.\n` +
        `Here it is; fix that problem and anything like it, and keep what worked:\n${out.svg}`;
    }
    return null;
  }
}

export function designPrompt(req: DesignRequest, input: DesignInput, read: PhotoRead | null): string {
  const t = typeSet(req.theme.style);
  const head = t.head.replace(/'/g, '');
  const copy = input.copy;
  const lines = [
    `Design one Instagram post graphic for ${copy.brandName ?? 'a local business'}${req.businessType ? `, a ${req.businessType}` : ''}.`,
    req.role === 'carousel_cover'
      ? `It's the cover of a ${req.slides ?? 'multi'}-slide carousel: it has to stop the scroll and make people swipe.`
      : 'It stands alone as the post.',
    req.archetype ? `The post's idea: ${req.archetype.replace(/_/g, ' ')}.` : '',
    '',
    'The words (use them exactly as written; you may change case, split lines and drop the body or button text, but add nothing that claims anything):',
    `- Headline: ${copy.headline}`,
    copy.body ? `- Body: ${copy.body}` : '',
    copy.cta ? `- Button: ${copy.cta}` : '',
    copy.footer ? `- Footer: ${copy.footer}` : '',
    copy.brandName ? `- Brand name: ${copy.brandName}` : '',
    'You may add up to 8 small words of your own as labels (like "new" or a day name), but no numbers, prices, dates or claims that the words above don\'t already contain.',
    '',
    `Brand colours: ${input.palette.join(', ')}. You may also use lighter or darker versions of them, and neutrals (paper, cream, greys, near-black). No other hues.`,
    `Fonts: the brand's headline face is ${head}${t.headUpper ? ', set in capitals' : ''}; body text is ${t.body}. Only these exist: Poppins (400, 500, 600, 700, 900), Playfair Display (400 or 800; font-style italic allowed), Anton (400), Marcellus (400).`,
    input.logo ? `The brand's real logo can go in with <image href="${LOGO_SLOT}" .../>, once, small.` : 'There is no logo; set the brand name in type if you use it.',
    input.photo
      ? `The owner's photo must be in the design: <image href="${PHOTO_SLOT}" x=".." y=".." width=".." height=".." preserveAspectRatio="xMidYMid slice"/>, inside a clipPath if you want a shape. ` +
        (read
          ? `Its subject sits about ${Math.round(read.focusY * 100)}% of the way down the photo, in the middle; keep every word off that part of the photo frame.`
          : 'Keep words off the middle of the photo.')
      : 'There is no photo; the design is type, colour and simple drawn shapes.',
    '',
    `Technical rules: one <svg> with viewBox="0 0 ${CANVAS} ${CANVAS_H}", width ${CANVAS}, height ${CANVAS_H}. Paint the whole canvas. Use only svg, g, defs, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, linearGradient, radialGradient, stop, clipPath, mask and image. Presentation attributes only (fill="…", font-size="…"): no style attribute, no CSS, no filters, no external links. Text needs a solid hex fill, at least 26px, and ${40}px clear of every edge; it can be moved with translate() and tilted up to 15 degrees with rotate(), nothing else. Draw every word as real <text>, never as paths. Make sure each line fits its width: a Poppins letter is about 0.6 of the font size wide, Anton about 0.45, Playfair about 0.55.`,
    'Return JSON: {"concept": "one sentence on the idea", "svg": "<svg …>…</svg>"}. Use single quotes for attributes inside the SVG so the JSON needs no escaping.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}
