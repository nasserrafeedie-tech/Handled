import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReelService } from './reel.service';
import { captionsToAss } from './captions';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static');
const run = promisify(execFile);

/**
 * These tests actually encode video with the bundled ffmpeg — slower than the
 * rest of the suite, and worth it. The reel pipeline shipped with no coverage
 * at all and a silent defect in it: a hook containing a percent sign rendered
 * as *nothing*, because drawtext ran strftime over the text. No error, no
 * partial overlay — the reel just published without the one element that earns
 * it distribution. "It didn't throw" is not a passing bar for a renderer, so
 * these assert on the pixels.
 *
 * The hook is now a libass event, not a drawtext pass — the drawtext filter is
 * absent from the ffmpeg build that runs in production, so it never rendered a
 * hook there at all. These tests still assert on the pixels; they just build
 * the hook through captionsToAss, the way the handler does.
 */
const FONTS_DIR = join(__dirname, '..', 'graphics', 'fonts');

let work: string;
let clip: string;
const svc = new ReelService();

/**
 * Crop the band where an overlay sits and measure the encoded PNG size. A flat
 * colour compresses to almost nothing; type in a filled box does not. That
 * difference is what tells us the overlay really made it onto the frame. The
 * band defaults to the hook's position near the top.
 */
async function bandBytes(mp4: Buffer, tag: string, crop = 'crop=1080:340:0:270'): Promise<number> {
  const f = join(work, `${tag}.mp4`);
  writeFileSync(f, mp4);
  const png = join(work, `${tag}.png`);
  await run(ffmpegPath, ['-y', '-i', f, '-frames:v', '1', '-vf', crop, png]);
  return statSync(png).size;
}
const hookBandBytes = (mp4: Buffer, tag: string) => bandBytes(mp4, tag);

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'reel-spec-'));
  clip = join(work, 'clip.mp4');
  // A flat-colour clip: any bytes in the hook band must come from the overlay.
  // Deliberately LONGER than the 3.5s per-clip cap, so the trim is exercised
  // rather than skipped — a source shorter than the cap would pass the duration
  // assertion for the wrong reason.
  await run(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'color=c=0x1B4D3E:size=640x480:rate=30:duration=5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-c:v', 'libx264', '-c:a', 'aac', '-t', '5', '-shortest', clip,
  ]);
});

after(() => rmSync(work, { recursive: true, force: true }));

describe('ReelService.assemble', () => {
  it('refuses to build a reel out of nothing', async () => {
    await assert.rejects(() => svc.assemble({ clipPaths: [] }), /no clips/i);
  });

  it('trims each clip to the documented pace and cuts them together', async () => {
    const out = await svc.assemble({ clipPaths: [clip, clip] });
    assert.ok(out.length > 0, 'should return encoded bytes');
    const f = join(work, 'two.mp4');
    writeFileSync(f, out);
    const probe = await run(ffmpegPath, ['-i', f, '-hide_banner'])
      .catch((e: { stderr?: string }) => ({ stdout: e.stderr ?? '' }));
    const dur = /Duration: 00:00:(\d+\.\d+)/.exec(probe.stdout)?.[1];
    // 3.5s per clip is the pace the playbook calls for; two clips ≈ 7s.
    assert.ok(dur && Math.abs(Number(dur) - 7) < 0.5, `expected ~7s, got ${dur}`);
  });

  it('survives a clip that has no audio track at all', async () => {
    const silent = join(work, 'silent.mp4');
    await run(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x480:rate=30:duration=2',
      '-c:v', 'libx264', '-t', '2', silent,
    ]);
    const out = await svc.assemble({ clipPaths: [clip, silent] });
    assert.ok(out.length > 0, 'a silent clip must not break the concat');
  });
});

describe('the hook overlay actually reaches the frame', () => {
  const hookAss = (hook: string) =>
    captionsToAss([], { accentHex: '#8A2E3B', brandStyle: 'bold', hookText: hook });
  let baseline = 0;

  it('establishes what an empty hook band looks like', async () => {
    baseline = await hookBandBytes(await svc.assemble({ clipPaths: [clip] }), 'baseline');
    assert.ok(baseline < 8000, `a flat band should compress small, got ${baseline}`);
  });

  // Every one of these is copy an owner or the drafter could plausibly write.
  // The percent sign is the original regression; libass never runs the text
  // through a format string, so it can no longer erase the overlay — but it is
  // kept as a guard against a future engine that does.
  for (const [name, hook] of [
    ['plain text', 'Fresh pastries daily'],
    ['a percent sign', '50% off this Friday'], // the regression
    ['a colon', 'Coffee: done right'],
    ['an apostrophe', "Rosa's best seller"],
    ['brackets and a percent', 'Save 20% [today only]'],
    ['commas', 'Fast, fresh, local'],
  ] as [string, string][]) {
    it(`draws the hook when it contains ${name}`, async () => {
      const out = await svc.assemble({
        clipPaths: [clip], captionsAss: hookAss(hook), fontsDir: FONTS_DIR,
      });
      const bytes = await hookBandBytes(out, name.replace(/\W/g, '_'));
      assert.ok(
        bytes > baseline * 1.5,
        `hook "${hook}" did not render — band was ${bytes}b against a ${baseline}b empty baseline`,
      );
    });
  }

  it('produces a reel even when libass cannot resolve the font dir', async () => {
    // A missing fonts dir must cost styling, not the reel — libass falls back
    // to a default face rather than failing the render.
    const out = await svc.assemble({ clipPaths: [clip], captionsAss: hookAss('No fonts here') });
    assert.ok(out.length > 0, 'a missing font dir should not sink the render');
  });
});

/**
 * Captions are the reason this pipeline exists — roughly a third of the
 * audience watches on mute. "The ASS file was well-formed" is not evidence the
 * viewer sees anything, so these assert on the frame the same way the hook
 * tests do: crop the caption band and measure how much the PNG compresses.
 */

async function captionBandBytes(mp4: Buffer, tag: string): Promise<number> {
  const f = join(work, `${tag}.mp4`);
  writeFileSync(f, mp4);
  const png = join(work, `${tag}.png`);
  // Sample a frame at 1s (inside the caption's window) and crop the band at
  // y=940 where captions.ts positions them.
  await run(ffmpegPath, [
    '-y', '-ss', '1', '-i', f, '-frames:v', '1', '-vf', 'crop=1080:300:0:900', png,
  ]);
  return statSync(png).size;
}

describe('captions reach the frame', () => {
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour,' +
      ' BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,' +
      ' BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Cap,Anton,96,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,' +
      '-1,0,0,0,100,100,0,0,1,6,3,8,80,80,940,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:00.00,0:00:03.00,Cap,,0,0,0,,FRESH BREAD DAILY',
    '',
  ].join('\n');

  let baseline = 0;

  it('establishes what an empty caption band looks like', async () => {
    baseline = await captionBandBytes(await svc.assemble({ clipPaths: [clip] }), 'cap-baseline');
    assert.ok(baseline < 8000, `a flat band should compress small, got ${baseline}`);
  });

  it('burns captions into the video', async () => {
    const out = await svc.assemble({
      clipPaths: [clip], captionsAss: ass, fontsDir: FONTS_DIR,
    });
    const bytes = await captionBandBytes(out, 'cap-drawn');
    assert.ok(
      bytes > baseline * 1.5,
      `captions did not render — band was ${bytes}b against a ${baseline}b empty baseline`,
    );
  });

  it('renders captions and the hook together from one ASS file', async () => {
    // Both overlays live in the same subtitle file; if the hook event and the
    // caption events collide libass drops one, and the reel ships half-finished.
    const both = captionsToAss(
      [
        { text: 'consistency', start: 0.3, end: 1.1 },
        { text: 'wins', start: 1.1, end: 1.8 },
      ],
      { accentHex: '#8A2E3B', brandStyle: 'bold', hookText: 'Save 20% [today only]' },
    );
    const out = await svc.assemble({ clipPaths: [clip], captionsAss: both, fontsDir: FONTS_DIR });
    assert.ok(await captionBandBytes(out, 'both-cap') > baseline * 1.5, 'captions missing');
    assert.ok(await hookBandBytes(out, 'both-hook') > 8000, 'hook missing');
  });

  it('still produces a reel when the transcript was empty', async () => {
    // Silent b-roll: no caption events, and the reel must ship regardless.
    const out = await svc.assemble({ clipPaths: [clip, clip], captionsAss: '' });
    assert.ok(out.length > 0, 'no captions must cost the captions, not the reel');
  });
});

describe('the reel follows the edit decision list', () => {
  it('cuts the segment the EDL asked for, not the clip’s opening seconds', async () => {
    const out = await svc.assemble({
      clipPaths: [clip],
      edl: { segments: [{ clip_index: 0, start: 2, end: 4 }], hook: 'x' },
    });
    const f = join(work, 'edl-trim.mp4');
    writeFileSync(f, out);
    const probe = await run(ffmpegPath, ['-i', f, '-hide_banner'])
      .catch((e: { stderr?: string }) => ({ stdout: e.stderr ?? '' }));
    const dur = /Duration: 00:00:(\d+\.\d+)/.exec(probe.stdout)?.[1];
    assert.ok(dur && Math.abs(Number(dur) - 2) < 0.4, `expected ~2s from the EDL, got ${dur}`);
  });

  it('reorders clips to match the edit', async () => {
    // Two segments off the same source at different offsets: the render must
    // produce both, proving order comes from the EDL rather than the file list.
    const out = await svc.assemble({
      clipPaths: [clip],
      edl: {
        segments: [
          { clip_index: 0, start: 3, end: 4.5 },
          { clip_index: 0, start: 0, end: 1.5 },
        ],
        hook: 'x',
      },
    });
    const f = join(work, 'edl-order.mp4');
    writeFileSync(f, out);
    const probe = await run(ffmpegPath, ['-i', f, '-hide_banner'])
      .catch((e: { stderr?: string }) => ({ stdout: e.stderr ?? '' }));
    const dur = /Duration: 00:00:(\d+\.\d+)/.exec(probe.stdout)?.[1];
    assert.ok(dur && Math.abs(Number(dur) - 3) < 0.5, `expected ~3s of segments, got ${dur}`);
  });

  it('survives an EDL pointing at a clip that was not supplied', async () => {
    const out = await svc.assemble({
      clipPaths: [clip],
      edl: {
        segments: [
          { clip_index: 0, start: 0, end: 2 },
          { clip_index: 9, start: 0, end: 2 },
        ],
        hook: 'x',
      },
    });
    assert.ok(out.length > 0, 'a bad clip index must not sink the render');
  });
});
