import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { normalizePhone } from '../common/phone';
import { PrismaService } from '../prisma/prisma.service';

const LeadBody = z.object({
  phone: z.string().min(7).max(20),
  email: z.string().email().optional(),
  source: z.string().max(40).default('website'),
  smsConsent: z.boolean().optional(),
  smsConsentText: z.string().max(1000).optional(),
  smsConsentAt: z.string().datetime().optional(),
});

/**
 * Pre-launch lead capture. Until Twilio clears there is no number to text, so
 * this is the only way an interested owner can raise a hand. Idempotent on
 * phone — resubmitting never errors at the visitor.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@Body() body: unknown): Promise<{ ok: boolean }> {
    const parsed = LeadBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid lead');
    const { phone, email, source, smsConsent, smsConsentText, smsConsentAt } =
      parsed.data;
    // Must match the spelling the Twilio webhook will use, or the lead and the
    // customer it becomes are two unrelated rows that never join up.
    const normalized = normalizePhone(phone);
    if (!normalized) throw new BadRequestException('invalid phone');
    // Consent is an audit trail: record it when affirmatively given, and never
    // degrade a stored consent (a re-submit without the fields leaves it alone).
    const consent =
      smsConsent === true
        ? {
            smsConsent: true,
            smsConsentText: smsConsentText ?? undefined,
            smsConsentAt: smsConsentAt ? new Date(smsConsentAt) : new Date(),
          }
        : {};
    await this.prisma.lead.upsert({
      where: { phone: normalized },
      create: { phone: normalized, email, source, ...consent },
      update: { email: email ?? undefined, ...consent },
    });
    return { ok: true };
  }
}
