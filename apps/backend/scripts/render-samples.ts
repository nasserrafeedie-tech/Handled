/**
 * Render a feed's worth of sample posts for a few made-up businesses, so the
 * graphics can be LOOKED AT, not just unit-tested.
 *
 *   npx tsx scripts/render-samples.ts <outDir> [photoDir]
 *
 * For each business it renders six consecutive posts (the seeds a real feed
 * would walk through) as five-slide carousels, and writes every slide as a
 * PNG. Two contact sheets per business follow if ffmpeg is on PATH:
 *   <biz>-feed.jpg      the six covers side by side — "do neighbours repeat?"
 *   <biz>-carousel.jpg  one whole carousel — "does a set hang together?"
 *
 * photoDir (optional) holds the stock photos a business with `photos` uses.
 * Nothing here touches the network or the database.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import {
  photoLayoutFor,
  type BrandTheme,
  type SlideSpec,
} from '../src/operator/graphics/slide-templates';

interface Biz {
  slug: string;
  theme: BrandTheme;
  photos?: string[];
  posts: { headline: string; body: string }[];
  cta: { headline: string; body: string; label: string };
}

const BUSINESSES: Biz[] = [
  {
    slug: 'cafe',
    theme: { primary: '#7C3A24', secondary: '#E7B27A', brandName: "Rosa's Coffee", style: 'editorial' },
    photos: ['photo-cortados.jpg', 'photo-window.jpg'],
    posts: [
      { headline: 'The cortado, explained', body: 'Equal parts espresso and steamed milk. Small, strong, and gone in four sips.' },
      { headline: 'Why we roast on Tuesdays', body: 'Beans peak a few days after roasting, right in time for the weekend rush.' },
      { headline: 'Meet the window seat', body: 'Best light in the shop from 8 to 11. Bring a book.' },
      { headline: '3 ways to order oat milk', body: 'Latte, flat white, or our honey cinnamon cold brew.' },
      { headline: 'Pastries land at 7', body: 'Croissants from Boulangerie Marie, delivered warm every morning.' },
      { headline: 'Our barista, Dev', body: 'Six years behind the bar and still pulls every shot like it is the first.' },
    ],
    cta: { headline: 'Come say hi', body: 'Open 7 to 4, every day.', label: 'Get directions' },
  },
  {
    slug: 'barber',
    theme: { primary: '#141414', secondary: '#C9A227', brandName: 'Sharp & Co', style: 'bold' },
    posts: [
      { headline: 'Fresh fade Friday', body: 'Walk-ins welcome until 6. Book ahead and skip the wait.' },
      { headline: 'Beard oil, honestly', body: 'Three drops, warmed in your palms. That is the whole trick.' },
      { headline: 'How often to get a cut', body: 'Fades every two weeks. Longer styles every four to six.' },
      { headline: 'Kids cuts are $18', body: 'Every Saturday morning. Lollipop included.' },
      { headline: 'The hot towel shave', body: 'Twenty minutes, straight razor, and the best part of your week.' },
      { headline: 'New chair, same crew', body: 'Marcus is back from paternity leave on Monday.' },
    ],
    cta: { headline: 'Book your chair', body: 'Tue to Sat, 9 to 7.', label: 'Book now' },
  },
  {
    slug: 'dental',
    theme: { primary: '#0E7C86', secondary: '#F4B860', brandName: 'Bright Smile Dental', style: 'modern' },
    posts: [
      { headline: 'Floss before or after?', body: 'Before. It loosens what brushing then sweeps away.' },
      { headline: 'New patients welcome', body: 'Same-week appointments and most insurance accepted.' },
      { headline: '2 minutes, twice a day', body: 'Most people brush for about 45 seconds. Set a timer once and see.' },
      { headline: 'Sensitive teeth?', body: 'A softer brush and less pressure fixes it more often than you think.' },
      { headline: 'Meet Dr. Patel', body: 'Fifteen years of family dentistry and a very calm chairside manner.' },
      { headline: 'Whitening, the truth', body: 'Strips work. Charcoal does not. Ask us what fits your enamel.' },
    ],
    cta: { headline: 'Book a cleaning', body: 'Evening slots on Tuesdays and Thursdays.', label: 'Book online' },
  },
  {
    slug: 'groomer',
    theme: { primary: '#3B5B45', secondary: '#E8C1CE', brandName: 'Pawsh Grooming', style: 'luxe' },
    photos: ['dog1.jpg', 'dog2.jpg'],
    posts: [
      { headline: 'Bath day, done right', body: 'Warm water, gentle shampoo, and a towel dry before any blow dryer.' },
      { headline: 'How often to groom', body: 'Short coats every eight weeks. Doodles every four to six.' },
      { headline: 'Nail trims are $12', body: 'No appointment needed. Five minutes, in and out.' },
      { headline: 'Meet Biscuit', body: 'This week’s best behaved client. Treats were earned.' },
      { headline: 'De-shedding season', body: 'Spring coats come out in clumps. We have a tool for that.' },
      { headline: 'Puppy’s first groom', body: 'A short, calm visit so the big one is never scary.' },
    ],
    cta: { headline: 'Book a groom', body: 'Drop-off from 8, pick-up by 5.', label: 'Text to book' },
  },
];

const BODY_TIPS = [
  'Most people get this wrong.',
  'Here is what actually works.',
  'Save this for later.',
];

function main() {
  const outDir = process.argv[2];
  const photoDir = process.argv[3];
  if (!outDir) throw new Error('usage: render-samples.ts <outDir> [photoDir]');
  mkdirSync(outDir, { recursive: true });
  const gfx = new GraphicsService();
  const legacy = process.env.SAMPLES_LEGACY_PHOTOS === '1';

  for (const biz of BUSINESSES) {
    const photos = (biz.photos ?? [])
      .map((f) => (photoDir ? join(photoDir, f) : ''))
      .filter((p) => p && existsSync(p))
      .map((p) => `data:image/jpeg;base64,${readFileSync(p).toString('base64')}`);
    // A stable brand offset, like the handlers use, so each business walks its
    // own path through the looks.
    const base = [...biz.slug].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 1000;
    const covers: string[] = [];
    let firstCarousel: string[] = [];

    biz.posts.forEach((post, n) => {
      const seed = base + n;
      const slides: SlideSpec[] = [
        { kind: 'title', headline: post.headline, body: post.body },
        { kind: 'body', headline: BODY_TIPS[0], body: post.body },
        { kind: 'body', headline: BODY_TIPS[1], body: 'Small things, done every day, add up faster than one big change.' },
        { kind: 'quote', headline: 'Best part of my week, every week.' },
        { kind: 'cta', headline: biz.cta.headline, body: biz.cta.body, ctaLabel: biz.cta.label },
      ].map((s, i, all) => ({ ...s, seed, variant: i, total: all.length }) as SlideSpec);

      // Photo businesses get a real photo on every other post, the way a feed
      // that mixes photo posts and designed posts actually looks.
      if (photos.length && n % 2 === 0) {
        [0, 1].forEach((i) => {
          slides[i] = {
            ...slides[i],
            photo: photos[(n / 2 + i) % photos.length],
            photoLayout: legacy ? (i === 0 ? 'full' : 'band') : photoLayoutFor(seed, i),
          };
        });
      }

      const pngs = gfx.renderCarousel(slides, biz.theme);
      pngs.forEach((png, i) => {
        const f = join(outDir, `${biz.slug}-p${n + 1}-s${i + 1}.png`);
        writeFileSync(f, png);
        if (i === 0) covers.push(f);
        if (n === 1) firstCarousel.push(f);
      });
    });

    tile(covers, join(outDir, `${biz.slug}-feed.jpg`), 3);
    tile(firstCarousel, join(outDir, `${biz.slug}-carousel.jpg`), 5);
    firstCarousel = [];
    console.log(`${biz.slug}: ${biz.posts.length} posts`);
  }
}

/** Grid of PNGs → one JPEG, each cell 360 wide. Skipped without ffmpeg. */
function tile(files: string[], out: string, cols: number) {
  try {
    const rows = Math.ceil(files.length / cols);
    const inputs = files.flatMap((f) => ['-i', f]);
    const scaled = files.map((_, i) => `[${i}:v]scale=360:450[v${i}]`).join(';');
    const layout = files
      .map((_, i) => `${(i % cols) * 360}_${Math.floor(i / cols) * 450}`)
      .join('|');
    const labels = files.map((_, i) => `[v${i}]`).join('');
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', ...inputs,
      '-filter_complex', `${scaled};${labels}xstack=inputs=${files.length}:layout=${layout}:fill=white[o]`,
      '-map', '[o]', '-frames:v', '1', '-q:v', '3', out,
    ]);
    void rows;
  } catch (e) {
    console.warn(`no contact sheet for ${out}: ${String(e).slice(0, 120)}`);
  }
}

main();
