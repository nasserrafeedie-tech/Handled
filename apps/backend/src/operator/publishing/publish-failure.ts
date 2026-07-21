/**
 * Reading a publish failure well enough to do the right thing about it.
 *
 * A failed publish used to set status='failed' and stop there. The owner was
 * never told, so the whole experience was a post that simply never appeared —
 * and the one thing a done-for-you service cannot afford is the customer
 * finding out from their own empty feed.
 *
 * Three kinds of failure, because three different things should happen:
 *
 *   auth      — the platform connection has lapsed. Retrying cannot fix it and
 *               only the owner can. Ask them to reconnect.
 *   content   — the platform refused this specific post. Retrying the identical
 *               bytes gets the identical refusal, so stop and say what is wrong.
 *   transient — rate limits, timeouts, a platform having a bad afternoon.
 *               Worth another go.
 *
 * The classification is by string matching, which is imprecise, so the default
 * is `transient`: an unknown failure gets retried rather than abandoned, and a
 * post that keeps failing is caught by the reconciliation sweep instead.
 */

export type FailureKind = 'auth' | 'content' | 'transient';

export interface ClassifiedFailure {
  kind: FailureKind;
  /** Safe to store: bounded length, no secrets. */
  detail: string;
  /** What we say to the owner, or null when they need not hear about it. */
  ownerMessage: string | null;
}

/**
 * Postgres will happily store a megabyte of HTML error page, and a log line
 * that long is a log line nobody reads. Platform errors routinely include the
 * echoed request body, stack traces, or a full error page.
 */
export const MAX_DETAIL = 500;

export function truncateDetail(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_DETAIL ? flat : `${flat.slice(0, MAX_DETAIL - 1)}…`;
}

/** Connection has lapsed or been revoked — the owner has to reauthorize. */
const AUTH = [
  /\b401\b/,
  /\b403\b/,
  /access[_ ]token/i,
  /invalid[_ ]token/i,
  /token.{0,20}(expired|invalid|revoked)/i,
  /re-?authenticate/i,
  /session has been invalidated/i,
  /permission|scope|unauthoriz/i,
];

/** The platform looked at this post and said no. */
const CONTENT = [
  /caption|too long|character limit/i,
  /aspect ratio|resolution|dimensions/i,
  /file (?:size|format|type)|unsupported (?:media|format)/i,
  // Size limits get phrased a dozen ways ("Photos should be smaller than
  // 4 MB", "exceeds the maximum", "video too large"). Missing them meant
  // retrying a post that could never succeed.
  /(?:smaller|larger|bigger|greater) than \d+\s?[KMG]B/i,
  /too (?:large|big|long|short|small)\b/i,
  /exceeds?(?: the)? (?:maximum|limit|max)/i,
  /duplicate/i,
  /community (?:standards|guidelines)/i,
  /spam|abusive|violat/i,
  /media (?:not found|expired|fetch failed)/i,
  /invalid (?:url|params|file)/i,
];

/** Worth trying again in a while. */
const TRANSIENT = [
  /\b429\b|rate.?limit/i,
  /\b5\d\d\b/,
  /timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND/i,
  /temporarily|try again|unavailable|overloaded/i,
];

const matches = (patterns: RegExp[], s: string) => patterns.some((p) => p.test(s));

/**
 * Classify a publish error and decide what the owner hears.
 *
 * `platformName` is how the owner refers to it, so the message reads like a
 * person wrote it rather than a system.
 */
export function classifyPublishFailure(
  error: unknown,
  platformName: string,
  reconnectUrl?: string,
): ClassifiedFailure {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = truncateDetail(raw);

  // Auth first: a 401 mentioning a rate limit is still an auth problem, and
  // the reverse reading would have us retry something retrying cannot fix.
  if (matches(AUTH, raw)) {
    return {
      kind: 'auth',
      detail,
      ownerMessage:
        `${platformName} has disconnected, so your post is waiting rather than lost. ` +
        `Reconnecting takes about 20 seconds` +
        (reconnectUrl ? `: ${reconnectUrl}` : ' — say the word and I\'ll send the link.'),
    };
  }

  if (matches(CONTENT, raw)) {
    return {
      kind: 'content',
      detail,
      ownerMessage:
        `${platformName} wouldn't accept that post. I've held it and I'm ` +
        "looking at why — I'll come back to you with a fixed version.",
    };
  }

  if (matches(TRANSIENT, raw)) {
    // Deliberately silent. A retry will probably succeed within minutes, and
    // telling someone about a problem that fixes itself just teaches them to
    // ignore the next message.
    return { kind: 'transient', detail, ownerMessage: null };
  }

  return { kind: 'transient', detail, ownerMessage: null };
}

/** Should this failure be tried again, or is it settled? */
export function isRetryable(kind: FailureKind): boolean {
  return kind === 'transient';
}
