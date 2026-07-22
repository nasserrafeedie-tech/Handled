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

/**
 * OpenAI's GPT Image — the default, chosen after a head-to-head across FLUX 2,
 * Nano Banana Pro, GPT Image, and Imagen 4. It won on realism and on following
 * the prompt, which matters here: our prompts carry the whole safety contract
 * ("no text, no faces, no logos"), so the model that obeys the prompt most
 * faithfully is the one least likely to break it.
 *
 * The Images API has no separate negative-prompt field — every constraint has
 * to live in the prompt, which is already how image-prompt.ts builds it.
 */
class OpenAiProvider implements ImageProvider {
  readonly name = 'openai';
  private static readonly ENDPOINT = 'https://api.openai.com/v1/images/generations';

  async generate(prompt: string, _opts: GenerateOptions): Promise<Buffer> {
    const res = await fetch(OpenAiProvider.ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        // Overridable because image model ids are exactly the kind of string
        // that changes under you; the default is the current flagship.
        model: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2',
        prompt,
        n: 1,
        // Always square. GPT Image's only portrait size is 2:3, which is taller
        // than Instagram's 4:5 floor and would fail the pre-publish check — so
        // for a compliant portrait there is no native option, and square is
        // valid in every feed. (Aspect is 1:1 everywhere we call this today.)
        size: '1024x1024',
        // Medium, deliberately. "high" roughly quadruples the cost per image
        // for a difference an owner will not see in a feed thumbnail.
        quality: 'medium',
        output_format: 'jpeg',
      }),
    });

    if (!res.ok) {
      throw new Error(
        `openai ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`,
      );
    }

    // GPT Image returns base64 inline, not a URL to fetch.
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('openai returned no image');
    return Buffer.from(b64, 'base64');
  }
}

/** FAL, hosting FLUX. Kept as a fallback — the interface makes it a one-line
 *  switch back, and the head-to-head was close on the food shots. */
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

/**
 * Pick the image provider from what's configured. OpenAI is the chosen default;
 * FLUX stays available so a bad month for one vendor is a one-env-var switch,
 * not a code change. Null when neither key is set — callers fall back to asking
 * the owner for a photo rather than failing the post.
 */
function selectProvider(): ImageProvider | null {
  if (process.env.OPENAI_API_KEY) return new OpenAiProvider();
  if (process.env.FAL_API_KEY) return new FalProvider();
  return null;
}

@Injectable()
export class ImageGenService {
  private readonly log = new Logger(ImageGenService.name);
  private readonly provider: ImageProvider | null = selectProvider();

  /** True once an image key is set. Callers fall back rather than failing a post. */
  get configured(): boolean {
    return this.provider !== null;
  }

  /**
   * Generate one image from an already-built prompt.
   *
   * The prompt is built by image-prompt.ts and passed in whole — this service
   * deliberately cannot construct one, so there is no second path to an image
   * that skipped the constraints.
   */
  async generate(prompt: string, opts: GenerateOptions = {}): Promise<GeneratedImage> {
    const provider = this.provider;
    if (!provider) {
      throw new Error('no image provider configured (set OPENAI_API_KEY)');
    }

    const started = Date.now();
    const bytes = await provider.generate(prompt, opts);

    // The provider is a third party and the result goes into a bucket we serve
    // under our own domain. Same rule as owner uploads: the bytes decide what
    // this is, not what anybody claims it is.
    const detected = detectMedia(bytes);
    if (!detected || detected.kind !== 'image') {
      throw new Error(
        `${provider.name} returned something that is not an image ` +
          `(${bytes.length} bytes)`,
      );
    }

    this.log.log(
      `generated ${detected.ext} via ${provider.name} in ${Date.now() - started}ms`,
    );
    return {
      bytes,
      contentType: detected.contentType,
      ext: detected.ext,
      prompt,
    };
  }
}
