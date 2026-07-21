/**
 * "Is production actually ready to take a real customer?"
 *
 * Every launch-critical env var, checked for presence AND plausible shape —
 * a key pasted with a trailing newline, a Stripe *test* key left in
 * production, or LLM_FAKE still at 1 all look fine in a dashboard and fail
 * silently at 2am. This turns that into a plain-English go/no-go table.
 *
 * It NEVER returns a secret value — only whether it is set and whether its
 * format looks right. The endpoint that serves it is admin-gated anyway.
 */

export type CheckState = 'ready' | 'missing' | 'malformed' | 'not_yet';

export interface ReadinessCheck {
  /** What this unlocks, in the owner's words — not the variable name. */
  what: string;
  state: CheckState;
  /** Plain-English detail: what's wrong, or what to do about it. */
  note: string;
  /** Blocks launch vs. can wait until the first customer. */
  blocking: boolean;
}

export interface ReadinessGroup {
  name: string;
  state: CheckState;
  checks: ReadinessCheck[];
}

export interface ReadinessReport {
  go: boolean;
  headline: string;
  blockers: string[];
  waiting: string[];
  groups: ReadinessGroup[];
  checkedAt: string;
}

const env = (k: string): string => (process.env[k] ?? '').trim();
const isSet = (k: string): boolean => env(k).length > 0;

/** Would this value break because someone pasted it with whitespace? */
const hasStrayWhitespace = (k: string): boolean => {
  const raw = process.env[k];
  return typeof raw === 'string' && raw !== raw.trim() && raw.trim().length > 0;
};

function check(
  what: string,
  keys: string[],
  opts: {
    blocking: boolean;
    /** Extra shape validation; return an error string when it looks wrong. */
    validate?: () => string | null;
    /** Note shown when everything is fine. */
    okNote?: string;
    /** Note shown when it isn't set yet (non-blocking items). */
    pendingNote?: string;
  },
): ReadinessCheck {
  const missing = keys.filter((k) => !isSet(k));
  if (missing.length > 0) {
    return {
      what,
      state: opts.blocking ? 'missing' : 'not_yet',
      note: opts.blocking
        ? `Not set: ${missing.join(', ')}`
        : (opts.pendingNote ?? `Not set yet: ${missing.join(', ')}`),
      blocking: opts.blocking,
    };
  }
  const sloppy = keys.filter(hasStrayWhitespace);
  if (sloppy.length > 0) {
    return {
      what,
      state: 'malformed',
      note: `Has stray spaces or a line break — re-paste it: ${sloppy.join(', ')}`,
      blocking: opts.blocking,
    };
  }
  const problem = opts.validate?.();
  if (problem) {
    return { what, state: 'malformed', note: problem, blocking: opts.blocking };
  }
  return {
    what,
    state: 'ready',
    note: opts.okNote ?? 'Set and looks right.',
    blocking: opts.blocking,
  };
}

const worstState = (checks: ReadinessCheck[]): CheckState => {
  if (checks.some((c) => c.state === 'missing')) return 'missing';
  if (checks.some((c) => c.state === 'malformed')) return 'malformed';
  if (checks.some((c) => c.state === 'not_yet')) return 'not_yet';
  return 'ready';
};

export function buildReadinessReport(): ReadinessReport {
  const isProd = process.env.NODE_ENV === 'production';

  const groups: ReadinessGroup[] = [];

  // ── Writing real content ────────────────────────────────────────────────
  const brain: ReadinessCheck[] = [
    check('Claude writes the captions', ['ANTHROPIC_API_KEY'], {
      blocking: true,
      validate: () =>
        env('ANTHROPIC_API_KEY').startsWith('sk-ant-')
          ? null
          : 'Key does not start with "sk-ant-" — is that really an Anthropic key?',
      okNote: 'Anthropic key is set.',
    }),
    (() => {
      const fake = env('LLM_FAKE');
      if (fake === '1') {
        return {
          what: 'Real captions (not placeholder text)',
          state: 'missing' as CheckState,
          note: 'LLM_FAKE is 1 — every customer would get canned filler content. Set it to 0.',
          blocking: true,
        };
      }
      return {
        what: 'Real captions (not placeholder text)',
        state: 'ready' as CheckState,
        note: `LLM_FAKE is ${fake === '' ? 'unset' : fake} — real Claude output.`,
        blocking: true,
      };
    })(),
  ];
  groups.push({ name: 'Writing real content', state: worstState(brain), checks: brain });

  // ── Texting customers ───────────────────────────────────────────────────
  const texting: ReadinessCheck[] = [
    check(
      'Sending and receiving texts',
      ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
      {
        blocking: true,
        validate: () =>
          env('TWILIO_ACCOUNT_SID').startsWith('AC')
            ? null
            : 'Account SID should start with "AC".',
        okNote: 'Twilio credentials are set.',
      },
    ),
    check(
      'A number to text from',
      ['TWILIO_MESSAGING_SERVICE_SID'],
      {
        blocking: true,
        validate: () => {
          const svc = env('TWILIO_MESSAGING_SERVICE_SID');
          const from = env('TWILIO_FROM_NUMBER');
          if (!svc && !from) return 'Neither a messaging service nor a from-number is set.';
          if (svc && !svc.startsWith('MG'))
            return 'Messaging Service SID should start with "MG".';
          if (from && !/^\+[1-9]\d{6,14}$/.test(from))
            return `From-number should look like +14245550199 (got a value that doesn't).`;
          return null;
        },
        okNote: 'Messaging service is set.',
      },
    ),
    check('Twilio can reach us (webhook URL)', ['PUBLIC_BASE_URL'], {
      blocking: true,
      validate: () =>
        env('PUBLIC_BASE_URL').startsWith('https://')
          ? null
          : 'Must be the full https:// URL of this backend — Twilio signs the exact URL it calls.',
      okNote: `Webhook base: ${env('PUBLIC_BASE_URL')}/webhooks/twilio/sms`,
    }),
  ];
  groups.push({ name: 'Texting customers', state: worstState(texting), checks: texting });

  // ── Taking money ────────────────────────────────────────────────────────
  const money: ReadinessCheck[] = [
    check('Charging subscriptions', ['STRIPE_SECRET_KEY'], {
      blocking: true,
      validate: () => {
        const k = env('STRIPE_SECRET_KEY');
        if (!k.startsWith('sk_') && !k.startsWith('rk_'))
          return 'Does not look like a Stripe secret key.';
        if (isProd && k.startsWith('sk_test_'))
          return 'This is a TEST key in production — no real money can be collected.';
        return null;
      },
      okNote: env('STRIPE_SECRET_KEY').startsWith('sk_live_')
        ? 'Live Stripe key.'
        : 'Stripe key set (test mode).',
    }),
    check(
      'The three plan prices',
      ['STRIPE_PRICE_STARTER', 'STRIPE_PRICE_GROWTH', 'STRIPE_PRICE_PRO'],
      {
        blocking: true,
        validate: () => {
          const bad = [
            'STRIPE_PRICE_STARTER',
            'STRIPE_PRICE_GROWTH',
            'STRIPE_PRICE_PRO',
          ].filter((k) => !env(k).startsWith('price_'));
          return bad.length
            ? `Should be Stripe price IDs starting with "price_": ${bad.join(', ')}`
            : null;
        },
        okNote: 'Starter, Growth, and Pro prices are set.',
      },
    ),
    check('Knowing when someone pays', ['STRIPE_WEBHOOK_SECRET'], {
      blocking: true,
      validate: () =>
        env('STRIPE_WEBHOOK_SECRET').startsWith('whsec_')
          ? null
          : 'Should start with "whsec_" — without a valid one, paid signups never start onboarding.',
      okNote: 'Webhook signing secret is set.',
    }),
  ];
  groups.push({ name: 'Taking money', state: worstState(money), checks: money });

  // ── Storing photos and video ────────────────────────────────────────────
  const storage: ReadinessCheck[] = [
    check(
      'Storing customer photos and clips',
      ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
      { blocking: true, okNote: `Cloudflare R2 bucket: ${env('R2_BUCKET')}` },
    ),
    check('Serving those files publicly', ['R2_PUBLIC_BASE_URL'], {
      blocking: true,
      validate: () =>
        env('R2_PUBLIC_BASE_URL').startsWith('https://')
          ? null
          : 'Should be the public https:// base URL for the bucket.',
    }),
  ];
  groups.push({
    name: 'Storing photos and video',
    state: worstState(storage),
    checks: storage,
  });

  // ── Plumbing ────────────────────────────────────────────────────────────
  const plumbing: ReadinessCheck[] = [
    check('The database', ['DATABASE_URL'], {
      blocking: true,
      validate: () =>
        env('DATABASE_URL').startsWith('postgres')
          ? null
          : 'Should be a postgres:// connection string.',
      okNote: 'Postgres connection string is set.',
    }),
    check('The job queue', ['REDIS_URL'], {
      blocking: true,
      validate: () =>
        /^rediss?:\/\//.test(env('REDIS_URL'))
          ? null
          : 'Should be a redis:// or rediss:// URL.',
      okNote: 'Redis is set.',
    }),
    check('Encrypting stored account tokens', ['TOKEN_ENCRYPTION_KEY'], {
      blocking: true,
      validate: () =>
        env('TOKEN_ENCRYPTION_KEY').length >= 32
          ? null
          : 'Should be a long random secret (32+ characters).',
    }),
    check('Your admin view', ['ADMIN_TOKEN'], {
      blocking: true,
      validate: () =>
        env('ADMIN_TOKEN').length >= 16
          ? null
          : 'Should be a long random string (16+ characters) — this is the only lock on your business data.',
    }),
    check('Links we text to customers', ['PUBLIC_SITE_URL'], {
      blocking: true,
      validate: () =>
        env('PUBLIC_SITE_URL').startsWith('https://')
          ? null
          : 'Should be the full https:// URL of the marketing site.',
      okNote: `Customer links point to ${env('PUBLIC_SITE_URL')}`,
    }),
    (() => {
      const cron = env('ENABLE_CRON');
      const on = cron !== '0';
      return {
        what: 'The weekly rhythm (Monday planning, recaps)',
        state: on ? ('ready' as CheckState) : ('not_yet' as CheckState),
        note: on
          ? 'Cron is on — weekly plans and recaps will fire.'
          : 'ENABLE_CRON is 0 — nothing runs automatically. Set it to 1 when you want the machine to start on its own.',
        blocking: false,
      };
    })(),
  ];
  groups.push({ name: 'Plumbing', state: worstState(plumbing), checks: plumbing });

  // ── Waiting on a first customer ─────────────────────────────────────────
  const later: ReadinessCheck[] = [
    check('Publishing to Instagram/Facebook', ['POST_FOR_ME_API_KEY'], {
      blocking: false,
      pendingNote:
        'Not set yet — fine until your first customer connects an account. Drafts still get written and approved without it.',
      okNote: 'Publishing partner is connected.',
    }),
  ];
  groups.push({
    name: 'Waiting on a first customer',
    state: worstState(later),
    checks: later,
  });

  const all = groups.flatMap((g) => g.checks);
  const blockers = all
    .filter((c) => c.blocking && c.state !== 'ready')
    .map((c) => `${c.what}: ${c.note}`);
  const waiting = all
    .filter((c) => !c.blocking && c.state !== 'ready')
    .map((c) => `${c.what}: ${c.note}`);

  const go = blockers.length === 0;
  const headline = go
    ? waiting.length === 0
      ? 'Everything is ready. You can take a real customer today.'
      : `Ready to launch. ${waiting.length} thing${waiting.length > 1 ? 's' : ''} can wait until your first customer.`
    : `Not ready yet — ${blockers.length} thing${blockers.length > 1 ? 's' : ''} would break for a real customer.`;

  return {
    go,
    headline,
    blockers,
    waiting,
    groups,
    checkedAt: new Date().toISOString(),
  };
}
