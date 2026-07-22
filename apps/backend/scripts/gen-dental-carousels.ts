/**
 * Regenerate the Bright Smile Dental educational posts as real carousels —
 * the exact production path: the post's own caption → carouselInstruction →
 * LlmService → CarouselLlmOutput → GraphicsService.renderCarousel.
 *
 *   OUT_DIR=… npx tsx scripts/gen-dental-carousels.ts
 */
import { config } from 'dotenv';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { LlmService } from '../src/operator/llm/llm.service';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import type { BrandTheme, SlideSpec } from '../src/operator/graphics/slide-templates';
import {
  carouselInstruction,
  CarouselLlmOutput,
  type CarouselBrief,
} from '../src/operator/graphics/carousel-content';

config({ path: join(__dirname, '..', '..', '..', '.env') });

const theme: BrandTheme = {
  primary: '#0E5C63',
  secondary: '#E8A13A',
  brandName: 'Bright Smile Dental',
  style: 'modern',
};

const POSTS = [
  {
    slug: 'post1',
    // variant base: in production this is the customer's post count, which is
    // why two posts in the same week start on different surfaces.
    base: 0,
    archetype: 'educational_tip' as const,
    caption:
      "Flossing once a week won't prevent gum disease—you need to do it daily. Your gums are where infections start, and they happen silently before you feel pain.\n\n" +
      "Floss reaches the spaces your toothbrush can't. Even just 30 seconds between your back teeth makes a real difference. If your gums bleed when you floss, that's actually a sign to keep going, not to stop—bleeding means inflammation, and consistent flossing reduces it over time.\n\n" +
      "Save this if you've been meaning to start, or send it to someone whose dentist keeps nagging them about it.",
  },
  {
    slug: 'post4',
    base: 3,
    archetype: 'product_spotlight' as const,
    caption:
      'Your teeth can look noticeably brighter in just one visit.\n\n' +
      "Teeth whitening at our Pasadena family dentist office takes about an hour. We use a professional-grade system that's gentle on enamel and actually works—no generic trays or weak strips. You'll see results the same day, and they keep getting better over the next week.\n\n" +
      "The best part? You're in control the whole time. Feel sensitive? We pause. Want to adjust the brightness level? We can do that.\n\n" +
      "Save this for when you're ready to smile with confidence again.",
  },
];

async function main() {
  const llm = new LlmService({ llmUsage: { create: async () => undefined } } as never);
  const graphics = new GraphicsService();
  const outDir = process.env.OUT_DIR ?? '/tmp';

  for (const post of POSTS) {
    const brief: CarouselBrief = {
      businessType: 'dental practice',
      archetype: post.archetype,
      caption: post.caption,
      brandName: 'Bright Smile Dental',
    };
    console.log(`\n── ${post.slug} (${post.archetype}) ─────────────────────`);
    const gen = await llm.completeJson(
      { tier: 'bulk', cachedContext: '', prompt: carouselInstruction(brief), maxTokens: 700 },
      CarouselLlmOutput,
    );
    gen.slides.forEach((s, i) => {
      console.log(`  [${i + 1}] (${s.kind}) ${s.headline}`);
      if (s.body) console.log(`      ${s.body}`);
    });

    const specs: SlideSpec[] = gen.slides.map((s, i) => ({
      kind: s.kind,
      headline: s.headline,
      body: s.body,
      seed: post.base, // one look for the whole set
      variant: i, // shifts only the decoration
    }));
    graphics.renderCarousel(specs, theme).forEach((png, i) => {
      const p = join(outDir, `${post.slug}-slide-${i + 1}.png`);
      writeFileSync(p, png);
      console.log(`  → ${p} (${png.length} bytes)`);
    });
  }
  console.log('\n✔ both carousels rendered');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
