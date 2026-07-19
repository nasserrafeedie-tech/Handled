/**
 * Regenerates the sample graphics shown on the marketing site.
 *
 * These are rendered by the *real* graphics engine the product uses — same
 * templates, same fonts, same code path — so what visitors see on the homepage
 * is an honest preview of what a customer actually gets.
 *
 * Usage:  npm run build:backend && node scripts/make-samples.js
 */
const { writeFileSync, unlinkSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const {
  GraphicsService,
} = require('../apps/backend/dist/operator/graphics/graphics.service');

const OUT = join(__dirname, '..', 'apps', 'web', 'public', 'samples');
const photo = (id, w = 1400) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

// Each sample pairs a real photo with a different layout + type personality, so
// the row on the homepage shows range rather than one template four times.
/**
 * The renderer emits PNG, which is the right choice for the real product (crisp
 * text, no compression fuzz). But these four sit on the homepage, and a photo
 * PNG is ~1 MB versus ~150 KB as a JPEG — so for the website copies we convert.
 * Uses macOS `sips`; if it isn't available we keep the PNG and say so.
 */
function toJpeg(pngPath, jpgPath) {
  try {
    execFileSync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', pngPath, '--out', jpgPath],
      { stdio: 'ignore' },
    );
    unlinkSync(pngPath);
    return true;
  } catch {
    return false;
  }
}

const SAMPLES = [
  {
    file: 'promo.png',
    prompt: '“make a promo for 50% off all lattes this Friday”',
    photoId: '1541167760496-1628856ab772',
    layout: 'full',
    theme: { primary: '#6B3A24', secondary: '#E8B27D', brandName: "Rosa's Coffee", style: 'bold' },
    spec: { kind: 'promo', headline: '50% OFF', body: 'Every latte, this Friday only.' },
  },
  {
    file: 'quote.png',
    prompt: '“a quote card: the best ideas are brewed, not forced”',
    photoId: '1501339847302-ac426a4a7cbb',
    layout: 'full',
    theme: { primary: '#1F2A24', secondary: '#C9A227', brandName: "Rosa's Coffee", style: 'editorial' },
    spec: { kind: 'quote', headline: 'The best ideas are brewed, not forced.' },
  },
  {
    file: 'title.png',
    prompt: '“a graphic for our spring bouquet launch”',
    photoId: '1490750967868-88aa4486c946',
    layout: 'band',
    theme: { primary: '#2E4B3C', secondary: '#F0B429', brandName: 'Fieldnote Florals', style: 'luxe' },
    spec: {
      kind: 'title',
      headline: 'The Spring Bouquet',
      body: 'Fresh stems, arranged the morning you order.',
    },
  },
  {
    file: 'cta.png',
    prompt: '“a come-visit-us post with our hours”',
    photoId: '1554118811-1e0d58224f24',
    layout: 'card',
    theme: { primary: '#243447', secondary: '#E9A178', brandName: 'Brief & Co.', style: 'modern' },
    spec: {
      kind: 'cta',
      headline: 'Come sit with us',
      body: 'Open 7am – 4pm, every day of the week.',
    },
  },
];

async function main() {
  const gfx = new GraphicsService();
  const manifest = [];

  for (const s of SAMPLES) {
    process.stdout.write(`rendering ${s.file} … `);
    const dataUri = await gfx.fetchPhoto(photo(s.photoId));
    const png = gfx.renderSlide(
      { ...s.spec, photo: dataUri, photoLayout: s.layout },
      s.theme,
    );
    const pngPath = join(OUT, s.file);
    writeFileSync(pngPath, png);

    const jpgName = s.file.replace(/\.png$/, '.jpg');
    const converted = toJpeg(pngPath, join(OUT, jpgName));
    const file = converted ? jpgName : s.file;
    manifest.push({ file, prompt: s.prompt });
    console.log(
      converted
        ? `${(png.length / 1024).toFixed(0)} KB png → ${jpgName}`
        : `${(png.length / 1024).toFixed(0)} KB png (sips unavailable, kept PNG)`,
    );
  }

  writeFileSync(
    join(OUT, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  console.log('done →', OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
