import { Injectable, Logger } from '@nestjs/common';
import { detectMedia } from '../../common/media-type';
import { NEGATIVE_PROMPT } from './image-prompt';

/**
 * Generating photographs for owners who do not have time to take them.
 *
 * Deliberately a thin seam over one vendor, behind an interface. The video
 * engine made the same call for the same reason: image models change fast, and
 * the pricing changes faster, so the thing that must not leak into the rest of
 * the codebase is which one we happen to be using this month.
 *
 * What comes back is treated as untrusted bytes, not as an image, because it
 * arrives over the network from a third party and lands in a bucket we serve.
 */

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
  ext: string;
  /** The exact prompt used, kept for the audit trail. */
  prompt: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(prompt: string, opts: GenerateOptions): Promise<Buffer>;
}

export interface GenerateOptions {
  /** Square by default — it is the one shape valid in every feed. */
  aspect?: '1:1' | '4:5';
  negativePrompt?: string;
}

/** FAL, hosting FLUX. Chosen because the key was already provisioned. */
class FalProvider implements ImageProvider {
  readonly name = 'fal';
  private static readonly ENDPOINT = 'https://fal.run/fal-ai/flux/dev';

  async generate(prompt: string, opts: GenerateOptions): Promise<Buffer> {
    const res = await fetch(FalProvider.ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Key ${process.env.FAL_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        negative_prompt: opts.negativePrompt ?? NEGATIVE_PROMPT,
        // 4:5 is the tallest shape Instagram's feed accepts; 1:1 is safe
        // everywhere. Both sit inside the window platform-limits enforces.
        image_size: opts.aspect === '4:5' ? 'portrait_4_3' : 'square_hd',
        num_images: 1,
        enable_safety_checker: true,
      }),
    });

    if (!res.ok) {
      throw new Error(
        `fal ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as { images?: { url?: string }[] };
    const url = json.images?.[0]?.url;
    if (!url) throw new Error('fal returned no image');

    const img = await fetch(url);
    if (!img.ok) throw new Error(`fetching generated image: ${img.status}`);
    return Buffer.from(await img.arrayBuffer());
  }
}

@Injectable()
export class ImageGenService {
  private readonly log = new Logger(ImageGenService.name);
  private readonly provider: ImageProvider = new FalProvider();

  /** True once a key is set. Callers fall back rather than failing a post. */
  get configured(): boolean {
    return Boolean(process.env.FAL_API_KEY);
  }

  /**
   * Generate one image from an already-built prompt.
   *
   * The prompt is built by image-prompt.ts and passed in whole — this service
   * deliberately cannot construct one, so there is no second path to an image
   * that skipped the constraints.
   */
  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GeneratedImage> {
    if (!this.configured) throw new Error('FAL_API_KEY not configured');

    const started = Date.now();
    const bytes = await this.provider.generate(prompt, opts);

    // The provider is a third party and the result goes into a bucket we serve
    // under our own domain. Same rule as owner uploads: the bytes decide what
    // this is, not what anybody claims it is.
    const detected = detectMedia(bytes);
    if (!detected || detected.kind !== 'image') {
      throw new Error(
        `${this.provider.name} returned something that is not an image ` +
          `(${bytes.length} bytes)`,
      );
    }

    this.log.log(
      `generated ${detected.ext} via ${this.provider.name} in ${Date.now() - started}ms`,
    );
    return {
      bytes,
      contentType: detected.contentType,
      ext: detected.ext,
      prompt,
    };
  }
}
