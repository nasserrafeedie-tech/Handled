import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Header,
  Post as HttpPost,
  Query,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { TaskBus } from '../tasks/task-bus.service';
import { BusinessMetricsService } from './business-metrics.service';
import { PostForMeService } from '../operator/publishing/post-for-me.service';
import { normalizePhone } from '../common/phone';
import { tierHasCarousel } from '../operator/graphics/carousel-content';
import { ADMIN_PAGE_HTML } from './admin-page';

const PublishNowBody = z.object({ postId: z.string().uuid() });

/**
 * Setting a customer up by hand.
 *
 * planTier is otherwise written in exactly one place — the Stripe webhook. That
 * is right for self-serve, and wrong for the first customers, who get signed up
 * in person and may never touch Stripe. Without this they sit on the "starter"
 * default forever and every paid feature stays silently off: no carousels, no
 * generated images, no reels, no video uploads. Nothing errors. The feature we
 * sell hardest simply never appears, and there is nothing in the logs to chase.
 */
const UpsertCustomerBody = z.object({
  phone: z.string().min(7),
  businessName: z.string().min(1).optional(),
  // Matches billing's PlanId. 'premium' appears in the carousel gate but was
  // never a sellable plan, so it is deliberately not offered here.
  planTier: z.enum(['starter', 'growth', 'pro']).optional(),
  timezone: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  // Consent to generated photography. Off by default (the owner's decision); set
  // here to turn a customer's carousel covers into generated hero images.
  aiImagesOptIn: z.boolean().optional(),
  // How much runs without the owner: approve_all (every post confirmed),
  // auto_low_risk (low-risk auto, high-risk confirmed), full_auto (low-risk auto
  // including generated imagery; high-risk still always confirmed by the gate).
  trustLevel: z.enum(['approve_all', 'auto_low_risk', 'full_auto']).optional(),
});

/**
 * Update a customer's config by id — the escape hatch /admin/customer can't be,
 * because it keys on phone and validates it. A dogfood/test customer with a
 * placeholder phone (the Handled account is +15550000001, which normalizePhone
 * rightly rejects) can't be reached by phone at all, so autopilot settings would
 * be unreachable without direct DB access. Addresses by id, sets only what's
 * given.
 */
const CustomerConfigBody = z.object({
  customerId: z.string().uuid(),
  trustLevel: z.enum(['approve_all', 'auto_low_risk', 'full_auto']).optional(),
  aiImagesOptIn: z.boolean().optional(),
  planTier: z.enum(['starter', 'growth', 'pro']).optional(),
  timezone: z.string().min(1).optional(),
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
});

const MakeCarouselBody = z.object({
  customerId: z.string().uuid(),
  caption: z.string().min(10),
  platform: z.enum(['instagram', 'facebook', 'tiktok', 'threads']).default('instagram'),
  archetype: z
    .enum(['educational_tip', 'product_spotlight', 'promo', 'testimonial', 'seasonal'])
    .default('educational_tip'),
});

/**
 * Recording an approval the owner gave somewhere other than SMS.
 *
 * Approval normally arrives as a text reply, and until toll-free verification
 * clears we cannot send or receive those — so the first hand-run customers will
 * approve out loud, over iMessage, or standing in their shop. That approval is
 * real and we should be able to act on it.
 *
 * `approvedBy` is required, and free text on purpose: it has to be possible to
 * read later and know a human said yes and who heard it. An approval nobody can
 * trace is indistinguishable from us posting to a stranger's Instagram on our
 * own authority, which is the one thing this product must never do.
 */
const ApproveBody = z.object({
  postId: z.string().uuid(),
  approvedBy: z.string().min(3),
});

const RelayedBody = z.object({ messageIds: z.array(z.string().uuid()).min(1) });

/**
 * Says out loud what the tier does and does not include, at the moment it is
 * set. The gates are silent by design at runtime — a Starter customer is not
 * told what they are missing — so the one place it must be loud is here, where
 * a wrong tier is still cheap to fix.
 */
function tierNote(planTier: string): string {
  return tierHasCarousel(planTier)
    ? `${planTier}: carousels, generated images and reels are ON.`
    : `${planTier}: captions and the owner's own photos only — NO carousels, ` +
      'no generated images, no reels. Set planTier to growth or pro if this ' +
      'customer is paying for those.';
}

/**
 * Operator's eyes — NOT a customer dashboard (§2: customers never get one).
 * One JSON endpoint behind ADMIN_TOKEN so Nasser can see leads, customers,
 * and failures without querying Postgres by hand. Fails closed: no token
 * configured → the route effectively doesn't exist.
 */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: TaskBus,
    private readonly metrics: BusinessMetricsService,
    private readonly pfm: PostForMeService,
  ) {}

  /**
   * The operator's page. Served WITHOUT a token on purpose: this is an empty
   * shell containing no business data, so the URL is safe to bookmark. It asks
   * for the token in the browser and sends it as a header on every fetch — the
   * same gate every endpoint below already enforces.
   */
  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  page(): string {
    return ADMIN_PAGE_HTML;
  }

  /**
   * Create or update a customer by hand — the founder-run signup path.
   *
   * Keyed on phone, because that is the only identifier the product has: the
   * owner texts us, and we match on the number. Normalized to E.164 first, so a
   * customer set up here as "(424) 409-8341" is the same record Twilio finds
   * when they text in. Skipping that would create a second, empty customer and
   * start them over from question one.
   */
  @HttpPost('customer')
  async upsertCustomer(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const parsed = UpsertCustomerBody.safeParse(body);
    if (!parsed.success) {
      return { error: 'bad_request', detail: parsed.error.issues };
    }
    const { phone: rawPhone, ...fields } = parsed.data;

    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return {
        error: 'bad_phone',
        detail:
          `"${rawPhone}" is not a phone number we can text. Use E.164 ` +
          '(+14244098341) or a 10-digit US number.',
      };
    }

    const existing = await this.prisma.customer.findUnique({ where: { phone } });
    const customer = await this.prisma.customer.upsert({
      where: { phone },
      // A hand-made customer needs the same children the SMS path creates,
      // or onboarding has nowhere to write and dies on the first reply.
      create: {
        phone,
        ...fields,
        conversation: { create: {} },
        brandProfile: { create: {} },
      },
      update: fields,
    });

    return {
      created: !existing,
      customer: {
        id: customer.id,
        phone: customer.phone,
        businessName: customer.businessName,
        planTier: customer.planTier,
        status: customer.status,
      },
      // Same source every other connect link uses, so this one cannot drift to
      // a different host than the one the concierge texts them.
      connectLink: `${process.env.PUBLIC_SITE_URL ?? 'https://texthandled.com'}/connect?c=${customer.id}`,
      note: tierNote(customer.planTier),
    };
  }

  /**
   * Build a carousel on demand for one customer — an operator trigger for a test
   * post, or a one-off. Creates a post from the caption, marks it moderation-
   * passed and approved, then runs GENERATE_CAROUSEL. If the customer has AI
   * images on, the cover gets a generated hero (which forces the post back to
   * awaiting_owner — approve it before publishing). Returns the post id to
   * publish with /admin/publish-now.
   */
  @HttpPost('customer-config')
  async customerConfig(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const parsed = CustomerConfigBody.safeParse(body);
    if (!parsed.success) {
      return { error: 'bad_request', detail: parsed.error.issues };
    }
    const { customerId, ...fields } = parsed.data;
    if (Object.keys(fields).length === 0) {
      return { error: 'bad_request', detail: 'nothing to set' };
    }

    const customer = await this.prisma.customer.update({
      where: { id: customerId },
      data: fields,
      select: {
        id: true,
        businessName: true,
        trustLevel: true,
        aiImagesOptIn: true,
        planTier: true,
        status: true,
      },
    });
    return { updated: true, customer };
  }

  @HttpPost('make-carousel')
  async makeCarousel(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const parsed = MakeCarouselBody.safeParse(body);
    if (!parsed.success) {
      return { error: 'bad_request', detail: parsed.error.issues };
    }
    const { customerId, caption, platform, archetype } = parsed.data;

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { planTier: true },
    });
    if (!customer) throw new NotFoundException(`no customer ${customerId}`);
    if (!tierHasCarousel(customer.planTier)) {
      return { error: 'tier', detail: `planTier ${customer.planTier} has no carousels — set growth or pro` };
    }

    const post = await this.prisma.post.create({
      data: {
        customerId,
        archetype,
        platform,
        caption,
        // Operator-created and trusted: cleared to publish once the slides land.
        // If a generated hero is added, GENERATE_CAROUSEL flips this back to
        // awaiting_owner, so an AI-image carousel still gets a human yes.
        status: 'approved',
        approvalState: 'approved',
        moderationState: 'passed',
      },
    });

    const result = await this.bus.emit({
      task_id: randomUUID(),
      customer_id: customerId,
      type: 'GENERATE_CAROUSEL',
      payload: { post_id: post.id },
      requires_approval: false,
      created_by: 'concierge',
      created_at: new Date().toISOString(),
    } as never);

    const refreshed = await this.prisma.post.findUnique({
      where: { id: post.id },
      select: { mediaRefs: true, aiGeneratedMedia: true, approvalState: true },
    });
    return {
      postId: post.id,
      slides: refreshed?.mediaRefs.length ?? 0,
      aiHero: refreshed?.aiGeneratedMedia ?? false,
      approvalState: refreshed?.approvalState,
      generation: result.summary_for_owner,
      next:
        refreshed?.approvalState === 'awaiting_owner'
          ? `Review it, then POST /admin/approve then /admin/publish-now for ${post.id}.`
          : `POST /admin/publish-now with {"postId":"${post.id}"} to send it.`,
    };
  }

  /**
   * Record an owner's approval that came in off-channel, so a post can go out
   * while SMS is unavailable. Deliberately does NOT publish — it only opens the
   * gate. Publishing stays a separate, explicit act.
   */
  @HttpPost('approve')
  async approve(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const parsed = ApproveBody.safeParse(body);
    if (!parsed.success) {
      return {
        error: 'bad_request',
        detail:
          'postId and approvedBy are both required. Say who approved it and ' +
          'how — "Dr. Rafeedie, by text 22 Jul" — not just "me".',
      };
    }
    const { postId, approvedBy } = parsed.data;

    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException(`no post ${postId}`);
    if (post.approvalState === 'approved') {
      return { changed: false, reason: 'already approved' };
    }
    // Approve ONLY a post that is actually waiting for the owner. Without this,
    // a mistyped id pointing at a post the owner already REJECTED would flip it
    // back to approved — and publish-now would then send content the owner
    // explicitly killed. The one thing the product must never do. A post that
    // is not awaiting the owner is not ours to approve on their behalf.
    if (post.approvalState !== 'awaiting_owner') {
      return {
        changed: false,
        reason: `post is ${post.approvalState}, not awaiting the owner — refusing to approve`,
      };
    }

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        approvalState: 'approved',
        // Written onto the post itself rather than a log line, so the trail
        // travels with the post and survives log rotation.
        approvalNote: approvedBy,
      },
    });

    return {
      changed: true,
      postId,
      approvedBy,
      next: `POST /admin/publish-now with {"postId":"${postId}"} to send it.`,
    };
  }

  /**
   * Texts Handled has written but nobody has carried to the customer yet.
   *
   * Replying to an inbound message is the easy half — the simulator hands those
   * straight back. The hard half is everything Handled says on its own clock:
   * the Monday approval texts, the nudge when a photo never arrives, the recap
   * before billing. Those are composed by the scheduler with no request to
   * return them to, so without an outbox they are written, stored, and never
   * seen by anyone — the customer simply never hears about the week's posts.
   */
  @Get('outbox')
  async outbox(
    @Headers('x-admin-token') token: string | undefined,
    @Query('customer') customerId: string | undefined,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    // Only hand-relay while there is no wire. The moment SMS_MANUAL_RELAY is
    // unset (Twilio verified), every message is actually delivered by Twilio,
    // yet `relayedAt` stays null on all of them — so without this guard the
    // outbox would list already-sent texts and the operator would re-send them
    // by hand, doubling every message. When the wire is live, there is nothing
    // to relay.
    if (process.env.SMS_MANUAL_RELAY !== '1') {
      return {
        pending: 0,
        messages: [],
        note: 'Manual relay is off — texts are delivered automatically over SMS. Nothing to hand-carry.',
      };
    }

    const pending = await this.prisma.message.findMany({
      where: {
        direction: 'outbound',
        relayedAt: null,
        ...(customerId
          ? { conversation: { customerId } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: {
        conversation: {
          select: { customer: { select: { id: true, businessName: true, phone: true } } },
        },
      },
    });

    return {
      pending: pending.length,
      messages: pending.map((m) => ({
        id: m.id,
        to: m.conversation.customer.phone,
        business: m.conversation.customer.businessName,
        written: m.createdAt,
        body: m.body,
      })),
      note:
        pending.length === 0
          ? 'Nothing waiting.'
          : 'Send these to the customer yourself, then POST /admin/outbox/relayed with their ids.',
    };
  }

  /**
   * Mark texts as delivered by hand. Separate from reading them on purpose: the
   * outbox is checked far more often than it is cleared, and a read that
   * silently emptied it would lose any message seen but not yet sent.
   */
  @HttpPost('outbox/relayed')
  async markRelayed(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const parsed = RelayedBody.safeParse(body);
    if (!parsed.success) {
      return { error: 'bad_request', detail: 'messageIds must be a non-empty array of uuids' };
    }

    const { count } = await this.prisma.message.updateMany({
      where: { id: { in: parsed.data.messageIds }, relayedAt: null },
      data: { relayedAt: new Date() },
    });
    return { marked: count };
  }

  /** Read a post's real state straight from Post for Me (debug/verify). */
  @Get('post-status')
  async postStatus(
    @Headers('x-admin-token') token: string | undefined,
    @Headers('x-external-id') externalId: string | undefined,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();
    if (!externalId) return { error: 'pass the external id in the x-external-id header' };
    try {
      return await this.pfm.getPost(externalId);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * Publish one approved post immediately.
   *
   * Posts normally fire from their own queued job at the scheduled minute, with
   * the hourly sweep as a backstop. Neither helps when a post is stuck and
   * somebody needs it out NOW — until this, the only recovery was to wait up to
   * an hour for the sweep and hope. Same PUBLISH_DUE path as everything else, so
   * the approval gate, platform limits and AI disclosure all still apply; the
   * only thing being overridden is the clock.
   */
  @HttpPost('publish-now')
  async publishNow(
    @Headers('x-admin-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();
    const { postId } = PublishNowBody.parse(body);

    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException(`no post ${postId}`);
    // Never a way to skip the owner's approval — that gate is the product.
    if (post.approvalState !== 'approved') {
      return { published: false, reason: `post is ${post.approvalState}, not approved` };
    }

    // Name the post explicitly. PUBLISH_DUE's sweep only looks at posts in
    // 'scheduled' status whose time has passed, so an approved post that never
    // got queued is invisible to it — which is exactly the post someone needs
    // this endpoint for. Passing post_id skips the due-time query entirely; the
    // §8 publish gate inside the handler still runs on it.
    const result = await this.bus.emit({
      task_id: randomUUID(),
      customer_id: post.customerId,
      type: 'PUBLISH_DUE',
      payload: { post_id: postId },
      requires_approval: false,
      created_by: 'cron',
      created_at: new Date().toISOString(),
    } as never);
    return { published: true, result };
  }

  @Get('overview')
  async overview(@Headers('x-admin-token') token: string | undefined) {
    const expected = process.env.ADMIN_TOKEN;
    if (!expected || token !== expected) throw new NotFoundException();

    const [leads, customers, recentPosts, failedPosts, archetypes] = await Promise.all([
      this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.customer.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { brandProfile: { select: { businessType: true, onboardingComplete: true, contentStrategy: true } } },
      }),
      this.prisma.post.findMany({
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, customerId: true, platform: true, status: true, approvalState: true, caption: true, scheduledTime: true, createdAt: true },
      }),
      this.prisma.post.findMany({
        where: { status: 'failed' },
        orderBy: { updatedAt: 'desc' },
        take: 25,
        select: { id: true, customerId: true, failureReason: true, updatedAt: true },
      }),
      // The playbook, so new archetypes the engine researched are reviewable
      // (engine Flow 2 step 6) and stale ones are visible.
      this.prisma.playbookArchetype.findMany({
        orderBy: [{ usageCount: 'desc' }, { slug: 'asc' }],
        select: {
          slug: true,
          title: true,
          status: true,
          confidence: true,
          usageCount: true,
          researchedAt: true,
        },
      }),
    ]);

    return {
      business: await this.metrics.build(),
      mediaMix: await this.metrics.mediaMix(),
      counts: {
        leads: await this.prisma.lead.count(),
        customers: await this.prisma.customer.count(),
        activeCustomers: await this.prisma.customer.count({ where: { status: 'active' } }),
        failedPosts: failedPosts.length,
      },
      leads,
      customers: customers.map((c) => ({
        id: c.id, phone: c.phone, businessName: c.businessName,
        plan: c.planTier, status: c.status, trust: c.trustLevel,
        business: c.brandProfile?.businessType ?? null,
        onboarded: c.brandProfile?.onboardingComplete ?? false,
        referralCode: c.referralCode, referredBy: c.referredByCode,
        strategy: c.brandProfile?.contentStrategy ?? null,
        archetype: c.archetypeSlug,
        created: c.createdAt,
      })),
      recentPosts, failedPosts, archetypes,
    };
  }
}
