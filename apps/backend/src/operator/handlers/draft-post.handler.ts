import { Injectable, Logger } from '@nestjs/common';
import {
  type Task,
  type Result,
  CaptionLlmOutput,
  type DraftPostResult,
} from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { buildBrandContext } from '../llm/brand-context';
import { CustomerContextService } from '../llm/customer-context.service';
import { playbookFor, ALT_TEXT_RULE } from '../llm/playbook';
import { polishCaption } from '../llm/caption-polish';
import { detectSlop, shouldRegenerate, slopFeedback } from '../llm/slop';
import { detectFabrication, fabricationFeedback } from '../guardrails/fabrication';
import { resolveStrategy } from '../llm/vertical-playbook';
import { isCarouselArchetype, tierHasCarousel } from '../graphics/carousel-content';
import { subjectPreferences } from '../../concierge/photo-walk';
import { TopicResearchService } from '../llm/topic-research.service';
import { ModerationService } from '../guardrails/moderation.service';
import { PublishGateService } from '../guardrails/publish-gate.service';
import {
  PLATFORM_LIMITS,
  truncateCaption,
  validateForPlatform,
} from '../guardrails/platform-limits';
import { TaskHandler, ok, fail } from './handler.interface';

/**
 * DRAFT_POST (§7). Generate a platform-specific caption + hashtags (bulk tier =
 * Haiku), classify risk, run moderation (§8), then route to the approval state
 * the trust ramp dictates. Media attach/generation is a seam (owner photo > AI).
 */
@Injectable()
export class DraftPostHandler implements TaskHandler<'DRAFT_POST'> {
  readonly type = 'DRAFT_POST' as const;
  private readonly log = new Logger(DraftPostHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly moderation: ModerationService,
    private readonly gate: PublishGateService,
    private readonly customerContext: CustomerContextService,
    private readonly topicResearch: TopicResearchService,
  ) {}

  async handle(task: Extract<Task, { type: 'DRAFT_POST' }>): Promise<Result> {
    const [customer, profile] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: task.customer_id } }),
      this.prisma.brandProfile.findUnique({ where: { customerId: task.customer_id } }),
    ]);
    if (!customer || !profile) {
      return fail(
        task.task_id,
        "I need your profile set up before I can write posts.",
        'no_brand_profile',
        `customer/profile missing for ${task.customer_id}`,
      );
    }

    const { platform, archetype } = task.payload;
    // Brand profile (what they told us at signup) + the per-customer context
    // engine (what we've learned since: their preferences and what their own
    // audience rewards). Both cached together, so repeat calls stay cheap.
    const context =
      buildBrandContext(profile) +
      (await this.customerContext.contextBlock(task.customer_id));

    // Anti-repetition memory. Without this the model re-derives the same
    // "safe" caption every week — same opening, same rhythm, same sign-off —
    // and the playbook's own rules make that worse by giving every post an
    // identical skeleton. Showing it what it already published is the cheapest
    // fix that actually works.
    const recent = await this.prisma.post.findMany({
      where: { customerId: task.customer_id, caption: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { caption: true, archetype: true },
    });
    // The blandness fix (owner's call: quality over cost): informational
    // posts get a real web-research pass first. The fact block becomes the
    // only sanctioned source of claims beyond the brand profile — concrete
    // specifics in, fabrication rules intact. Null on any failure, and the
    // draft proceeds profile-only exactly as before.
    const RESEARCHED = new Set(['educational_tip', 'seasonal', 'product_spotlight']);
    const factBlock = RESEARCHED.has(archetype)
      ? await this.topicResearch.factBlock(
          task.payload.prompt_notes ||
            `a ${archetype.replace(/_/g, ' ')} post for a ${profile.businessType ?? 'local business'}`,
          profile.businessType ?? 'local business',
        )
      : null;

    const prompt = [
      `Write one ${archetype} post for ${platform}.`,
      // Without this the model has no idea what day it is and writes whatever
      // season it feels like — a week planned in July opened with "November's
      // when local business owners have time to think about their feed", and an
      // earlier run offered winter advice in midsummer. Anything timely has to
      // be anchored to the day the post actually goes out.
      (() => {
        const when = task.payload.scheduled_time
          ? new Date(task.payload.scheduled_time)
          : new Date();
        const stamp = when.toLocaleDateString('en-US', {
          weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          timeZone: customer.timezone ?? 'America/Los_Angeles',
        });
        return `This post publishes on ${stamp}. Any reference to the date, the ` +
          `season, the weather or the time of year MUST match that day. Do not ` +
          `mention a different month or season.`;
      })(),
      task.payload.prompt_notes ? `Notes: ${task.payload.prompt_notes}.` : '',
      factBlock ? `\n${factBlock}\n` : '',
      '',
      // How this platform actually ranks content — see llm/playbook.ts.
      playbookFor(platform),
      '',
      (() => { const st = resolveStrategy(profile); return `STRATEGY FOR THIS BUSINESS: ${st.mix}\nIf the archetype fits, draw on: ${st.ideas.slice(0, 3).join(' · ')}`; })(),
      '',
      recent.length
        ? [
            '',
            'ALREADY POSTED for this business — do not repeat these. Vary the',
            'opening line, the sentence rhythm, and the closing call to action.',
            'Reuse of an opening or a sign-off from this list is a failure:',
            ...recent.map((r) => `- (${r.archetype}) ${flatten(r.caption ?? '')}`),
          ].join('\n')
        : '',
      '',
      'HARD RULES: Never invent a named customer, patient, or a specific',
      'story about one. For a testimonial archetype with no real quote in the',
      'notes, write general sentiment ("our regulars tell us…") or an',
      'invitation — a fabricated review is a firing offense.',
      // The invented-event failure: given only "banana bread" the drafter wrote
      // "we taste-tested 3 batches this afternoon". Charming, and a lie under
      // the owner\'s name.
      'Never state that a specific thing happened on a specific day, or give a',
      'specific number, event, or result you were not told — no "we tested 3',
      'batches this afternoon", no "we sold out by noon". Only use facts from',
      'the brand profile or the RESEARCHED MATERIAL block (when one appears',
      'above — those facts are web-verified and encouraged). Write offers as',
      'evergreen truth ("baked fresh daily") or an invitation ("come try it"),',
      'never as dated news you made up.',
      // Opus fills thin profiles with plausible fiction — a profile that says
      // "three tiers" got a caption describing what each tier includes, all
      // invented. The details gap is an invitation to ask, never to imagine.
      'Never describe what a product, service, plan, or tier INCLUDES beyond',
      'what the brand profile states. If the profile names a thing without',
      'details, the caption may name it and invite people to ask — it may not',
      'invent the details.',
      // Opus writes long by default; every draft is also delivered over SMS
      // for approval, where a 6-segment text gets carrier-filtered. One idea
      // per post, said tight, beats an essay — on every platform.
      'Keep the caption under 280 characters. One idea per post, said tight —',
      'a strong short caption beats a thorough long one every single time.',
      'Cut preamble and wind-down; start at the point.',
      // Feed truncation is a hard platform fact: ~125 chars show, the rest
      // hides behind "…more". The only RCT-grade evidence on hooks says
      // problem-framing beats positive framing; and Instagram's own stated
      // top signal for reaching strangers is the DM-send.
      'THE FIRST LINE IS THE POST: only ~125 characters show in the feed.',
      'Line 1 must be a standalone hook under 110 characters that creates',
      'tension — the problem, the mistake, the cost — not the cheerful tip.',
      '"Most gums bleed for a reason you can fix" beats "Healthy smile tips!".',
      'Never open with a greeting, the weather, an emoji, the business name,',
      'or a summary. If line 1 could sit on any business\'s post, rewrite it.',
      'Write as the OWNER speaking — I/we, a person typing to neighbors, not',
      'a brand making an announcement.',
      'End with exactly ONE ask and vary it post to post: a save ("save this',
      'for your next …"), a send ("send this to the friend who …"), or the',
      'business\'s real action ("text us", "book", "come in"). Never stack',
      'asks, and never beg for likes or follows.',
      // Every post naming the city + trade ("our Glendale coffee shop") reads
      // like SEO filler across a week. Mention the location at most rarely.
      'Do not put the city and business type in every post — mention the',
      'location sparingly, only where it earns its place.',
      'Hashtags are single words: no spaces, no # prefix.',
      'Return JSON: {"caption": string, "hashtags": string[], "alt_text": string}.',
      'Caption in the brand voice. Hashtags without the # prefix.',
      ALT_TEXT_RULE,
    ]
      .filter(Boolean)
      .join('\n');

    const gen = await this.llm.completeJson(
      { tier: 'voice', cachedContext: context, prompt, maxTokens: 600, customerId: task.customer_id },
      CaptionLlmOutput,
    );

    // Voice fixes the prompt can't enforce reliably — see caption-polish.
    gen.caption = polishCaption(gen.caption);

    // The prompt asks for a voice; this checks whether it got one. Prompt rules
    // are a request, and measured across sampled generations some of them did
    // nothing — so a draft that still reads as machine-written gets one more
    // attempt with its specific problems named. One retry, not a loop: if the
    // second is no better the first was not a fluke, and an owner waiting on a
    // text should not pay for us to keep trying.
    const findings = detectSlop(gen.caption);
    if (shouldRegenerate(findings)) {
      this.log.warn(
        `slop in ${platform} draft for ${task.customer_id} ` +
          `(${findings.map((f) => f.name).join(', ')}) — regenerating`,
      );
      try {
        const retry = await this.llm.completeJson(
          {
            tier: 'voice',
            cachedContext: context,
            prompt: `${prompt}\n\n${slopFeedback(findings, gen.caption)}`,
            maxTokens: 600,
            customerId: task.customer_id,
          },
          CaptionLlmOutput,
        );
        retry.caption = polishCaption(retry.caption);
        const after = detectSlop(retry.caption);
        // Keep the retry only if it actually improved on the original —
        // a second draft that trades one tell for two is not progress.
        if (after.length < findings.length) {
          gen.caption = retry.caption;
          gen.hashtags = retry.hashtags;
          gen.alt_text = retry.alt_text ?? gen.alt_text;
        }
        if (after.length > 0) {
          this.log.warn(
            `slop survived the retry for ${task.customer_id}: ` +
              `${after.map((f) => f.name).join(', ')}`,
          );
        }
      } catch (e) {
        // A failed retry must not cost the owner their post — the first draft
        // is publishable, just not as good as we wanted.
        this.log.warn(`slop retry failed for ${task.customer_id}: ${String(e)}`);
      }
    }

    // An invented customer is not a quality problem, it is a false statement
    // published under the owner's name. The prompt has forbidden it in capitals
    // from the start and the model still writes it, so this is the check rather
    // than the request. One rewrite, exactly like slop; if it survives that, the
    // post is pinned to the owner's approval below and never auto-publishes.
    const realQuote = /["“][^"”]{12,}["”]/.test(task.payload.prompt_notes ?? '');
    let faked = detectFabrication(gen.caption, realQuote);
    if (faked.length) {
      this.log.warn(
        `fabrication in ${archetype} draft for ${task.customer_id} ` +
          `(${faked.map((f) => f.name).join(', ')}) — rewriting`,
      );
      try {
        const retry = await this.llm.completeJson(
          {
            tier: 'voice',
            cachedContext: context,
            prompt: `${prompt}\n\n${fabricationFeedback(faked)}`,
            maxTokens: 600,
            customerId: task.customer_id,
          },
          CaptionLlmOutput,
        );
        retry.caption = polishCaption(retry.caption);
        const after = detectFabrication(retry.caption, realQuote);
        if (after.length < faked.length) {
          gen.caption = retry.caption;
          gen.hashtags = retry.hashtags;
          gen.alt_text = retry.alt_text ?? gen.alt_text;
          faked = after;
        }
      } catch (e) {
        this.log.warn(`fabrication rewrite failed for ${task.customer_id}: ${String(e)}`);
      }
      if (faked.length) {
        this.log.error(
          `fabrication SURVIVED the rewrite for ${task.customer_id} — ` +
            `pinning to owner approval: ${faked.map((f) => f.detail).join('; ')}`,
        );
      }
    }
    const fabricated = faked.length > 0;

    // Length is enforced, not requested: Opus pads toward whatever ceiling the
    // prompt names, and a 550-char caption is both weaker copy and (presented
    // over SMS) a multi-segment approval text. One corrective rewrite; keep
    // whichever is shorter so a failed tighten can't make things worse.
    if (gen.caption.length > 380) {
      this.log.warn(
        `caption ran ${gen.caption.length} chars for ${task.customer_id} — tightening`,
      );
      try {
        const tight = await this.llm.completeJson(
          {
            tier: 'voice',
            cachedContext: context,
            prompt:
              `${prompt}\n\nYour draft was ${gen.caption.length} characters — too long. ` +
              'Rewrite THIS caption under 280 characters: keep the single strongest ' +
              'idea and the call to action, cut everything else. No new claims.\n\n' +
              `Draft to tighten: """${gen.caption}"""`,
            maxTokens: 600,
            customerId: task.customer_id,
          },
          CaptionLlmOutput,
        );
        tight.caption = polishCaption(tight.caption);
        if (tight.caption.length < gen.caption.length) {
          gen.caption = tight.caption;
          if (tight.hashtags.length) gen.hashtags = tight.hashtags;
          gen.alt_text = tight.alt_text ?? gen.alt_text;
        }
      } catch (e) {
        this.log.warn(`caption tighten failed for ${task.customer_id}: ${String(e)}`);
      }
    }

    // §8 moderation before anything is persisted as publishable.
    const verdict = await this.moderation.screen({
      caption: gen.caption,
      hashtags: gen.hashtags,
      blackoutTopics: profile.blackoutTopics,
    });

    // Classify over the SAME text that publishes — caption plus hashtags. A
    // promo hidden only in a tag (#HalfOffFriday, #GrandOpening) would otherwise
    // read as low-risk and auto-publish without the owner's OK that §8 requires.
    const risk = this.gate.classifyRisk(
      [gen.caption, gen.hashtags.map((h) => `#${h}`).join(' ')].filter(Boolean).join(' '),
    );
    const decision = this.gate.decide(customer.trustLevel, risk);

    // Check the draft against what the platform will actually accept, before it
    // is persisted and shown to the owner. What we validate is what gets
    // published: the caption and hashtags travel as one field.
    //
    // An over-long caption we shorten silently — the alternative is a post that
    // dies at publish for a reason no owner can act on. Anything else we can
    // only log: cropping a photo is a decision about their business, not a
    // formatting fix, so it stays visible rather than being quietly "handled".
    const published = [gen.caption, gen.hashtags.map((h) => `#${h}`).join(' ')]
      .filter(Boolean)
      .join('\n\n');
    const violations = validateForPlatform(platform, published);
    for (const v of violations) {
      if (v.code === 'caption_too_long') {
        const room = published.length - gen.caption.length;
        gen.caption = truncateCaption(
          gen.caption,
          platform,
          PLATFORM_LIMITS[platform].captionChars - room,
        );
        this.log.warn(`trimmed an over-long ${platform} caption for ${task.customer_id}`);
      } else {
        this.log.warn(`${platform} draft for ${task.customer_id}: ${v.message}`);
      }
    }

    // Owner photos beat anything we can generate (§7: owner photo > AI).
    // Two kinds live in the bank: DRIP photos (texted in for a post, no
    // subject tag, claimed once) and WALK photos (the guided photo-walk,
    // subject-tagged, reusable — an owner's face is good on many posts). A
    // fresh drip photo wins (it's topical); otherwise the walk photo whose
    // subject best fits this archetype, skipping anything shown on a recent
    // post so the feed doesn't repeat itself. Carousel-bound posts skip all
    // of this — the deck builder pulls real photos into the slides itself.
    const wouldCarousel =
      !task.payload.needs_asset &&
      tierHasCarousel(customer.planTier) &&
      isCarouselArchetype(archetype);
    let bankedPhoto: { id: string; r2Key: string; subject: string | null } | null = null;
    if (!wouldCarousel) {
      bankedPhoto = await this.prisma.mediaAsset.findFirst({
        where: {
          customerId: task.customer_id,
          postId: null,
          kind: 'image',
          source: 'owner_upload',
          subject: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!bankedPhoto) {
        const [walk, recent] = await Promise.all([
          this.prisma.mediaAsset.findMany({
            where: {
              customerId: task.customer_id,
              kind: 'image',
              source: 'owner_upload',
              subject: { not: null },
            },
            orderBy: { createdAt: 'asc' },
            take: 40,
          }),
          this.prisma.post.findMany({
            where: { customerId: task.customer_id },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { mediaRefs: true },
          }),
        ]);
        const recentRefs = new Set(recent.flatMap((r) => r.mediaRefs));
        const fresh = walk.filter((w) => !recentRefs.has(w.r2Key));
        for (const preferred of subjectPreferences(archetype)) {
          const found = fresh.find((w) => w.subject === preferred);
          if (found) {
            bankedPhoto = found;
            break;
          }
        }
      }
    }

    // Stamp which playbook archetype this post was planned from, so
    // per-archetype performance can be aggregated later (engine Flow 4).
    const planned = await this.prisma.customer.findUnique({
      where: { id: task.customer_id },
      select: { archetypeSlug: true },
    });

    const post = await this.prisma.post.create({
      data: {
        customerId: task.customer_id,
        archetype,
        playbookSlug: planned?.archetypeSlug ?? null,
        platform,
        caption: gen.caption,
        altText: gen.alt_text ?? null,
        researchNotes: factBlock,
        hashtags: gen.hashtags,
        mediaRefs: bankedPhoto ? [bankedPhoto.r2Key] : [],
        scheduledTime: task.payload.scheduled_time
          ? new Date(task.payload.scheduled_time)
          : null,
        riskLevel: risk,
        moderationState: verdict.passed ? 'passed' : 'blocked',
        // A draft we could not scrub a fabrication out of — an invented customer
        // or an invented event — never goes out on autopilot, whatever the trust
        // level says. A human reads it first.
        approvalState:
          verdict.passed && !fabricated ? decision.approvalState : 'awaiting_owner',
        status: verdict.passed
          ? decision.autoPublishAllowed && !fabricated
            ? 'approved'
            : 'pending_approval'
          : 'draft',
      },
    });

    // Claim ONLY drip photos — a claimed asset never appears on another post,
    // which is right for "today's batch" and wrong for the owner's face. Walk
    // photos stay in the bank; the recent-posts check above keeps them from
    // repeating back-to-back.
    if (bankedPhoto && bankedPhoto.subject === null) {
      await this.prisma.mediaAsset.update({
        where: { id: bankedPhoto.id },
        data: { postId: post.id },
      });
    }

    if (!verdict.passed) {
      return fail(
        task.task_id,
        "I drafted something but it needs a tweak before it's ready — I'll rework it.",
        'moderation_blocked',
        `blocked: ${verdict.reasons.join(', ')}`,
      );
    }

    // No photo of their own, and they've asked us to make them one. Reported
    // rather than emitted: a handler dispatching through the TaskBus would
    // close a loop (TaskBus → OperatorService → this handler → TaskBus), so
    // the caller starts the follow-up task instead.
    // Generate a photo only when this slot is NOT one we're asking the owner
    // for a real picture of. A post the planner marked needs_asset gets a
    // shot-list text ("send me a photo of your team") — generating an AI image
    // for it too would both nag them and pre-empt their own photo. So the
    // planner's own split becomes the split between generated and owner photos:
    // needs_asset slots wait for a real shot, the rest get a generated one.
    // The carousel is the Growth+ flagship: an informational post with no owner
    // photo becomes swipeable branded slides — the single biggest reason to move
    // up from Starter. A single generated photo is the fallback, only for the
    // photo-first archetypes a carousel would ruin (behind-the-scenes, we're
    // open) and only when the owner opted into generated imagery. Owner photos
    // and shot-list asks still win over both, and the three are mutually
    // exclusive so a post gets exactly one treatment.
    const canGenerate = !bankedPhoto && !task.payload.needs_asset;
    const needsCarousel =
      canGenerate && tierHasCarousel(customer.planTier) && isCarouselArchetype(archetype);
    const needsImage =
      canGenerate && !needsCarousel && customer.aiImagesOptIn;

    const data: DraftPostResult = {
      post_id: post.id,
      platform,
      archetype,
      caption: gen.caption,
      hashtags: gen.hashtags,
      media_refs: [],
      scheduled_time: post.scheduledTime ? post.scheduledTime.toISOString() : null,
      risk_level: risk,
      needs_image: needsImage,
      needs_carousel: needsCarousel,
    };

    const status: Result['status'] = decision.autoPublishAllowed
      ? 'done'
      : 'pending_approval';
    const summary = decision.autoPublishAllowed
      ? `Draft ready and cleared to post: "${preview(gen.caption)}"`
      : `Here's a draft for your OK: "${preview(gen.caption)}"`;

    return ok(task.task_id, summary, status, data);
  }
}

/** One line per past caption keeps the prompt cheap and readable. */
function flatten(caption: string): string {
  const one = caption.replace(/\s+/g, ' ').trim();
  return one.length > 140 ? `${one.slice(0, 137)}…` : one;
}

function preview(caption: string): string {
  return caption.length > 120 ? `${caption.slice(0, 117)}...` : caption;
}
