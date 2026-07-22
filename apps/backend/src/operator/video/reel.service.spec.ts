import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ReelService } from './reel.service';

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
 */
const FONT = join(__dirname, '..', 'graphics', 'fonts', 'Anton-Regular.ttf');

let work: string;
let clip: string;
const svc = new ReelService();

/**
 * Crop the band where the hook sits and measure the encoded PNG size. A flat
 * colour compresses to almost nothing; type in a filled box does not. That
 * difference is what tells us the overlay really made it onto the frame.
 */
async function hookBandBytes(mp4: Buffer, tag: string): Promise<number> {
  const f = join(work, `${tag}.mp4`);
  writeFileSync(f, mp4);
  const png = join(work, `${tag}.png`);
  await run(ffmpegPath, ['-y', '-i', f, '-frames:v', '1', '-vf', 'crop=1080:260:0:230', png]);
  return statSync(png).size;
}

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
  let baseline = 0;

  it('establishes what an empty hook band looks like', async () => {
    baseline = await hookBandBytes(await svc.assemble({ clipPaths: [clip] }), 'baseline');
    assert.ok(baseline < 8000, `a flat band should compress small, got ${baseline}`);
  });

  // Every one of these is copy an owner or the drafter could plausibly write.
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
        clipPaths: [clip], hookText: hook, fontPath: FONT, accentHex: '#8A2E3B',
      });
      const bytes = await hookBandBytes(out, name.replace(/\W/g, '_'));
      assert.ok(
        bytes > baseline * 1.5,
        `hook "${hook}" did not render — band was ${bytes}b against a ${baseline}b empty baseline`,
      );
    });
  }

  it('still produces a reel when no font is available to draw with', async () => {
    const out = await svc.assemble({
      clipPaths: [clip], hookText: 'No font here', fontPath: join(work, 'missing.ttf'),
    });
    assert.ok(out.length > 0, 'a missing font should cost the hook, not the reel');
  });
});
