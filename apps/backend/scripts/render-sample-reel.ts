/**
 * Render a sample reel through the REAL reel pipeline (captions → ASS →
 * ReelService.assemble), from still photos turned into short moving clips, so
 * caption placement, the hook and the end card can be looked at.
 *
 *   npx tsx scripts/render-sample-reel.ts <out.mp4> <photo1.jpg> <photo2.jpg> [photo3.jpg] [--style=bold] [--accent=#C9A227] [--name="Sharp & Co"] [--hook="..."] [--type="barbershop"] [--site=sharpandco.com]
 *
 * The "footage" is made with ffmpeg's zoompan (slow push-ins and pans), with a
 * quiet tone for audio, and the transcript is a fixed script with hand timings
 * — there is no speech to transcribe. It shows the edit and the overlays, not
 * what a real phone clip looks like.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphicsService } from '../src/operator/graphics/graphics.service';
import type { BrandStyle } from '../src/operator/graphics/slide-templates';
import { captionsToAss, type TranscriptWord } from '../src/operator/video/captions';
import { mapWordsToTimeline } from '../src/operator/video/edl';
import { endCardCopy } from '../src/operator/video/end-card';
import { ReelService } from '../src/operator/video/reel.service';

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const [out, ...rest] = args.filter((a) => !a.startsWith('--'));
const photos = rest;
if (!out || photos.length < 2) throw new Error('usage: <out.mp4> <photo1> <photo2> [photo3]');

const style = flag('style', 'editorial') as BrandStyle;
const accent = flag('accent', '#E7B27A');
const primary = flag('primary', '#7C3A24');
const name = flag('name', "Rosa's Coffee");
const type = flag('type', 'coffee shop');
const site = flag('site', '');
const hook = flag('hook', 'The first pour of the morning, every single day');
const SCRIPT = flag(
  'script',
  'Every morning starts the same way. Fresh beans, a careful pour, and the first cup always goes to whoever is waiting at the door.',
);

const CLIP_SECS = 3.6;
const work = mkdtempSync(join(tmpdir(), 'sample-reel-'));

/** A still → a moving vertical clip: alternate push-in, pull-out and pan. */
function clipFrom(photo: string, i: number): string {
  const p = join(work, `clip${i}.mp4`);
  const frames = Math.round(CLIP_SECS * 30);
  const moves = [
    `z='min(zoom+0.0016,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `z='if(eq(on,0),1.25,max(zoom-0.0016,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `z=1.2:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`,
  ];
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-i', photo,
    '-f', 'lavfi', '-i', `sine=frequency=${220 + i * 55}:sample_rate=44100`,
    '-filter_complex',
    `[0:v]scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,` +
      `zoompan=${moves[i % moves.length]}:d=${frames}:s=1080x1920:fps=30,format=yuv420p[v];` +
      `[1:a]volume=0.04[a]`,
    '-map', '[v]', '-map', '[a]', '-t', String(CLIP_SECS),
    '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', p,
  ]);
  return p;
}

/**
 * Spread the script across the clips, as if spoken: one sentence per clip when
 * the counts match (a clip that ends mid-phrase leaves a one-word caption that
 * real footage wouldn't), otherwise the words evenly.
 */
function transcripts(n: number): TranscriptWord[][] {
  const sentences = SCRIPT.match(/[^.!?]+[.!?]+/g)?.map((x) => x.trim()) ?? [];
  const words = SCRIPT.split(/\s+/);
  const per = Math.ceil(words.length / n);
  return Array.from({ length: n }, (_, c) => {
    const mine = sentences.length === n ? sentences[c].split(/\s+/) : words.slice(c * per, (c + 1) * per);
    const step = (CLIP_SECS - 0.4) / Math.max(1, mine.length);
    return mine.map((text, k) => ({ text, start: 0.2 + k * step, end: 0.2 + (k + 0.9) * step }));
  });
}

async function main() {
  const clips = photos.map(clipFrom);
  const edl = {
    segments: clips.map((_, i) => ({ clip_index: i, start: 0, end: CLIP_SECS })),
    hook,
  };
  const ass = captionsToAss(mapWordsToTimeline(edl, transcripts(clips.length)), {
    accentHex: accent,
    brandStyle: style,
    hookText: hook,
  });
  const copy = endCardCopy({ businessName: name, businessType: type, websiteUrl: site });
  const card = new GraphicsService().renderSlide(
    { kind: 'cta', headline: copy.headline, body: copy.body, ctaLabel: copy.ctaLabel, footer: '', variant: 0 },
    { primary, secondary: accent, brandName: name, style },
  );
  const mp4 = await new ReelService().assemble({
    clipPaths: clips,
    edl,
    captionsAss: ass,
    endCardPng: card,
    fontsDir: join(__dirname, '..', 'src', 'operator', 'graphics', 'fonts'),
  });
  writeFileSync(out, mp4);
  console.log(`wrote ${out} (${(mp4.length / 1e6).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
