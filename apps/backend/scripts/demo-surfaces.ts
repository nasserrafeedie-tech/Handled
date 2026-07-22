/**
 * Render one carousel across the full surface rotation so we can eyeball the
 * variety. Same content, variant 0..6 → every surface in the catalogue.
 *   OUT_DIR=… npx tsx scripts/demo-surfaces.ts
 */
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import type { BrandTheme, SlideSpec, SlideKind } from '../src/operator/graphics/slide-templates';

const theme: BrandTheme = {
  primary: '#0E5C63',
  secondary: '#E8A13A',
  brandName: 'Bright Smile Dental',
  style: 'modern',
};

const content: { kind: SlideKind; headline: string; body?: string }[] = [
  { kind: 'title', headline: 'Teeth whitening, explained', body: 'What actually happens in the chair.' },
  { kind: 'body', headline: 'One visit, about an hour', body: 'In-office whitening is a single appointment. That’s it.' },
  { kind: 'body', headline: 'Gentle on your enamel', body: 'We check first and stop if anything feels sensitive.' },
  { kind: 'body', headline: 'You stay in control', body: 'We tell you straight whether it’s a fit for you.' },
  { kind: 'promo', headline: 'This month', body: 'A whitening consult on us.' },
  { kind: 'quote', headline: 'My smile hasn’t looked this good in years.' },
  { kind: 'cta', headline: 'Ready when you are', body: 'Book a whitening consult at Bright Smile Dental.' },
];

const graphics = new GraphicsService();
const outDir = process.env.OUT_DIR ?? '/tmp';
content.forEach((c, i) => {
  const spec: SlideSpec = { ...c, variant: i };
  const png = graphics.renderSlide(spec, theme);
  const p = join(outDir, `surface-${i}.png`);
  writeFileSync(p, png);
  console.log(`variant ${i} (${c.kind}) → ${p} (${png.length} bytes)`);
});
console.log('✔ rendered the surface rotation');
