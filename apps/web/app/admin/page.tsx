'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Operator mission control — written for the owner, not a developer.
 * One screen, plain English: what needs attention, who the customers are,
 * who may legally be texted, and what the machine has been posting.
 */

const PLAN_PRICE: Record<string, string> = {
  starter: '$99/mo',
  growth: '$349/mo',
  pro: '$699/mo',
};

const CUSTOMER_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Paying', tone: 'good' },
  onboarding: { label: 'Signing up', tone: 'wait' },
  paused: { label: 'Paused (texted STOP)', tone: 'warn' },
  cancelled: { label: 'Cancelled', tone: 'bad' },
};

const TRUST: Record<string, string> = {
  approve_all: 'You approve every post',
  auto_low_risk: 'Safe posts go out on their own',
  full_auto: 'Full autopilot',
};

const POST_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Being written', tone: 'wait' },
  pending_approval: { label: 'Waiting for owner’s OK', tone: 'wait' },
  approved: { label: 'Approved', tone: 'good' },
  scheduled: { label: 'Scheduled', tone: 'good' },
  published: { label: 'Posted', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled by owner', tone: 'warn' },
};

type Tone = 'good' | 'warn' | 'bad' | 'wait';

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-sage/15 text-sage',
  warn: 'bg-brass/15 text-brass',
  bad: 'bg-clay-500/10 text-clay-600',
  wait: 'bg-ink/5 text-ink/60',
};

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

function timeAgo(d: string): string {
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  const days = Math.round(h / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export default function AdminPage() {
  const api = process.env.NEXT_PUBLIC_API_URL;
  const [token, setToken] = useState('');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (tok: string) => {
      setErr('');
      try {
        const res = await fetch(`${api}/admin/overview`, {
          headers: { 'x-admin-token': tok },
        });
        if (!res.ok) throw new Error(String(res.status));
        setData(await res.json());
        setRefreshedAt(new Date());
        sessionStorage.setItem('admin-token', tok);
      } catch {
        setErr('That token didn’t work — double-check and try again.');
      }
    },
    [api],
  );

  // Re-open without re-pasting for the life of this browser tab.
  useEffect(() => {
    const saved = sessionStorage.getItem('admin-token');
    if (saved) {
      setToken(saved);
      void load(saved);
    }
  }, [load]);

  if (!data) {
    return (
      <main className="mx-auto max-w-md px-6 py-24">
        <p className="eyebrow">✳ Operator only</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          Your business, at a glance
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Paste your admin token (it lives in Render, under Environment →
          ADMIN_TOKEN).
        </p>
        <form
          className="mt-6 flex gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void load(token);
          }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="admin token"
            className="flex-1 rounded-xl border border-ink/15 bg-white px-4 py-2.5 focus:border-clay-500 focus:outline-none"
          />
          <button type="submit" className="btn-primary !py-2.5">
            Open
          </button>
        </form>
        {err && <p className="mt-3 text-sm text-clay-700">{err}</p>}
      </main>
    );
  }

  const customers: any[] = data.customers ?? [];
  const leads: any[] = data.leads ?? [];
  const posts: any[] = data.recentPosts ?? [];
  const failed: any[] = data.failedPosts ?? [];

  const bizName = (customerId: string) =>
    customers.find((c) => c.id === customerId)?.businessName ??
    customers.find((c) => c.id === customerId)?.phone ??
    'a customer';

  const okLeads = leads.filter((l) => l.smsConsent);
  const noConsentLeads = leads.filter((l) => !l.smsConsent);
  const waitingDrafts = posts.filter((p) => p.status === 'pending_approval');
  const attention = failed.length + noConsentLeads.length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">✳ Operator view</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Your business, at a glance
          </h1>
        </div>
        <button
          onClick={() => void load(token)}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm text-ink/70 transition-colors hover:border-clay-500 hover:text-clay-600"
        >
          Refresh{refreshedAt ? ` · ${timeAgo(refreshedAt.toISOString())}` : ''}
        </button>
      </div>

      {/* The four numbers that matter */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          {
            n: data.counts.activeCustomers,
            label: 'paying customers',
          },
          {
            n: customers.filter((c) => c.status === 'onboarding').length,
            label: 'signing up now',
          },
          { n: okLeads.length, label: 'leads you can text' },
          { n: attention, label: 'things needing you', alert: attention > 0 },
        ].map((s) => (
          <div
            key={s.label}
            className={`rounded-2xl border bg-white px-5 py-4 shadow-soft ${
              s.alert ? 'border-clay-500/40' : 'border-ink/10'
            }`}
          >
            <span
              className={`block font-display text-3xl font-bold ${
                s.alert ? 'text-clay-600' : ''
              }`}
            >
              {String(s.n)}
            </span>
            <span className="text-[13px] text-ink/60">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Needs attention */}
      <section className="mt-10">
        <h2 className="mb-3 font-display text-xl font-medium">
          Needs your attention
        </h2>
        {attention === 0 ? (
          <p className="rounded-2xl border border-ink/10 bg-white px-5 py-4 text-sm text-ink/50 shadow-soft">
            Nothing — all quiet. ✳
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {failed.map((p) => (
              <li
                key={p.id}
                className="rounded-2xl border border-clay-500/30 bg-white px-5 py-4 text-sm shadow-soft"
              >
                <Chip tone="bad">Post failed</Chip>
                <span className="ml-2">
                  A post for <strong>{bizName(p.customerId)}</strong> didn’t go
                  out{p.failureReason ? ` — ${p.failureReason}` : ''}. (
                  {timeAgo(p.updatedAt)})
                </span>
              </li>
            ))}
            {noConsentLeads.map((l) => (
              <li
                key={l.phone}
                className="rounded-2xl border border-brass/40 bg-white px-5 py-4 text-sm shadow-soft"
              >
                <Chip tone="warn">Needs permission</Chip>
                <span className="ml-2">
                  Lead <strong>{l.phone}</strong> signed up before the consent
                  checkbox existed — get a written yes before any marketing
                  text.
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Customers */}
      <section className="mt-10">
        <h2 className="mb-3 font-display text-xl font-medium">
          Customers ({customers.length})
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {customers.map((c) => {
            const st = CUSTOMER_STATUS[c.status] ?? {
              label: c.status,
              tone: 'wait' as Tone,
            };
            return (
              <li
                key={c.id}
                className="rounded-2xl border border-ink/10 bg-white px-5 py-4 shadow-soft"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-lg font-semibold">
                    {c.businessName ?? c.phone}
                  </span>
                  <Chip tone={st.tone}>{st.label}</Chip>
                </div>
                <p className="mt-1 text-[13px] text-ink/60">
                  {c.businessName ? `${c.phone} · ` : ''}
                  {PLAN_PRICE[c.plan] ?? c.plan}
                  {c.business ? ` · ${c.business}` : ''}
                </p>
                <p className="mt-2 text-[13px] text-ink/70">
                  {c.onboarded
                    ? TRUST[c.trust] ?? c.trust
                    : 'Still answering the welcome questions'}
                  {c.strategy ? ' · custom strategy ✓' : ''}
                  {c.referralCode ? ` · referral code ${c.referralCode}` : ''}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Leads */}
      <section className="mt-10">
        <h2 className="mb-3 font-display text-xl font-medium">
          Leads ({leads.length})
        </h2>
        {leads.length === 0 ? (
          <p className="rounded-2xl border border-ink/10 bg-white px-5 py-4 text-sm text-ink/50 shadow-soft">
            No one has left their number yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {leads.map((l) => (
              <li
                key={l.phone}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-ink/10 bg-white px-5 py-3.5 text-sm shadow-soft"
              >
                <span>
                  <strong>{l.phone}</strong>
                  {l.email ? ` · ${l.email}` : ''}
                  <span className="text-ink/50">
                    {' '}
                    · from {l.source} · {timeAgo(l.createdAt)}
                  </span>
                </span>
                {l.smsConsent ? (
                  <Chip tone="good">OK to text ✓</Chip>
                ) : (
                  <Chip tone="warn">Needs permission first</Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent posts */}
      <section className="mt-10">
        <h2 className="mb-3 font-display text-xl font-medium">
          Recent posts
          {waitingDrafts.length > 0
            ? ` — ${waitingDrafts.length} waiting on owners`
            : ''}
        </h2>
        <ul className="flex flex-col gap-2">
          {posts.slice(0, 12).map((p) => {
            const st = POST_STATUS[p.status] ?? {
              label: p.status,
              tone: 'wait' as Tone,
            };
            return (
              <li
                key={p.id}
                className="rounded-2xl border border-ink/10 bg-white px-5 py-3.5 text-sm shadow-soft"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={st.tone}>{st.label}</Chip>
                  <span className="font-medium">{bizName(p.customerId)}</span>
                  <span className="text-ink/50">
                    · {p.platform} · {timeAgo(p.createdAt)}
                  </span>
                </div>
                {p.caption && (
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-ink/60">
                    “{p.caption}”
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
