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
import { readPhoto, reviewPhotoLayout } from '../src/operator/graphics/photo-focus';
import {
  photoLayoutFor,
  type BrandTheme,
  type SlideSpec,
} from '../src/operator/graphics/slide-templates';

interface Biz {
  slug: string;
  theme: BrandTheme;
  photos?: string[];
  posts: { headline: string; body: string; inside: [string, string][]; quote?: [string, string] }[];
  cta: { headline: string; body: string; label: string };
}

const BUSINESSES: Biz[] = [
  {
    slug: 'cafe',
    theme: { primary: '#7C3A24', secondary: '#E7B27A', brandName: "Rosa's Coffee", style: 'editorial' },
    photos: ['photo-cortados.jpg', 'photo-window.jpg'],
    posts: [
      { headline: 'The cortado, explained', body: 'Equal parts espresso and steamed milk. Small, strong, and gone in four sips.',
        inside: [['Equal parts', 'A double shot and the same amount of milk, steamed silky, not foamy.'], ['Served small', 'Four ounces in a glass. Warm enough to drink right away.'], ['Who it suits', 'Latte drinkers who want more coffee, espresso drinkers who want it softer.']] },
      { headline: 'Why we roast on Tuesdays', body: 'Beans peak a few days after roasting, right in time for the weekend rush.',
        inside: [['Roast Tuesday', 'Small batches, every week, in the back room.'], ['Rest three days', 'Fresh beans give off gas that makes shots sour. They need a few days.'], ['Peak by Friday', 'Right when the weekend line starts.']] },
      { headline: 'Meet the window seat', body: 'Best light in the shop from 8 to 11. Bring a book.',
        inside: [['Morning light', 'Sun comes straight in from 8 until about 11.'], ['One outlet', 'Under the ledge, left side. First come, first charged.']] },
      { headline: '3 ways to order oat milk', body: 'Latte, flat white, or our honey cinnamon cold brew.',
        inside: [['Latte', 'The easy one. Oat steams sweeter than dairy.'], ['Flat white', 'Less milk, more coffee, same silky top.'], ['Honey cinnamon cold brew', 'Our summer favourite, all year round.']] },
      { headline: 'Pastries land at 7', body: 'Croissants from Boulangerie Marie, delivered warm every morning.',
        inside: [['Baked at 4', 'Boulangerie Marie starts before anyone is up.'], ['On the counter at 7', 'Still warm. The almond ones go first.']] },
      { headline: 'Our barista, Dev', body: 'Six years behind the bar and still pulls every shot like it is the first.',
        inside: [['Six years in', 'Started washing cups, now runs the morning shift.'], ['Ask him about', 'The single origin on the left grinder. He has opinions.']],
        quote: ['Dev remembers my order and my dog’s name.', 'Priya, weekday regular'] },
    ],
    cta: { headline: 'Come say hi', body: 'Open 7 to 4, every day.', label: 'Get directions' },
  },
  {
    slug: 'barber',
    theme: { primary: '#141414', secondary: '#C9A227', brandName: 'Sharp & Co', style: 'bold' },
    posts: [
      { headline: 'Fresh fade Friday', body: 'Walk-ins welcome until 6. Book ahead and skip the wait.',
        inside: [['Walk in', 'Chairs open until 6 on Fridays.'], ['Or book ahead', 'Grab a time online and skip the bench.']] },
      { headline: 'Beard oil, honestly', body: 'Three drops, warmed in your palms. That is the whole trick.',
        inside: [['Three drops', 'More than that and it just sits on top.'], ['Warm it first', 'Rub your palms together for a few seconds.'], ['Work it in', 'Roots first, then the ends. Comb through.']] },
      { headline: 'How often to get a cut', body: 'Fades every two weeks. Longer styles every four to six.',
        inside: [['Fades', 'Every two weeks keeps the line sharp.'], ['Tapers', 'Three weeks is the sweet spot.'], ['Longer styles', 'Four to six weeks for shape.']] },
      { headline: 'Kids cuts are $18', body: 'Every Saturday morning. Lollipop included.',
        inside: [['Saturday mornings', '9 to noon, first come first served.'], ['Lollipop included', 'Bribery works. We are not ashamed.']] },
      { headline: 'The hot towel shave', body: 'Twenty minutes, straight razor, and the best part of your week.',
        inside: [['Hot towel', 'Opens everything up before the blade.'], ['Straight razor', 'Two passes, with the grain then across.'], ['Cold towel', 'Closes it all back down.']],
        quote: ['Best shave I have had since my grandpa’s barber.', 'Marcus T.'] },
      { headline: 'New chair, same crew', body: 'Marcus is back from paternity leave on Monday.',
        inside: [['Back Monday', 'Marcus returns with photos of the baby.'], ['Book him early', 'His regulars already know.']] },
    ],
    cta: { headline: 'Book your chair', body: 'Tue to Sat, 9 to 7.', label: 'Book now' },
  },
  {
    slug: 'dental',
    theme: { primary: '#0E7C86', secondary: '#F4B860', brandName: 'Bright Smile Dental', style: 'modern' },
    posts: [
      { headline: 'Floss before or after?', body: 'Before. Here is why the order matters.',
        inside: [['Floss first', 'It loosens what is stuck between your teeth.'], ['Then brush', 'The fluoride reaches the spots floss just cleared.'], ['Spit, don’t rinse', 'Rinsing washes the fluoride off before it can work.']] },
      { headline: 'New patients welcome', body: 'Same-week appointments and most insurance accepted.',
        inside: [['Same-week visits', 'Call by Wednesday and we can usually see you that week.'], ['Most insurance', 'Send us your card and we check it before you come in.'], ['First visit', 'A cleaning, X-rays and a real conversation. About an hour.']],
        quote: ['I actually look forward to my cleanings now.', 'Dana, patient since 2021'] },
      { headline: '2 minutes, twice a day', body: 'Most people brush for about 45 seconds.',
        inside: [['Set a timer once', 'Two minutes feels long the first time. That is the point.'], ['30 seconds a quarter', 'Top left, top right, bottom left, bottom right.']] },
      { headline: 'Sensitive teeth?', body: 'A softer brush fixes it more often than you think.',
        inside: [['Go soft', 'Hard bristles wear the enamel down over time.'], ['Ease the pressure', 'Hold the brush like a pencil, not a hammer.'], ['Still twinges?', 'Tell us. It can be a crack we want to catch early.']] },
      { headline: 'Meet Dr. Patel', body: 'Fifteen years of family dentistry and a very calm chairside manner.',
        inside: [['Fifteen years', 'Family dentistry, from first teeth to dentures.'], ['Nervous patients', 'She explains every step before she starts it.']] },
      { headline: 'Whitening, the truth', body: 'Some things work. Some don’t.',
        inside: [['Strips work', 'Slowly, and gently, if you follow the box.'], ['Charcoal doesn’t', 'It scrubs, and scrubbing wears enamel.'], ['Ask first', 'We can tell you what fits your teeth.']] },
    ],
    cta: { headline: 'Book a cleaning', body: 'Evening slots on Tuesdays and Thursdays.', label: 'Book online' },
  },
  {
    slug: 'groomer',
    theme: { primary: '#3B5B45', secondary: '#E8C1CE', brandName: 'Pawsh Grooming', style: 'luxe' },
    photos: ['dog1.jpg', 'dog2.jpg'],
    posts: [
      { headline: 'Bath day, done right', body: 'Warm water, gentle shampoo, and a towel dry before any blow dryer.',
        inside: [['Warm, not hot', 'Dogs run warmer than us. Lukewarm feels right to them.'], ['Towel first', 'Less time under the dryer means less stress.']] },
      { headline: 'How often to groom', body: 'Short coats every eight weeks. Doodles every four to six.',
        inside: [['Short coats', 'Every eight weeks, plus baths at home.'], ['Doodles', 'Every four to six weeks, or the mats win.'], ['Double coats', 'Brush weekly. Never shave them down.']] },
      { headline: 'Nail trims are $12', body: 'No appointment needed. Five minutes, in and out.',
        inside: [['Walk in', 'Any time we are open.'], ['Five minutes', 'Treats before, during and after.']] },
      { headline: 'Meet Biscuit', body: 'This week’s best behaved client. Treats were earned.',
        inside: [['Six months old', 'Second groom, zero complaints.'], ['Favourite part', 'The fluffy towel at the end.']],
        quote: ['Biscuit runs to the door when we pull up.', 'Sam, Biscuit’s human'] },
      { headline: 'De-shedding season', body: 'Spring coats come out in clumps. We have a tool for that.',
        inside: [['Undercoat out', 'A deshedding rake pulls what brushing misses.'], ['Less on the sofa', 'One session cuts shedding for weeks.']] },
      { headline: 'Puppy’s first groom', body: 'A short, calm visit so the big one is never scary.',
        inside: [['Short visit', 'Twenty minutes: a bath, a brush, lots of treats.'], ['Sounds and smells', 'They meet the dryer and the table with no pressure.']] },
    ],
    cta: { headline: 'Book a groom', body: 'Drop-off from 8, pick-up by 5.', label: 'Text to book' },
  },
];

/** Which post's whole deck goes on the contact sheet: one with a quote in it. */
const CAROUSEL_POST: Record<string, number> = { cafe: 5, barber: 4, dental: 0, groomer: 3 };

async function main() {
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

    for (const [n, post] of biz.posts.entries()) {
      const seed = base + n;
      // The shape a real deck takes: the hook, the inside slides that carry
      // the content, an occasional customer quote, and the call to action.
      const slides: SlideSpec[] = [
        { kind: 'title', headline: post.headline, body: post.body },
        ...post.inside.map(([headline, body]) => ({ kind: 'body', headline, body }) as SlideSpec),
        ...(post.quote ? [{ kind: 'quote', headline: post.quote[0], footer: post.quote[1] } as SlideSpec] : []),
        { kind: 'cta', headline: biz.cta.headline, body: biz.cta.body, ctaLabel: biz.cta.label },
      ].map((s, i, all) => ({ ...s, seed, variant: i, total: all.length }) as SlideSpec);

      // Photo businesses get a real photo on every other post, the way a feed
      // that mixes photo posts and designed posts actually looks.
      // Each photo goes through the same review the carousel handler runs, so
      // words move off the subject here exactly as they would for a customer.
      if (photos.length && n % 2 === 0) {
        for (const i of [0, 1]) {
          const photo = photos[(n / 2 + i) % photos.length];
          const planned = legacy ? (i === 0 ? 'full' : 'band') : photoLayoutFor(seed, i);
          const read = legacy ? null : await readPhoto(photo);
          slides[i] = {
            ...slides[i],
            photo,
            photoLayout: reviewPhotoLayout(planned, read),
            photoFocusY: read?.focusY,
          };
        }
      }

      const pngs = gfx.renderCarousel(slides, biz.theme);
      pngs.forEach((png, i) => {
        const f = join(outDir, `${biz.slug}-p${n + 1}-s${i + 1}.png`);
        writeFileSync(f, png);
        if (i === 0) covers.push(f);
        if (n === CAROUSEL_POST[biz.slug]) firstCarousel.push(f);
      });
    }

    tile(covers, join(outDir, `${biz.slug}-feed.jpg`), 3);
    tile(firstCarousel, join(outDir, `${biz.slug}-carousel.jpg`), firstCarousel.length);
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

void main();
