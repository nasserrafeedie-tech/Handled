import { Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Media storage. Always writes the local media dir (so offline previews via
 * /media keep working), and ALSO pushes to Cloudflare R2 the moment the four
 * R2_* env vars exist — no code change on launch day. R2 speaks the S3 API.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private client: import('@aws-sdk/client-s3').S3Client | null | undefined;

  get mediaDir(): string {
    return process.env.MEDIA_DIR ?? join(__dirname, '..', '..', 'media');
  }

  private r2() {
    if (this.client !== undefined) return this.client;
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
      this.client = null;
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { S3Client } = require('@aws-sdk/client-s3');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    });
    return this.client;
  }

  /** Store bytes under `key`. Local always; R2 when configured. */
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const path = join(this.mediaDir, key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);

    const client = this.r2();
    if (!client) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    } catch (err) {
      // When R2 is configured it IS the backend that public URLs are served
      // from — the local copy on an ephemeral dyno is never seen. So a failed
      // upload is a real failure, not a swallow-and-carry-on: throwing here
      // fails the task loudly instead of leaving a mediaRef that resolves to a
      // 404 the owner (and their followers) would see on a published post.
      this.log.error(`R2 upload failed for ${key}: ${String(err)}`);
      throw new Error(`R2 upload failed for ${key}: ${String(err)}`);
    }
  }

  /**
   * Read bytes back for a stored key — used to composite a stored logo into a
   * slide. Reads the local copy (always written by `put`) and falls back to R2
   * when the local file isn't present (e.g. a fresh dyno that never wrote it).
   * Returns null rather than throwing: a missing logo must degrade to no logo,
   * never fail the whole render.
   */
  async get(key: string): Promise<Buffer | null> {
    const { readFileSync, existsSync } = require('node:fs') as typeof import('node:fs');
    const path = join(this.mediaDir, key);
    if (existsSync(path)) {
      try {
        return readFileSync(path);
      } catch {
        /* fall through to R2 */
      }
    }
    const client = this.r2();
    if (!client) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const res: any = await client.send(
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray?.();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      this.log.warn(`R2 get failed for ${key}: ${String(err)}`);
      return null;
    }
  }

  /**
   * Public URL for a stored key (R2 public base preferred).
   *
   * Only serve from the R2 base when R2 is actually CONFIGURED. Otherwise a
   * deploy with R2_PUBLIC_BASE_URL set but an upload credential missing would
   * hand out R2 URLs for bytes that were only ever written locally and never
   * uploaded — a 404 on every image. If R2 isn't wired up, serve the local copy.
   */
  publicUrl(key: string): string {
    const r2base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');
    if (r2base && this.r2()) return `${r2base}/${key}`;
    const base = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
    return `${base}/media/${key}`;
  }
}
