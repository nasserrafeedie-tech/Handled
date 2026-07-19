import { Injectable } from '@nestjs/common';
import { Resvg } from '@resvg/resvg-js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  renderSlideSvg,
  type SlideSpec,
  type BrandTheme,
  CANVAS,
} from './slide-templates';

/**
 * Turns slide specs into real PNG images. The SVG we build is always
 * pixel-crisp and correctly spelled; this service just rasterizes it.
 *
 * We bundle premium fonts (Poppins + Playfair Display) so the output looks
 * professionally designed and identical in every environment — instead of
 * whatever generic system font happens to be installed.
 */
@Injectable()
export class GraphicsService {
  private readonly fontFiles: string[] = GraphicsService.loadBundledFonts();

  /** Resolve the bundled font .ttf files (works from both src/ and dist/). */
  private static loadBundledFonts(): string[] {
    const candidates = [
      join(__dirname, 'fonts'),
      // dist build keeps .ts next to compiled output; fonts are copied by nest-cli assets.
      join(__dirname, '..', '..', '..', 'src', 'operator', 'graphics', 'fonts'),
    ];
    for (const dir of candidates) {
      if (existsSync(dir)) {
        const files = readdirSync(dir)
          .filter((f) => f.toLowerCase().endsWith('.ttf'))
          .map((f) => join(dir, f));
        if (files.length) return files;
      }
    }
    return [];
  }

  /**
   * Turn a photo URL into the data URI a slide spec wants. The rasterizer can't
   * reach the network, so the bytes have to be inlined before rendering.
   */
  async fetchPhoto(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`photo fetch failed → ${res.status} ${res.statusText}`);
    }
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    const b64 = Buffer.from(await res.arrayBuffer()).toString('base64');
    return `data:${type};base64,${b64}`;
  }

  /** Render one slide spec to a PNG buffer (1080×1080). */
  renderSlide(spec: SlideSpec, theme: BrandTheme): Buffer {
    const svg = renderSlideSvg(spec, theme);
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: CANVAS },
      font: {
        fontFiles: this.fontFiles,
        loadSystemFonts: this.fontFiles.length === 0, // fall back only if bundling failed
        defaultFontFamily: 'Poppins',
      },
      background: 'rgba(0,0,0,0)',
    });
    return Buffer.from(resvg.render().asPng());
  }

  /** Render a multi-slide Instagram carousel — one PNG per slide, in order. */
  renderCarousel(specs: SlideSpec[], theme: BrandTheme): Buffer[] {
    return specs.map((s) => this.renderSlide(s, theme));
  }
}
