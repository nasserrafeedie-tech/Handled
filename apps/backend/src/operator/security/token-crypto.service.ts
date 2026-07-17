import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

/**
 * §8: "OAuth tokens encrypted at rest, minimal scopes, revocable. We hold keys
 * to people's livelihoods." AES-256-GCM with a 32-byte key from
 * TOKEN_ENCRYPTION_KEY (base64). Ciphertext format: iv:tag:data (base64 parts).
 * connected_accounts stores only the output of `encrypt`.
 */
@Injectable()
export class TokenCryptoService {
  private readonly log = new Logger(TokenCryptoService.name);
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.TOKEN_ENCRYPTION_KEY ?? '';
    const key = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
    if (key.length !== 32) {
      this.log.warn(
        'TOKEN_ENCRYPTION_KEY missing or not 32 bytes (base64). ' +
          'Token encryption will fail until set — required before connecting accounts.',
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): string {
    this.assertKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  }

  decrypt(ciphertext: string): string {
    this.assertKey();
    const [ivB64, tagB64, dataB64] = ciphertext.split(':');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('malformed ciphertext');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private assertKey(): void {
    if (this.key.length !== 32) {
      throw new Error('TOKEN_ENCRYPTION_KEY not configured (need 32 bytes base64)');
    }
  }
}
