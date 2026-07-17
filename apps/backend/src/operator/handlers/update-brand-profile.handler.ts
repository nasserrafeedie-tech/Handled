import { Injectable } from '@nestjs/common';
import { type Task, type Result } from '@smm/contracts';
import { PrismaService } from '../../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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

    // Integration point: when synthesize_voice is true, run a Sonnet-5 pass to
    // synthesize a durable voice_tone from accumulated answers (§6).

    return ok(task.task_id, 'Got it — updated your profile.', 'done', {
      updated_fields: Object.keys(clean),
    });
  }
}
