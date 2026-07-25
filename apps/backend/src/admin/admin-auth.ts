import { NotFoundException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * The one admin gate. Throws NotFoundException (a 404, not a 401 — the routes
 * "don't exist" without the token) unless the caller presents the exact
 * ADMIN_TOKEN. Fails closed: no token configured on the server → nothing passes.
 *
 * Constant-time compare: the Stripe webhook already uses timingSafeEqual, and
 * this is the gate for ALL operator data, so it shouldn't leak the token a byte
 * at a time through response timing the way `!==` does.
 */
export function assertAdmin(token: string | undefined): void {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !token) throw new NotFoundException();
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new NotFoundException();
  }
}
