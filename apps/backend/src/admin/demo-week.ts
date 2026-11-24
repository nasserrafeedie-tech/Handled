import { randomUUID } from 'node:crypto';
import type { CalendarSlot, DraftPostResult, Result, Task } from '@smm/contracts';
import type { PrismaService } from '../prisma/prisma.service';
import { zonedToUtc } from '../common/time';
import { ownerRequestNote } from '../operator/handlers/plan-week.handler';
import { ensureVisual } from '../operator/graphics/visual-safety-net';
import { costOf } from '../operator/llm/pricing';
import { modelFor } from '../operator/llm/llm.service';
import { imageModelName } from '../operator/graphics/image-gen.service';
import { DEMO_STRIPE_PREFIX } from './internal-accounts';

/**
 * A demo week: one real business run through the real pipeline, end to end,
 * so the founder can see exactly what a Pro customer gets. The same planner,
 * writer, scroll test, carousel builder, designer and image generator a paying
 * customer's week goes through — only the concierge is left out, because the
 * concierge is the part that texts people.
 *
 * Four things keep a demo from ever reaching anyone:
 * - the account has no phone and no email, so there is nowhere to text;
 * - it is paused, and every sweep that texts or publishes skips a paused
 *   account (the stranded-draft texter, the weekly crons, PUBLISH_DUE);
 * - it has no linked social accounts, so there is nothing to publish to;
 * - every draft lands as pending_approval (approve_all), and nothing here
 *   approves it.
 *
 * It is also left out of customer counts and MRR, like the house account.
 */

export interface DemoBusiness {
  slug: string;
  businessName: string;
  /** Where the facts came from, shown on the results page. */
  source: string;
  profile: Record<string, unknown>;
}

/**
 * South Bay Dental Smiles, Torrance. Every fact below is from the practice's
 * own public pages (its site, its Google listing and Zocdoc), read on 17 Nov
 * 2026. Nothing is invented: the writer is told not to make up a number, a
 * patient or a result, and the profile gives it real ones to use instead.
 */
const SOUTH_BAY_DENTAL: DemoBusiness = {
  slug: 'south-bay-dental-smiles',
  businessName: 'South Bay Dental Smiles',
  source: "the practice's own site, Google listing and Zocdoc page, read 17 Nov 2026",
  profile: {
    businessType: 'family and cosmetic dental practice in Torrance, California',
    voiceTone:
      'warm, calm and reassuring; plain words a parent would use, never clinical and never salesy; patient with nervous adults and kids',
    targetCustomer:
      'families and adults in Torrance, Redondo Beach, Lomita, Rancho Palos Verdes and Rolling Hills, including people who are nervous about the dentist or have no dental insurance',
    offers: [
      'In-house membership plan for people without insurance: adults (14+) $33 a month or $396 a year, kids 13 and under $29 a month, gum-care plan $51 a month. No deductibles, no yearly maximums, no pre-approval, starts right away',
      'In-office teeth whitening, $450',
      'Invisalign clear aligners, from $3,500',
      'General, family and cosmetic dentistry under one roof',
      'Online booking on the practice website',
    ],
    dosAndDonts: [
      'Do give practical, correct dental care tips a family can use at home',
      'Do speak to nervous patients and parents of young kids',
      'Do not invent patient stories, reviews, names, before-and-after results or numbers',
      'Do not promise outcomes, pain-free treatment or guaranteed results',
      'Do not give a diagnosis; tell people to come in when something needs a dentist',
    ],
    blackoutTopics: ['politics', 'religion'],
    postingFrequency: 7,
    brandColors: ['#0F7C80', '#F2A541', '#F6F1E7'],
    visualStyle: 'clean, bright and friendly; calm teal with a warm accent',
    businessResearch:
      'From the practice’s own pages (read 17 Nov 2026): family, general and cosmetic dentistry in Torrance, serving Torrance, Redondo Beach, Lomita, Rancho Palos Verdes and Rolling Hills. ' +
      'Open Monday to Thursday, 8 am to 5 pm; closed Friday to Sunday. Online booking on the website. ' +
      'Google rating 4.9 from 278 reviews. Patients often mention that the team is gentle, takes time to answer questions, is good with kids and anxious patients, and keeps a clean office. ' +
      'Membership plan for patients without insurance: adults 14+ $33/month or $396/year, children 13 and under $29/month, periodontal plan $51/month; no deductibles, no maximums, no pre-approval, coverage starts right away, 12-month term. ' +
      'Whitening $450. Invisalign from $3,500. ' +
      'Their recent Google posts were general health tips; there were no posts about the team or the office.',
    postRequests: [
      'what the in-house membership plan covers for a family without dental insurance',
      'what a first visit is like if you are nervous about the dentist',
    ],
    onboardingComplete: true,
  },
};

export const DEMO_BUSINESSES: Record<string, DemoBusiness> = {
  [SOUTH_BAY_DENTAL.slug]: SOUTH_BAY_DENTAL,
};

type DemoPrisma = Pick<PrismaService, 'customer' | 'brandProfile' | 'conversation'>;

/** Create or refresh the demo account for a business. Never textable, never live. */
export async function setUpDemoAccount(prisma: DemoPrisma, biz: DemoBusiness): Promise<string> {
  const stripeCustomerId = `${DEMO_STRIPE_PREFIX}${biz.slug}`;
  const fields = {
    businessName: biz.businessName,
    phone: null,
    email: null,
    planTier: 'pro',
    status: 'paused' as const,
    pausedReason: 'demo account: shows a full week, never texts or posts',
    aiImagesOptIn: true,
    aiImagesOptInAt: new Date(),
    trustLevel: 'approve_all' as const,
    timezone: 'America/Los_Angeles',
    freeDraftUsedAt: new Date(),
  };
  const existing = await prisma.customer.findUnique({ where: { stripeCustomerId } });
  const customer = existing
    ? await prisma.customer.update({ where: { id: existing.id }, data: fields })
    : await prisma.customer.create({ data: { ...fields, stripeCustomerId } });
  await prisma.brandProfile.upsert({
    where: { customerId: customer.id },
    create: { customerId: customer.id, ...biz.profile },
    update: biz.profile,
  });
  await prisma.conversation.upsert({ where: { customerId: customer.id }, create: { customerId: customer.id }, update: {} });
  return customer.id;
}

export interface DemoPostNote {
  postId: string;
  /** What the real product would have asked the owner to photograph. */
  photoAsk?: string;
}

export interface DemoRun {
  customerId: string;
  slug: string;
  startedAt: string;
  finishedAt?: string;
  step: string;
  planned: number;
  drafted: number;
  notes: DemoPostNote[];
  problems: string[];
}

/** One run at a time per process; the results page reads it while it runs. */
const runs = new Map<string, DemoRun>();
export const demoRun = (customerId: string): DemoRun | undefined => runs.get(customerId);
export const demoRunning = (customerId: string): boolean => {
  const r = runs.get(customerId);
  return Boolean(r && !r.finishedAt);
};

export interface DemoDeps {
  prisma: Pick<PrismaService, 'customer' | 'post'>;
  emit: (task: Task) => Promise<Result>;
  log?: (msg: string) => void;
}

function task(customerId: string, type: Task['type'], payload: unknown): Task {
  return {
    task_id: randomUUID(),
    customer_id: customerId,
    type,
    payload,
    requires_approval: false,
    created_by: 'concierge',
    created_at: new Date().toISOString(),
  } as Task;
}

export function nextMonday(now = new Date()): string {
  const d = new Date(now);
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Plan a full week and make every post, with its visuals, the way the Monday
 * plan does. Two differences, both so the demo shows everything: every slot
 * gets a generated visual (a real owner would be asked for a photo on some,
 * and the page says which), and posts are made three at a time.
 */
export async function runDemoWeek(deps: DemoDeps, customerId: string, slug: string): Promise<DemoRun> {
  const run: DemoRun = {
    customerId, slug, startedAt: new Date().toISOString(), step: 'planning the week', planned: 0, drafted: 0, notes: [], problems: [],
  };
  runs.set(customerId, run);
  const log = deps.log ?? (() => undefined);
  try {
    const customer = await deps.prisma.customer.findUnique({
      where: { id: customerId },
      select: { timezone: true, planTier: true, status: true, phone: true, email: true },
    });
    // The one check that matters most: a demo must be unreachable. Refuse
    // anything that could text or post, however it got here.
    if (!customer || customer.status !== 'paused' || customer.phone || customer.email) {
      throw new Error('not a demo account (it must be paused, with no phone or email)');
    }
    const tz = customer.timezone;

    let slots: CalendarSlot[] = [];
    for (let i = 0; i < 2 && !slots.length; i++) {
      const planned = await deps.emit(task(customerId, 'PLAN_WEEK', { week_start: nextMonday(), posting_frequency: 7 }));
      slots = (planned.data as { slots?: CalendarSlot[] } | null | undefined)?.slots ?? [];
    }
    run.planned = slots.length;
    if (!slots.length) throw new Error('the planner came back with no posts');

    const queue = [...slots];
    const worker = async () => {
      for (let slot = queue.shift(); slot; slot = queue.shift()) {
        await makePost(deps, run, customerId, tz, customer.planTier, slot).catch((e) => {
          run.problems.push(`${slot!.date} ${slot!.archetype}: ${String(e).slice(0, 200)}`);
          log(`demo post failed for ${customerId}: ${String(e)}`);
        });
        run.step = `made ${run.drafted} of ${run.planned} posts`;
      }
    };
    run.step = `made 0 of ${run.planned} posts`;
    await Promise.all([worker(), worker(), worker()]);
    run.step = 'done';
  } catch (e) {
    run.problems.push(String(e).slice(0, 300));
    run.step = 'stopped';
    log(`demo week stopped for ${customerId}: ${String(e)}`);
  } finally {
    run.finishedAt = new Date().toISOString();
  }
  return run;
}

async function makePost(
  deps: DemoDeps,
  run: DemoRun,
  customerId: string,
  tz: string,
  planTier: string,
  slot: CalendarSlot,
): Promise<void> {
  const result = await deps.emit(
    task(customerId, 'DRAFT_POST', {
      platform: slot.platform,
      archetype: slot.archetype,
      scheduled_time: zonedToUtc(slot.date, slot.best_time, tz).toISOString(),
      needs_asset: false,
      shot_list_hint: slot.shot_list,
      prompt_notes: ownerRequestNote(slot.owner_request),
    }),
  );
  const d = result.data as DraftPostResult | null | undefined;
  if (!d?.post_id) throw new Error(result.error?.message ?? result.summary_for_owner ?? 'no draft');
  run.drafted++;
  run.notes.push({ postId: d.post_id, photoAsk: slot.needs_asset ? slot.shot_list || 'a photo from the office' : undefined });

  if (d.needs_carousel) {
    await deps.emit(task(customerId, 'GENERATE_CAROUSEL', { post_id: d.post_id }));
  } else if (d.needs_image) {
    await deps.emit(task(customerId, 'GENERATE_IMAGE', { post_id: d.post_id, aspect: '1:1' }));
  }
  await ensureVisual(
    {
      findMedia: (id) => deps.prisma.post.findUnique({ where: { id }, select: { mediaRefs: true } }),
      makeCarousel: (id) => deps.emit(task(customerId, 'GENERATE_CAROUSEL', { post_id: id })),
    },
    { id: d.post_id, needsAsset: false, planTier },
  );
}

export interface DemoView {
  business: string;
  source: string;
  run: Omit<DemoRun, 'notes'> | null;
  running: boolean;
  models: { captions: string; judge: string; designs: string; photos: string | null };
  posts: Array<{
    id: string;
    when: string | null;
    platform: string;
    archetype: string;
    caption: string | null;
    hashtags: string[];
    altText: string | null;
    media: string[];
    aiImage: boolean;
    status: string;
    photoAsk?: string;
  }>;
  spend: { byModel: Array<{ model: string; calls: number; usd: number }>; usd: number; note: string };
}

/** Everything the results page shows, for the latest demo run. */
export async function demoView(
  prisma: Pick<PrismaService, 'post' | 'llmUsage'>,
  publicUrl: (key: string) => string,
  customerId: string,
  biz: DemoBusiness,
): Promise<DemoView> {
  const run = runs.get(customerId) ?? null;
  // Without a run in memory (the service restarted), show the latest batch:
  // everything made within three hours of the newest post.
  const newest = await prisma.post.findFirst({ where: { customerId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  const since = run ? new Date(run.startedAt) : newest ? new Date(newest.createdAt.getTime() - 3 * 3600_000) : new Date();
  const [posts, usage] = await Promise.all([
    prisma.post.findMany({
      where: { customerId, createdAt: { gte: since } },
      orderBy: [{ scheduledTime: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.llmUsage.findMany({
      where: { customerId, createdAt: { gte: since } },
      select: { model: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true },
    }),
  ]);
  const byModel = new Map<string, { calls: number; usd: number }>();
  for (const u of usage) {
    const m = byModel.get(u.model) ?? { calls: 0, usd: 0 };
    m.calls++;
    m.usd += costOf(u);
    byModel.set(u.model, m);
  }
  const rows = [...byModel].map(([model, v]) => ({ model, calls: v.calls, usd: Math.round(v.usd * 100) / 100 }));
  const notes = new Map((run?.notes ?? []).map((n) => [n.postId, n]));
  return {
    business: biz.businessName,
    source: biz.source,
    run: run
      ? { customerId: run.customerId, slug: run.slug, startedAt: run.startedAt, finishedAt: run.finishedAt, step: run.step, planned: run.planned, drafted: run.drafted, problems: run.problems }
      : null,
    running: demoRunning(customerId),
    models: {
      captions: modelFor('voice'),
      judge: modelFor('bulk'),
      designs: modelFor('design'),
      photos: imageModelName(),
    },
    posts: posts.map((p) => ({
      id: p.id,
      when: p.scheduledTime ? p.scheduledTime.toISOString() : null,
      platform: p.platform,
      archetype: p.archetype,
      caption: p.caption,
      hashtags: p.hashtags,
      altText: p.altText,
      media: p.mediaRefs.map((k) => (/^https?:\/\//.test(k) ? k : publicUrl(k))),
      aiImage: p.aiGeneratedMedia,
      status: p.status,
      photoAsk: notes.get(p.id)?.photoAsk,
    })),
    spend: {
      byModel: rows,
      usd: Math.round(rows.reduce((s, r) => s + r.usd, 0) * 100) / 100,
      note: 'Claude writing, judging and design calls. Not counted here: the web research on tip posts (about 10 to 20 cents each) and the generated photos (a few cents each).',
    },
  };
}
