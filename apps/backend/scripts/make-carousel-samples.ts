/**
 * Render the carousel samples the marketing site shows off. Café-themed to
 * match the running "Rosa's Coffee" example, in the site's warm clay palette.
 * Output: apps/web/public/samples/carousel-slide-{1..4}.png
 *
 *   npx tsx scripts/make-carousel-samples.ts
 */
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import type { BrandTheme, SlideSpec } from '../src/operator/graphics/slide-templates';

const theme: BrandTheme = {
  primary: '#7C4A32', // roasted-coffee brown
  secondary: '#E0A46B', // warm crema
  brandName: "Rosa's Coffee",
  style: 'editorial',
};

const slides: SlideSpec[] = [
  {
    kind: 'title',
    headline: 'How to taste more than caffeine',
    body: 'Three things that change your cup — no gear required.',
    variant: 0,
  },
  {
    kind: 'body',
    headline: 'Buy it fresh, use it fast',
    body: 'Coffee is at its best within a month of roasting. After that it just goes flat.',
    variant: 1,
  },
  {
    kind: 'body',
    headline: 'Grind right before you brew',
    body: 'Ground coffee stales in minutes. Whole beans hold their flavor for weeks.',
    variant: 2,
  },
  {
    kind: 'cta',
    headline: 'Come taste the difference',
    body: "Beans roasted twelve miles from here, pulled fresh all day at Rosa's.",
    variant: 3,
  },
];

const graphics = new GraphicsService();
const outDir = join(__dirname, '..', '..', 'web', 'public', 'samples');
graphics.renderCarousel(slides, theme).forEach((png, i) => {
  const p = join(outDir, `carousel-slide-${i + 1}.png`);
  writeFileSync(p, png);
  console.log(`wrote ${p} (${png.length} bytes)`);
});
console.log('✔ carousel samples rendered');
