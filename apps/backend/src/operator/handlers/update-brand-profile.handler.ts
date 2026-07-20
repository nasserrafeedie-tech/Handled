import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandIdentityService } from '../branding/brand-identity.service';
import { TaskHandler, ok } from './handler.interface';

/**
 * UPDATE_BRAND_PROFILE (§6). The Concierge learned something during onboarding
 * or mid-relationship. Patch only the provided fields. When `synthesize_voice`
 * is set, final voice_tone synthesis escalates to Sonnet 5 (seam below).
 */
@Injectable()
export class UpdateBrandProfileHandler
  implements TaskHandler<'UPDATE_BRAND_PROFILE'>
{
  readonly type = 'UPDATE_BRAND_PROFILE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: BrandIdentityService,
  ) {}

  async handle(
    task: Extract<Task, { type: 'UPDATE_BRAND_PROFILE' }>,
  ): Promise<Result> {
    const p = task.payload.patch;
    const data = {
      businessType: p.business_type,
      voiceTone: p.voice_tone,
      targetCustomer: p.target_customer,
      offers: p.offers,
      dosAndDonts: p.dos_and_donts,
      blackoutTopics: p.blackout_topics,
      postingFrequency: p.posting_frequency,
      brandColors: p.brand_colors,
      logoRef: p.logo_ref,
      referencePhotoRefs: p.reference_photo_refs,
    };
    // Drop undefined so a partial patch only touches provided fields.
    const clean = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    );

    await this.prisma.brandProfile.upsert({
      where: { customerId: task.customer_id },
      create: { customerId: task.customer_id, ...clean },
      update: clean,
    });

    // The business's proper name lives on Customer, not the profile — the
    // owner stating it during onboarding beats anything we'd derive later.
    if (p.business_name) {
      await this.prisma.customer.update({
        where: { id: task.customer_id },
        data: { businessName: p.business_name },
      });
    }

    // Onboarding just finished: give this business its own look — palette,
    // type personality, trading name — so its posts stop resembling everyone
    // else's. Idempotent, so re-running never shifts an established brand.
    if (task.payload.synthesize_voice) {
      await this.identity.assign(task.customer_id);
    }

    return ok(task.task_id, 'Got it — updated your profile.', 'done', {
      updated_fields: Object.keys(clean),
    });
  }
}
