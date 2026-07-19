/**
 * Generate REAL sample graphics with the production GraphicsService and write
 * them into the web app's public folder, so the marketing site showcases the
 * actual product (not placeholder boxes).
 *
 *   npx tsx --tsconfig apps/backend/tsconfig.json apps/backend/scripts/gen-web-samples.ts
 *
 * Output: apps/web/public/samples/*.png  (committed to git so Vercel serves them)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import type { BrandTheme, SlideSpec } from '../src/operator/graphics/slide-templates';

const gfx = new GraphicsService();

// A couple of warm, believable small-business brands.
const rosa: BrandTheme = { primary: '#7C3A24', secondary: '#E7B27A', brandName: "Rosa's Coffee" };
const bloom: BrandTheme = { primary: '#3B5B45', secondary: '#E8C1CE', brandName: 'Bloom & Stem' };

// Each entry: filename, the owner's plain-text ask (shown on the site), theme, slides.
const SAMPLES: {
  file: string;
  prompt: string;
  theme: BrandTheme;
  slides: SlideSpec[];
}[] = [
  {
    file: 'quote.png',
    prompt: '“make a quote card that says the best ideas are brewed, not forced”',
    theme: rosa,
    slides: [
      { kind: 'quote', headline: 'The best ideas are brewed, not forced.', footer: "Rosa's Coffee" },
    ],
  },
  {
    file: 'promo.png',
    prompt: '“make a promo for 50% off all lattes this Friday”',
    theme: rosa,
    slides: [
      { kind: 'promo', headline: '50% OFF', body: 'Every latte, this Friday only.', footer: "Rosa's Coffee" },
    ],
  },
  {
    file: 'title.png',
    prompt: '“make a graphic for our spring bouquet launch”',
    theme: bloom,
    slides: [
      { kind: 'title', headline: 'Spring bouquets are here', body: 'Fresh arrangements, made this morning.', footer: 'Bloom & Stem' },
    ],
  },
  {
    file: 'cta.png',
    prompt: '“make a come-visit-us post with our hours”',
    theme: bloom,
    slides: [
      { kind: 'cta', headline: 'Come say hi', body: 'Open 9–5, Tue–Sun · 4th & Main', footer: 'Bloom & Stem' },
    ],
  },
];

function main() {
  const outDir = join(__dirname, '..', '..', 'web', 'public', 'samples');
  mkdirSync(outDir, { recursive: true });

  const manifest: { file: string; prompt: string }[] = [];
  for (const s of SAMPLES) {
    const [png] = gfx.renderCarousel(s.slides, s.theme);
    writeFileSync(join(outDir, s.file), png);
    manifest.push({ file: s.file, prompt: s.prompt });
    console.log(`wrote samples/${s.file}  (${png.length} bytes)`);
  }

  // Write a manifest the site can import so prompts + files stay in sync.
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log(`\nwrote manifest.json with ${manifest.length} entries`);
  console.log('DONE ✓');
}

main();
