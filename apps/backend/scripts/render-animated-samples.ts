/**
 * Render the animated reel templates for the four sample businesses, so they
 * can be watched, not just unit-tested.
 *
 *   npx tsx scripts/render-animated-samples.ts <outDir> <photoDir>
 *
 * photoDir holds before/after photos named <slug>-before.jpg and
 * <slug>-after.jpg (any business without them gets only the promo). Writes
 * <slug>-promo.mp4, <slug>-reveal.mp4 and a contact sheet of stills per reel.
 * Nothing here touches the network or the database.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import type { BrandTheme } from '../src/operator/graphics/slide-templates';
import { AnimatedReelService } from '../src/operator/video/animated/animated-reel.service';
import { reelLook } from '../src/operator/video/animated/look';
import { layoutSpec, type AnimatedReelSpec } from '../src/operator/video/animated/spec';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpeg: string = require('ffmpeg-static');

interface Sample {
  slug: string;
  theme: BrandTheme;
  promo: AnimatedReelSpec;
  reveal?: AnimatedReelSpec;
}

const SAMPLES: Sample[] = [
  {
    slug: 'barber',
    theme: { primary: '#141414', secondary: '#C9A227', brandName: 'Sharp & Co', style: 'bold' },
    promo: {
      kind: 'promo', kicker: 'This week only', headline: 'Fade + beard', was_price: '$45', price: '$35',
      details: ['Tuesday to Thursday', 'Walk-ins welcome, or book ahead'],
      end_headline: 'Book your chair', end_body: 'sharpandco.com', cta_label: 'Book now',
    },
  },
  {
    slug: 'groomer',
    theme: { primary: '#3B5B45', secondary: '#E8C1CE', brandName: 'Pawsh Grooming', style: 'luxe' },
    promo: {
      kind: 'promo', kicker: 'New this month', headline: 'Spa bath and blowout', price: '$55',
      details: ['Every dog, every size', 'Booking now for December'],
      end_headline: 'Book their glow-up', end_body: 'Baths, trims and full grooms', cta_label: 'Book a groom',
    },
    reveal: {
      kind: 'before_after', before_caption: 'Came in fluffy', after_caption: 'Left feeling brand new',
      end_headline: 'Book their glow-up', end_body: 'Baths, trims and full grooms', cta_label: 'Book a groom',
    },
  },
  {
    slug: 'cafe',
    theme: { primary: '#7C3A24', secondary: '#E7B27A', brandName: "Rosa's Coffee", style: 'editorial' },
    promo: {
      kind: 'promo', kicker: 'Weekdays before 9', headline: 'Any latte with a croissant', price: '$8',
      details: ['Monday to Friday, 7 to 9', 'Oat milk at no extra cost'],
      end_headline: 'See you in the morning', end_body: 'Open 7 to 4, every day', cta_label: 'Come by',
    },
  },
  {
    slug: 'dental',
    theme: { primary: '#0E7C86', secondary: '#F4B860', brandName: 'Bright Smile Dental', style: 'modern' },
    promo: {
      kind: 'promo', kicker: 'New patients', headline: 'Cleaning, exam and X-rays', price: '$99',
      details: ['Through the end of December', 'Most insurance welcome'],
      end_headline: 'Book your first visit', end_body: 'brightsmile.com', cta_label: 'Book now',
    },
  },
];

async function main() {
  const [outDir, photoDir] = process.argv.slice(2);
  if (!outDir) throw new Error('usage: render-animated-samples.ts <outDir> [photoDir]');
  mkdirSync(outDir, { recursive: true });
  const svc = new AnimatedReelService(new GraphicsService());
  let seed = 0;
  for (const s of SAMPLES) {
    const look = reelLook(s.theme);
    const jobs: Array<[string, AnimatedReelSpec]> = [[`${s.slug}-promo`, s.promo]];
    const before = photoDir && join(photoDir, `${s.slug}-before.jpg`);
    const after = photoDir && join(photoDir, `${s.slug}-after.jpg`);
    if (s.reveal && before && after && existsSync(before) && existsSync(after)) jobs.push([`${s.slug}-reveal`, s.reveal]);
    for (const [name, spec] of jobs) {
      const fit = layoutSpec(spec, look);
      if (!fit.ok) {
        console.log(`${name}: does not fit: ${fit.problems.join('; ')}`);
        continue;
      }
      const photos =
        spec.kind === 'before_after'
          ? { before: await svc.preparePhoto(readFileSync(before!)), after: await svc.preparePhoto(readFileSync(after!)) }
          : undefined;
      const { mp4, stats } = await svc.render(fit.layout, look, { photos, seed: seed++ });
      const file = join(outDir, `${name}.mp4`);
      writeFileSync(file, mp4);
      console.log(`${name}: ${stats.drawn}/${stats.frames} frames drawn, ${(stats.ms / 1000).toFixed(1)}s, ${(stats.bytes / 1e6).toFixed(2)}MB`);
      // Stills at the beats, side by side, for a quick look without playing it.
      execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', file, '-vf',
        "select='eq(n\\,30)+eq(n\\,75)+eq(n\\,120)+eq(n\\,180)+eq(n\\,250)+eq(n\\,320)',scale=270:-1,tile=6x1",
        '-frames:v', '1', '-q:v', '3', join(outDir, `${name}-strip.jpg`)]);
    }
  }
}

void main();
